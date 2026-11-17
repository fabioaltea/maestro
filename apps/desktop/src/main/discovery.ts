import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import type { CliCommand, CorePort, DialogPort, Clock } from './ports.ts';
import type { Params, PublicResult } from '../shared/bridge-contract.ts';
import type { BridgeMethod } from '../shared/bridge-contract.ts';
import { DISCOVERY_QUERIES, validateDiscoveryAction, validateDiscoveryBridge, validateDiscoveryData } from '../shared/discovery-contract.ts';
import { keys, record, uuid, text } from '../shared/validation.ts';
import { ArchiveContext } from './archive-context.ts';
import type { ArchiveSelection } from './archive-context.ts';
import type { ActionService } from './action-handlers.ts';
import type { BridgeRouter } from './bridge.ts';
import { publicReceipt } from './lifecycle.ts';
import { canonical } from './confirmations.ts';
interface Options { context: ArchiveContext; core: CorePort; dialogs: DialogPort; owner?(): { owner: number; frame: number }; clock?: Clock }
interface BinaryHandle { path: string; epoch: number; archiveHandle: string; owner: string; expiresAt: number }
export class DiscoveryActions {
  private options: Options; private handles = new Map<string, BinaryHandle>(); private choosing = false;
  constructor(options: Options) { this.options = options; options.context.onChange(() => this.handles.clear()); }
  private now() { return this.options.clock?.now() ?? Date.now(); }
  private owner() { const owner = this.options.owner?.() ?? { owner: 0, frame: 0 }; return `${owner.owner}:${owner.frame}`; }
  async chooseProviderBinary() {
    if (this.choosing || !this.options.dialogs.chooseFile) throw new Error('LOCAL_BUSY');
    const c = this.options.context.capture(), owner = this.owner(); this.choosing = true;
    try {
      const path = await this.options.dialogs.chooseFile('Scegli il binario nativo del provider'); if (!path) return null;
      const current = this.options.context.capture(); if (current.view.selectionEpoch !== c.view.selectionEpoch || this.owner() !== owner) throw new Error('STALE_CONTEXT');
      const canonical = await realpath(path); if (!(await lstat(canonical)).isFile()) throw new Error('INVALID_INPUT');
      for (const [id, handle] of this.handles) if (handle.expiresAt <= this.now()) this.handles.delete(id);
      if (this.handles.size >= 32) throw new Error('LOCAL_BUSY');
      const providerBinaryHandle = randomUUID(); this.handles.set(providerBinaryHandle, { path: canonical, epoch: c.view.selectionEpoch, archiveHandle: c.view.archiveHandle, owner, expiresAt: this.now() + 300000 });
      return { providerBinaryHandle, displayName: basename(canonical) };
    } finally { this.choosing = false; }
  }
  private async status(c: ArchiveSelection, methods: readonly string[]) {
    const result = await this.options.core.call({ namespace: 'daemon', action: 'status', archive: c.path }); this.options.context.apply(c, result);
    if (result.result !== 'OK' || result.liveness !== 'LIVE_VERIFIED' || !result.storeId) throw new Error(result.error?.code ?? 'DAEMON_UNAVAILABLE');
    if (result.data.lifecycle !== undefined && result.data.lifecycle !== 'RUNNING') throw new Error('DAEMON_UNAVAILABLE');
    const capability = record(result.data.capabilities), implemented = capability.discoveryMethods;
    if (capability.discoveryVersion !== 1 || !Array.isArray(implemented) || methods.some(method => !implemented.includes(method))) throw new Error('UNSUPPORTED_VERSION');
    return result;
  }
  private async call(c: ArchiveSelection, action: string, params: Params = {}, view = false) {
    const result = await this.options.core.call({ namespace: 'discovery', action, archive: c.path, params, ...(view ? { scope: 'view' as const } : {}) });
    this.options.context.apply(c, result);
    const checked = { ...result, data: validateDiscoveryData(action, result.data) };
    if (checked.result !== 'OK') throw new Error(checked.error?.code ?? 'OPERATION_UNCERTAIN'); return checked;
  }
  async read(method: string, params: Params) {
    const query = DISCOVERY_QUERIES[method]; if (!query) throw new Error('INVALID_INPUT');
    const c = this.options.context.capture(), input = structuredClone(params); keys(input, [...query.required, ...(query.optional ?? [])]);
    validateDiscoveryBridge(method, { bridgeVersion: 1, callId: randomUUID(), selectionEpoch: c.view.selectionEpoch, ...input });
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 50));
      if (this.options.context.capture().view.selectionEpoch !== c.view.selectionEpoch) throw new Error('STALE_CONTEXT');
      try {
        const result = await this.options.core.call({ namespace: 'discovery', action: query.action, archive: c.path, params: input, scope: 'view' });
        this.options.context.apply(c, result); return { ...result, data: validateDiscoveryData(query.action, result.data) };
      } catch (error) { if (!(error instanceof Error) || error.message !== 'LOCAL_BUSY' || attempt === 4) throw error; }
    }
    throw new Error('LOCAL_BUSY');
  }
  async resolve(action: string, raw: Params): Promise<{ command: CliCommand; summary: string[] }> {
    const p = structuredClone(validateDiscoveryAction(action, raw)), c = this.options.context.capture();
    const command = (name: string, params: Params, projectId?: string, expectedRevision?: string): CliCommand => ({ namespace: 'discovery', action: name, archive: c.path, params,
      ...(projectId ? { projectId } : {}), ...(expectedRevision ? { expectedRevision } : {}) });
    if (action === 'discovery.correct' || action === 'discovery.approve') {
      const name = action.slice(10), status = await this.status(c, [`discovery.${name}`, 'discovery.prepare', 'discovery.document.get']);
      const d = record((await this.call(c, 'get', { discoveryId: p.discoveryId })).data.discovery);
      if (d.projectId !== p.projectId || d.stateRevision !== p.expectedStateRevision || d.latestDocumentRevisionId !== p.revisionId) throw new Error('APPROVAL_STALE');
      const revision = record((await this.call(c, 'document', { revisionId: p.revisionId })).data.revision);
      if (revision.discoveryId !== d.discoveryId || revision.bundleDigest !== p.bundleDigest) throw new Error('APPROVAL_STALE');
      const config = record((await this.call(c, 'provider.get')).data.configuration), uid = process.getuid?.(); if (uid === undefined) throw new Error('RUNTIME_UNAVAILABLE');
      const payload = name === 'correct' ? { revisionId: p.revisionId, correctionId: randomUUID(), correction: p.correction } : { revisionId: p.revisionId, bundleDigest: p.bundleDigest, acceptedUnknownIds: p.acceptedUnknownIds };
      const intent = { ownerUid: uid, storeId: status.storeId, action: name, targetId: d.discoveryId, configRevision: d.configRevision, stateRevision: d.stateRevision, snapshotId: d.snapshotId, contextDigest: revision.contextDigest, providerRevision: d.providerRevision, providerProfileDigest: config.qualificationDigest, modelId: config.modelId, payload };
      const prepared = (await this.call(c, 'prepare', { intent })).data; uuid(prepared.grantId);
      if (canonical(JSON.parse(text(prepared.canonicalIntent, 32768))) !== canonical(intent)) throw new Error('CLIENT_PROTOCOL_ERROR');
      const params = name === 'correct' ? { discoveryId: d.discoveryId, grantId: prepared.grantId, correction: p.correction } : { discoveryId: d.discoveryId, grantId: prepared.grantId, revisionId: p.revisionId, bundleDigest: p.bundleDigest, acceptedUnknownIds: p.acceptedUnknownIds };
      return { command: { ...command(name, params, d.projectId as string, d.configRevision as string), discoveryId: d.discoveryId as string, expectedStateRevision: d.stateRevision as string }, summary: [name === 'correct' ? 'Invia correzione e genera una nuova revisione' : 'Approva questa revisione', `Progetto: ${d.projectId}`, `Discovery: ${d.discoveryId}`, `Revisione: ${p.revisionId}`, `Digest: ${p.bundleDigest}`, `Contesto: ${revision.contextDigest}`, ...(name === 'correct' ? [String(p.correction), 'Correzione e fonti originali saranno inviate al provider.'] : (p.acceptedUnknownIds as string[]).map(id => `UNKNOWN accettato: ${id}`))] };
    }
    if (action === 'discovery.answer' || action === 'discovery.cancel') {
      const name = action.slice(10), status = await this.status(c, [`discovery.${name}`, 'discovery.prepare', 'discovery.get', 'discovery.preview.get']);
      const d = record((await this.call(c, 'get', { discoveryId: p.discoveryId })).data.discovery);
      if (d.projectId !== p.projectId || d.stateRevision !== p.expectedStateRevision) throw new Error('REVISION_CONFLICT');
      const snapshot = record((await this.call(c, 'preview.get', { snapshotId: d.snapshotId })).data.snapshot);
      const uid = process.getuid?.(); if (uid === undefined) throw new Error('RUNTIME_UNAVAILABLE');
      let payload: Params = {}, modelId: unknown = null, profile: unknown = null;
      if (name === 'answer') {
        const provider = (await this.call(c, 'provider.get')).data, config = record(provider.configuration);
        if (config.revision !== d.providerRevision) throw new Error('APPROVAL_STALE'); modelId = config.modelId; profile = config.qualificationDigest;
        let cursor: unknown, question: Params | undefined;
        for (let page = 0; page < 20; page++) {
          const data = (await this.call(c, 'questions', { discoveryId: d.discoveryId, ...(cursor ? { cursor } : {}) })).data;
          question = (data.items as Params[]).find(q => q.questionId === p.questionId); if (question || !data.nextCursor) break; cursor = data.nextCursor;
        }
        if (!question || question.revision !== p.expectedQuestionRevision || (question.answer ? record(question.answer).revision : '0') !== p.expectedAnswerRevision) throw new Error('ANSWER_CONFLICT');
        payload = { questionId: p.questionId, questionRevision: p.expectedQuestionRevision, answerId: randomUUID(), answerRevision: String(BigInt(p.expectedAnswerRevision as string) + 1n), kind: p.kind, text: p.text };
      }
      const intent = { ownerUid: uid, storeId: status.storeId, action: name, targetId: name === 'answer' ? p.questionId : d.discoveryId,
        configRevision: d.configRevision, stateRevision: d.stateRevision, snapshotId: d.snapshotId, contextDigest: snapshot.contextDigest,
        providerRevision: d.providerRevision, providerProfileDigest: profile, modelId, payload };
      const prepared = (await this.call(c, 'prepare', { intent })).data; uuid(prepared.grantId);
      if (canonical(JSON.parse(text(prepared.canonicalIntent, 32768))) !== canonical(intent)) throw new Error('CLIENT_PROTOCOL_ERROR');
      return { command: { ...command(name, name === 'answer' ? { questionId: p.questionId, grantId: prepared.grantId, kind: p.kind, text: p.text } : { discoveryId: d.discoveryId, grantId: prepared.grantId }, d.projectId as string, d.configRevision as string), discoveryId: d.discoveryId as string, expectedStateRevision: d.stateRevision as string },
        summary: name === 'answer' ? ['Invia risposta e continua', `Progetto: ${d.projectId}`, `Discovery: ${d.discoveryId}`, `Risposta: ${p.kind === 'UNKNOWN' ? 'Non so (UNKNOWN)' : p.text}`, 'La risposta e le fonti originali verranno inviate in una nuova esecuzione in sola lettura.']
          : ['Annulla questa Discovery', `Progetto: ${d.projectId}`, `Discovery: ${d.discoveryId}`, 'Termina soltanto l’esecuzione locale posseduta. La cancellazione remota non è verificata. Output e domande restano conservati.'] };
    }
    if (action === 'discovery.preview') {
      await this.status(c, ['discovery.preview']);
      const project = await this.options.core.call({ namespace: 'project', action: 'get', archive: c.path, params: { projectId: p.projectId } }); this.options.context.apply(c, project);
      if (project.result !== 'OK' || record(project.data.project).configRevision !== p.expectedConfigRevision) throw new Error(project.error?.code ?? 'REVISION_CONFLICT');
      return { command: command('preview', p, p.projectId as string, p.expectedConfigRevision as string), summary: ['Prepara un’anteprima locale', 'Nessun invio al provider AI.', ...(p.selectors as string[]).map(path => `Selettore: ${path}`)] };
    }
    if (action === 'discovery.discard') {
      await this.status(c, ['discovery.preview.discard', 'discovery.preview.get']);
      const snapshot = record((await this.call(c, 'preview.get', { snapshotId: p.snapshotId })).data.snapshot);
      if (snapshot.projectId !== p.projectId) throw new Error('STALE_CONTEXT');
      return { command: command('preview.discard', { snapshotId: p.snapshotId }, p.projectId as string, snapshot.configRevision as string), summary: ['Scarta questa anteprima locale', 'I file del repository e lo storico delle Discovery restano conservati.'] };
    }
    const wanted = action === 'discovery.configure' ? ['discovery.provider.configure', 'discovery.prepare', 'discovery.provider.get']
      : action === 'discovery.check' ? ['discovery.provider.check', 'discovery.provider.get'] : ['discovery.start', 'discovery.prepare', 'discovery.provider.get', 'discovery.preview.get'];
    const status = await this.status(c, wanted), provider = (await this.call(c, 'provider.get')).data;
    const configuration = provider.configuration === null ? null : record(provider.configuration);
    if ((configuration?.revision ?? null) !== p.expectedProviderRevision) throw new Error('REVISION_CONFLICT');
    if (action === 'discovery.check') return { command: command('provider.check', { expectedProviderRevision: p.expectedProviderRevision }), summary: ['Verifica lo stato del login ufficiale', 'Il controllo non avvia una Discovery.'] };
    const uid = process.getuid?.(); if (uid === undefined) throw new Error('RUNTIME_UNAVAILABLE');
    let intent: Params, selectedName: string | null = null;
    if (action === 'discovery.configure') {
      const handle = this.handles.get(uuid(p.providerBinaryHandle));
      if (!handle || handle.epoch !== c.view.selectionEpoch || handle.archiveHandle !== c.view.archiveHandle || handle.owner !== this.owner() || handle.expiresAt <= this.now()) throw new Error('STALE_CONTEXT');
      const requirements = record(provider.requirements); selectedName = basename(handle.path);
      intent = { ownerUid: uid, storeId: status.storeId, action: 'configure', targetId: status.storeId, configRevision: null, stateRevision: null, snapshotId: null, contextDigest: null,
        providerRevision: p.expectedProviderRevision, providerProfileDigest: requirements.qualificationDigest, modelId: p.modelId,
        payload: { binaryRealpath: handle.path, binarySha256: requirements.binarySha256, binaryVersion: requirements.binaryVersion, modelId: p.modelId,
          expectedProviderRevision: p.expectedProviderRevision, providerProfileDigest: requirements.qualificationDigest } };
    } else {
      if (!configuration) throw new Error('PROVIDER_NOT_CONFIGURED');
      const snapshot = record((await this.call(c, 'preview.get', { snapshotId: p.snapshotId })).data.snapshot);
      if (snapshot.projectId !== p.projectId || snapshot.configRevision !== p.expectedConfigRevision || snapshot.contextDigest !== p.contextDigest || snapshot.state !== 'SEALED') throw new Error('CONTEXT_CHANGED');
      intent = { ownerUid: uid, storeId: status.storeId, action: 'start', targetId: p.projectId, configRevision: p.expectedConfigRevision, stateRevision: null, snapshotId: p.snapshotId,
        contextDigest: p.contextDigest, providerRevision: p.expectedProviderRevision, providerProfileDigest: configuration.qualificationDigest, modelId: configuration.modelId, payload: { snapshotId: p.snapshotId } };
    }
    const prepared = (await this.call(c, 'prepare', { intent })).data; uuid(prepared.grantId);
    if (canonical(JSON.parse(text(prepared.canonicalIntent, 32768))) !== canonical(intent)) throw new Error('CLIENT_PROTOCOL_ERROR');
    if (action === 'discovery.configure') {
      const path = record(intent.payload).binaryRealpath;
      return { command: command('provider.configure', { grantId: prepared.grantId, binaryRealpath: path, modelId: p.modelId }, undefined, typeof p.expectedProviderRevision === 'string' ? p.expectedProviderRevision : undefined),
        summary: ['Configura il provider selezionato', `Binario: ${selectedName}`, `Modello: ${p.modelId}`, 'Il login resta un’azione separata nella CLI ufficiale.'] };
    }
    const summary = record(prepared.summary);
    return { command: command('start', { projectId: p.projectId, grantId: prepared.grantId }, p.projectId as string, p.expectedConfigRevision as string),
      summary: ['Avvia Discovery in sola lettura', `Progetto: ${p.projectId}`, `Anteprima: ${p.snapshotId}`, `Digest: ${p.contextDigest}`, `Provider: ${summary.providerId}`, `Modello: ${summary.modelId}`, `File: ${summary.fileCount} · Byte: ${summary.byteCount}`,
        ...((summary.selectors as string[] | undefined) ?? []).map(path => `Selettore: ${path}`), 'Questi contenuti saranno inviati al provider AI. Il repository non verrà modificato.'] };
  }
}
export function installDiscovery(router: BridgeRouter, context: ArchiveContext, actions: ActionService | null) {
  if (!router.services.core) return null;
  const discovery = new DiscoveryActions({ context, core: router.services.core, dialogs: router.services.dialogs,
    owner: () => ({ owner: router.window.webContents.id, frame: router.window.webContents.mainFrame.routingId }) });
  if (actions) actions.resolveDiscovery = (action, params) => discovery.resolve(action, params);
  const sync = async <T>(work: () => Promise<T>) => { try { return await work(); } finally { router.setContext(context.current?.view ?? null); } };
  router.register('chooseProviderBinary', () => sync(async () => ({ provider: await discovery.chooseProviderBinary() })));
  for (const method of Object.keys(DISCOVERY_QUERIES)) router.register(method as BridgeMethod, request => {
    const { bridgeVersion: _version, callId: _id, selectionEpoch: _epoch, ...params } = request; return sync(() => discovery.read(method, params));
  });
  router.register('prepareDiscoveryAction', request => { if (!actions) throw new Error('RUNTIME_UNAVAILABLE'); return sync(() => actions.prepare(String(request.action), record(request.params))); });
  router.register('confirmDiscoveryAction', request => { if (!actions) throw new Error('RUNTIME_UNAVAILABLE'); return sync(async () => { const result = await actions.confirm(uuid(request.confirmationId), ['discovery']); return { ...result, receipt: publicReceipt(result.receipt, context) }; }); });
  router.register('cancelDiscoveryAction', request => { actions?.confirmations.cancel(uuid(request.confirmationId), ['discovery']); return { cancelled: true }; });
  router.register('checkDiscoveryProvider', async request => {
    if (!actions) throw new Error('RUNTIME_UNAVAILABLE');
    return sync(async () => { const prepared = await actions.prepare('discovery.check', { expectedProviderRevision: request.expectedProviderRevision }); const result = await actions.confirm(prepared.confirmationId, ['discovery']); return { ...result, receipt: publicReceipt(result.receipt, context) }; });
  });
  return discovery;
}
