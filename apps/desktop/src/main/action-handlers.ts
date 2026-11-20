import {executionBridgeAction,validateExecutionData} from '../shared/execution-contract.ts';
import {profileBridgeAction,validateProfileData} from '../shared/profile-contract.ts';
import {validateFeatureAction,validateFeatureData} from '../shared/feature-contract.ts';
import {validateWorkspaceAction,validateWorkspaceData} from '../shared/workspace-contract.ts';
import {environmentBridgeAction,validateEnvironmentData} from '../shared/environment-contract.ts';
import type { Params, PublicResult } from '../shared/bridge-contract.ts';
import { validateAction, record } from '../shared/validation.ts';
import { Confirmations, blocksMutation, canonical } from './confirmations.ts';
import type { ConfirmationScope } from './confirmations.ts';
import { ReceiptStore } from './receipt-store.ts';
import type { Receipt } from './receipt-store.ts';
import { ArchiveContext } from './archive-context.ts';
import type { CliCommand, CorePort } from './ports.ts';
import { unknownResult } from './core-cli.ts';
import { validateDiscoveryAction, discoveryReceiptAction } from '../shared/discovery-contract.ts';
import { settleDiscoveryReceipt } from './discovery-receipts.ts';
interface Options { context: ArchiveContext; receipts: ReceiptStore; core: CorePort; owner(): { owner: number; frame: number }; confirmations?: Confirmations }
export async function settleReceipt(store: ReceiptStore, receipt: Receipt, result: PublicResult) {
  if(receipt.namespace==='execution'){
    const unknown=()=>store.update(receipt.requestId,{phase:'UNKNOWN',errorCode:'UNKNOWN_OUTCOME'});
    if(result.requestId!==receipt.requestId||result.storeId!==receipt.storeId||result.result==='UNKNOWN_OUTCOME')return unknown();
    try{
      const data=validateExecutionData(receipt.action,result.data),op=data.operation===undefined?null:record(data.operation);
      if(op){
        if(op.requestId!==receipt.requestId||op.action!==receipt.action||op.targetId!==receipt.executionTarget||op.outcome!==result.outcome)return unknown();
        return store.update(receipt.requestId,{phase:op.phase==='FINALIZED'?'TERMINAL':'RECONCILING',outcome:result.outcome,errorCode:result.error?.code??null});
      }
      if(result.liveness==='LIVE_VERIFIED'&&['APPROVAL_REQUIRED','APPROVAL_STALE','EXECUTION_APPROVAL_STALE','EXECUTION_UNSUPPORTED','CHECKPOINT_STALE',
        'WORKSPACE_IN_USE','PROCESS_UNKNOWN','INVALID_REQUEST','RESOURCE_LIMIT','BUSY'].includes(result.error?.code??''))
        return store.update(receipt.requestId,{phase:'TERMINAL',outcome:'BLOCKED',errorCode:result.error!.code});
      return unknown();
    }catch{return unknown();}
  }
  if(['workspace','environment','profile'].includes(receipt.namespace)){
    const unknown=()=>store.update(receipt.requestId,{phase:'UNKNOWN',errorCode:'UNKNOWN_OUTCOME'});
    if(result.requestId!==receipt.requestId||result.storeId!==receipt.storeId||result.result==='UNKNOWN_OUTCOME')return unknown();
    try{
      const validate=receipt.namespace==='workspace'?validateWorkspaceData:receipt.namespace==='profile'?validateProfileData:validateEnvironmentData;
      const data=validate(receipt.action,result.data),operation=data.operation===undefined?null:record(data.operation);
      if(operation){
        if(operation.requestId!==receipt.requestId||operation.action!==receipt.action||operation.targetId!==(receipt.profileId??receipt.workspaceId)||operation.outcome!==result.outcome)return unknown();
        return store.update(receipt.requestId,{phase:operation.phase==='FINALIZED'?'TERMINAL':'RECONCILING',outcome:result.outcome,errorCode:result.error?.code??null});
      }
      if(data.accepted===true&&data.requestId===receipt.requestId&&data.workspaceId===receipt.workspaceId)
        return store.update(receipt.requestId,{phase:'RECONCILING',outcome:'IN_PROGRESS'});
      if(result.liveness==='LIVE_VERIFIED'&&['APPROVAL_REQUIRED','APPROVAL_STALE','BASE_CHANGED','CONTEXT_UNSTABLE','DISCOVERY_REQUIRED',
        'WORKSPACE_UNSAFE','WORKSPACE_IN_USE','WORKSPACE_NOT_FOUND','WORKSPACE_LIMIT','REVISION_CONFLICT','INVALID_REQUEST','RESOURCE_LIMIT','UNINTEGRATED_WORK','GIT_CONFLICT',
        'PROFILE_STALE','PROFILE_NOT_FOUND','PROFILE_CONFLICT','REQUIRED_SKILL_MISSING','TOOL_DISABLED','PERMISSION_CONFLICT','CAPABILITY_UNAVAILABLE','EXTENSION_UNTRUSTED','ENVIRONMENT_STALE','ENVIRONMENT_NOT_FOUND','MANAGER_MISMATCH','CONFIG_UNSAFE','DISK_BUDGET','BUSY','JOB_RECONCILING'].includes(result.error?.code??''))
        return store.update(receipt.requestId,{phase:'TERMINAL',outcome:'BLOCKED',errorCode:result.error!.code});
      return unknown();
    }catch{return unknown();}
  }
  if (receipt.namespace === 'feature') {
    const unknown=()=>store.update(receipt.requestId,{phase:'UNKNOWN',errorCode:'UNKNOWN_OUTCOME'});
    if(result.requestId!==receipt.requestId||receipt.storeId&&result.storeId!==receipt.storeId||result.result==='UNKNOWN_OUTCOME')return unknown();
    try{const data=validateFeatureData(receipt.action,result.data);const o=data.operation?record(data.operation):null;
      const artifact=receipt.action.startsWith('artifact.import');
      if(o){if(receipt.featureId&&o.targetId!==receipt.featureId||o.requestId!==receipt.requestId||o.action!==(artifact?'seal':receipt.action)||o.namespace!==(artifact?'ARTIFACT':'FEATURE')||o.outcome==='UNKNOWN'||o.outcome!==result.outcome)return unknown();return store.update(receipt.requestId,{phase:o.phase==='FINALIZED'?'TERMINAL':'RECONCILING',outcome:result.outcome,errorCode:result.error?.code??null});}
      if(data.accepted===true&&data.requestId===receipt.requestId)return store.update(receipt.requestId,{phase:'RECONCILING',outcome:'IN_PROGRESS'});
      if(result.liveness==='LIVE_VERIFIED'&&['APPROVAL_REQUIRED','APPROVAL_STALE','CONTEXT_CHANGED','DISCOVERY_REQUIRED','FEATURE_NOT_FOUND','FEATURE_IN_USE','FEATURE_LIMIT','REVISION_CONFLICT','INVALID_REQUEST','RESOURCE_LIMIT','PLANNING_UNAVAILABLE','BUSY'].includes(result.error?.code??''))return store.update(receipt.requestId,{phase:'TERMINAL',outcome:'BLOCKED',errorCode:result.error!.code});return unknown();
    }catch{return unknown();}
  }
  if (receipt.namespace === 'discovery') return settleDiscoveryReceipt(store, receipt, result);
  const operation = result.data.operation ? record(result.data.operation) : null;
  const action = receipt.namespace === 'project' ? receipt.action.toUpperCase() : receipt.action;
  if (result.requestId !== receipt.requestId || (receipt.storeId && result.storeId && result.storeId !== receipt.storeId)
    || (operation && (operation.requestId !== receipt.requestId || operation.action !== action))) return await store.update(receipt.requestId, { phase: 'UNKNOWN' });
  if (!operation || result.result === 'UNKNOWN_OUTCOME' || result.outcome === null) return await store.update(receipt.requestId, { phase: 'UNKNOWN', errorCode: result.error?.code ?? 'UNKNOWN_OUTCOME' });
  const terminal = ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(result.outcome) || (receipt.namespace === 'project' && result.outcome === 'BLOCKED');
  return await store.update(receipt.requestId, { phase: terminal ? 'TERMINAL' : 'RECONCILING', outcome: result.outcome,
    errorCode: result.error?.code ?? null, ...(result.storeId ? { storeId: result.storeId } : {}) });
}
export class ActionService {
  readonly options: Options;
  readonly confirmations: Confirmations;
  resolveProject: ((action: string, params: Params) => Promise<CliCommand>) | null = null;
  resolveDiscovery: ((action: string, params: Params) => Promise<{ command: CliCommand; summary: string[] }>) | null = null;
  resolveFeature: ((action:string,params:Params)=>Promise<{command:CliCommand;summary:string[]}>)|null=null;
  resolveWorkspace: ((action:string,params:Params)=>Promise<{command:CliCommand;summary:string[]}>)|null=null;
  resolveExecution: ((action:string,params:Params)=>Promise<{command:CliCommand;summary:string[]}>)|null=null;
  resolveProfile: ((action:string,params:Params)=>Promise<{command:CliCommand;summary:string[]}>)|null=null;
  resolveEnvironment: ((action:string,params:Params)=>Promise<{command:CliCommand;summary:string[]}>)|null=null;
  private confirming = false;
  constructor(options: Options) { this.options = options; this.confirmations = options.confirmations ?? new Confirmations(); }
  private scope(): ConfirmationScope {
    const c = this.options.context.capture(); return { ...this.options.owner(), epoch: c.view.selectionEpoch, archiveHandle: c.view.archiveHandle, storeId: c.view.storeId };
  }
  private async preflight(command: CliCommand) {
    const c = this.options.context.capture();
    if (c.path !== command.archive) throw new Error('STALE_CONTEXT');
    const status = await this.options.core.call({ namespace: 'daemon', action: 'status', archive: c.path });
    this.options.context.apply(c, status);
    if (status.result !== 'OK' || (command.namespace === 'daemon' && command.action === 'start' ? !['LIVE_VERIFIED', 'ABSENT_VERIFIED'].includes(status.liveness) : status.liveness !== 'LIVE_VERIFIED')) throw new Error(status.error?.code ?? 'DAEMON_UNAVAILABLE');
    if (command.namespace === 'feature') {const cap=record(status.data.capabilities);if(cap.featureVersion!==1||!Array.isArray(cap.featureMethods)||!cap.featureMethods.includes(command.action.startsWith('artifact.import')?'feature.artifact.seal':`feature.${command.action}`))throw new Error('UNSUPPORTED_VERSION');if(command.featureId&&command.action!=='create'){const d=await this.options.core.call({namespace:'feature',action:'get',archive:c.path,params:{featureId:command.featureId}});this.options.context.apply(c,d);if(d.result!=='OK'||record(d.data.feature).stateRevision!==command.expectedStateRevision)throw new Error('REVISION_CONFLICT');}}
    if(command.namespace==='workspace'){
      const cap=record(status.data.capabilities);
      if(cap.workspaceVersion!==1||!Array.isArray(cap.workspaceMethods)||!cap.workspaceMethods.includes(`workspace.${command.action}`))throw new Error('UNSUPPORTED_VERSION');
      if(command.action==='create'){
        const feature=await this.options.core.call({namespace:'feature',action:'get',archive:c.path,params:{featureId:command.featureId}});
        this.options.context.apply(c,feature);
        if(feature.result!=='OK'||record(feature.data.feature).stateRevision!==command.expectedStateRevision)throw new Error('REVISION_CONFLICT');
      }else{
        const workspace=await this.options.core.call({namespace:'workspace',action:'get',archive:c.path,params:{workspaceId:command.workspaceId}});
        this.options.context.apply(c,workspace);
        if(workspace.result!=='OK'||record(workspace.data.workspace).stateRevision!==command.expectedStateRevision)throw new Error('REVISION_CONFLICT');
      }
    }
    if(command.namespace==='execution'){
      const cap=record(status.data.capabilities);
      if(cap.executionVersion!==1||!Array.isArray(cap.executionMethods)||!cap.executionMethods.includes(`execution.${command.action}`))
        throw new Error('EXECUTION_UNSUPPORTED');
      if(command.executionTarget&&command.expectedStateRevision&&['pause','cancel','checkpoint','resume'].includes(command.action)){
        const current=await this.options.core.call({namespace:'execution',action:'get',archive:c.path,params:{sessionId:command.executionTarget}});
        this.options.context.apply(c,current);
        if(current.result!=='OK'||record(current.data.session).stateRevision!==command.expectedStateRevision)throw new Error('EXECUTION_APPROVAL_STALE');
      }
    }
    if(command.namespace==='profile'){
      const capability=record(status.data.capabilities);
      if(capability.profileVersion!==1||!Array.isArray(capability.profileMethods)||!capability.profileMethods.includes(`profile.${command.action}`))
        throw new Error('UNSUPPORTED_VERSION');
      if(command.expectedStateRevision){
        const current=await this.options.core.call({namespace:'profile',action:'get',archive:c.path,params:{entityId:command.profileId}});
        this.options.context.apply(c,current);
        if(current.result!=='OK'||record(current.data.record).stateRevision!==command.expectedStateRevision)throw new Error('PROFILE_STALE');
      }
    }
    if(command.namespace==='environment'){
      const cap=record(status.data.capabilities);
      if(cap.environmentVersion!==1||!Array.isArray(cap.environmentMethods)||!cap.environmentMethods.includes(`environment.${command.action}`))throw new Error('UNSUPPORTED_VERSION');
      const entity=command.action==='plan'?'workspace':['cancel','reconcile'].includes(command.action)?'job':'environment';
      const current=await this.options.core.call({namespace:entity==='workspace'?'workspace':'environment',action:entity==='job'?'job':'get',archive:c.path,
        params:entity==='job'?{jobId:command.jobId}:{workspaceId:command.workspaceId}});
      this.options.context.apply(c,current);
      if(current.result!=='OK'||record(current.data[entity]).stateRevision!==command.expectedStateRevision)throw new Error('REVISION_CONFLICT');
    }
    if (command.namespace === 'discovery') {
      const capability = record(status.data.capabilities), methods = capability.discoveryMethods;
      if (capability.discoveryVersion !== 1 || !Array.isArray(methods) || !methods.includes(`discovery.${command.action}`)) throw new Error('UNSUPPORTED_VERSION');
    }
    let project: Params | null = null;
    if (command.namespace === 'project' && command.action !== 'register') {
      const detail = await this.options.core.call({ namespace: 'project', action: 'get', archive: c.path, params: { projectId: command.params?.projectId } });
      this.options.context.apply(c, detail);
      if (detail.result !== 'OK') throw new Error(detail.error?.code ?? 'PROJECT_NOT_FOUND');
      project = record(detail.data.project);
      if (['update', 'remove'].includes(command.action) && project.configRevision !== command.params?.expectedRevision) throw new Error('REVISION_CONFLICT');
    }
    if (command.namespace === 'discovery' && ['start', 'preview'].includes(command.action)) {
      const detail = await this.options.core.call({ namespace: 'project', action: 'get', archive: c.path, params: { projectId: command.projectId ?? command.params?.projectId } });
      this.options.context.apply(c, detail); if (detail.result !== 'OK') throw new Error(detail.error?.code ?? 'PROJECT_NOT_FOUND');
      project = record(detail.data.project); if (project.configRevision !== (command.expectedRevision ?? command.params?.expectedConfigRevision)) throw new Error('REVISION_CONFLICT');
    }
    if (command.namespace === 'discovery' && command.action === 'provider.configure') {
      const detail = await this.options.core.call({ namespace: 'discovery', action: 'provider.get', archive: c.path, params: {} }); this.options.context.apply(c, detail);
      if (detail.result !== 'OK') throw new Error(detail.error?.code ?? 'PROVIDER_UNAVAILABLE');
      const configuration = detail.data.configuration === null ? null : record(detail.data.configuration);
      if ((configuration?.revision ?? null) !== (command.expectedRevision ?? null)) throw new Error('REVISION_CONFLICT');
    }
    if (command.namespace === 'discovery' && ['answer', 'cancel', 'correct', 'approve'].includes(command.action)) {
      const detail = await this.options.core.call({ namespace: 'discovery', action: 'get', archive: c.path, params: { discoveryId: command.discoveryId } }); this.options.context.apply(c, detail);
      if (detail.result !== 'OK') throw new Error(detail.error?.code ?? 'STALE_CONTEXT'); const d = record(detail.data.discovery);
      if (d.projectId !== command.projectId || d.stateRevision !== command.expectedStateRevision) throw new Error('REVISION_CONFLICT');
    }
    return { status, project };
  }
  async prepare(action: string, params: Params) {
    if(action.startsWith('execution.'))executionBridgeAction({...params,action:action.slice('execution.'.length)});
    else if(action.startsWith('profile.'))profileBridgeAction({...params,action:action.slice('profile.'.length)});
    else if(action.startsWith('environment.'))environmentBridgeAction({...params,action:action.slice('environment.'.length)});
    else if(action.startsWith('workspace.'))validateWorkspaceAction(action,params);
    else if (action.startsWith('feature.')) validateFeatureAction(action,params); else if (action.startsWith('discovery.')) validateDiscoveryAction(action, params); else validateAction(action, params);
    if (this.confirming) throw new Error('LOCAL_BUSY');
    const c = this.options.context.capture(), owner = canonical(this.options.owner());
    const resolver=action.startsWith('execution.')?this.resolveExecution:action.startsWith('profile.')?this.resolveProfile:action.startsWith('environment.')?this.resolveEnvironment:action.startsWith('workspace.')?this.resolveWorkspace:action.startsWith('feature.')?this.resolveFeature:
      action.startsWith('discovery.')?this.resolveDiscovery:undefined;
    if(resolver===null)throw new Error('CONFIRMATION_REQUIRED');
    const resolved=resolver?await resolver(action,params):null;
    const command: CliCommand = resolved ? resolved.command : action.startsWith('daemon.') ? { namespace: 'daemon', action: action.slice(7), archive: c.path } : this.resolveProject ? await this.resolveProject(action, params) : (() => { throw new Error('CONFIRMATION_REQUIRED'); })();
    if(command.namespace==='scheduler'||command.namespace==='review')throw new Error('INVALID_INPUT');
    const namespace = command.namespace === 'daemon' ? 'foundation' : command.namespace, receiptAction = command.namespace === 'discovery' ? discoveryReceiptAction(command.action) : command.action;
    if (blocksMutation(await this.options.receipts.list(), c.path, namespace, receiptAction, command.projectId ?? (typeof command.params?.projectId === 'string' ? command.params.projectId : undefined))) throw new Error('OPERATION_UNCERTAIN');
    const checked = await this.preflight(command);
    if (this.options.context.capture().view.selectionEpoch !== c.view.selectionEpoch || canonical(this.options.owner()) !== owner) throw new Error('STALE_CONTEXT');
    const descriptions: Record<string, string> = { register: 'Importa repository locale', verify: 'Verifica il checkout di riferimento', update: 'Aggiorna la configurazione del progetto', remove: 'Rimuovi la registrazione del progetto' };
    const summary = [command.namespace === 'daemon' ? command.action === 'start' ? 'Avvia il servizio locale' : command.action === 'stop' ? 'Arresta il servizio locale e termina il lavoro Foundation secondo il core' : 'Riavvia il servizio locale' : descriptions[command.action] ?? 'Operazione progetto',
      `Archivio: ${c.path}`, ...(checked.project ? [`Nome: ${checked.project.displayName}`] : []), ...(command.params?.path ? [`Repository: ${command.params.path}`] : []), ...(command.params?.name ? [`Nome: ${command.params.name}`] : []), ...(command.params?.baseBranch ? [`Branch base: ${command.params.baseBranch}`] : []), ...(command.params?.projectId ? [`Progetto: ${command.params.projectId}`] : []), ...(command.params?.expectedRevision ? [`Revisione approvata: ${command.params.expectedRevision}`] : []), ...(command.params?.patch ? Object.entries(record(command.params.patch)).map(([key, value]) => key === 'name' ? `Nome: ${value}` : value === null ? 'Branch base: cancella configurazione' : `Branch base: ${value}`) : []), ...(command.action === 'remove' ? ['Viene rimossa soltanto la registrazione. Repository e file conservati.'] : [])];
    return this.confirmations.prepare(command, this.scope(), resolved?.summary ?? summary);
  }
  async confirm(confirmationId: string, namespaces?: readonly string[]) {
    if (this.confirming) throw new Error('LOCAL_BUSY');
    const scope = this.scope(), token = this.confirmations.consume(confirmationId, scope, namespaces); this.confirming = true;
    try {
      await this.preflight(token.command);
      if (canonical(this.scope()) !== canonical(scope)) throw new Error('STALE_CONTEXT');
      if(token.command.namespace==='scheduler'||token.command.namespace==='review')throw new Error('INVALID_INPUT');
      const c = this.options.context.capture(), namespace = token.command.namespace === 'daemon' ? 'foundation' : token.command.namespace;
      const receiptAction = namespace === 'discovery' ? discoveryReceiptAction(token.command.action) : token.command.action;
      const projectId = token.command.projectId ?? (typeof token.command.params?.projectId === 'string' ? token.command.params.projectId : null);
      if (blocksMutation(await this.options.receipts.list(), c.path, namespace, receiptAction, projectId ?? undefined)) throw new Error('OPERATION_UNCERTAIN');
      const receipt = await this.options.receipts.create({ requestId: token.requestId, namespace, action: receiptAction, archivePath: c.path, storeId: c.view.storeId,
        projectId, ...(token.command.executionTarget!==undefined?{executionTarget:token.command.executionTarget}:{}), ...(token.command.featureId?{featureId:token.command.featureId}:{}), ...(token.command.profileId?{profileId:token.command.profileId}:{}), ...(token.command.workspaceId?{workspaceId:token.command.workspaceId}:{}), expectedRevision: token.command.expectedRevision ?? token.command.expectedStateRevision ?? (typeof token.command.params?.expectedRevision === 'string' ? token.command.params.expectedRevision : null), intentHash: token.intentHash });
      try {
        if (canonical(this.scope()) !== canonical(scope)) throw new Error('STALE_CONTEXT');
        const result = await this.options.core.call(token.command);
        const final = await settleReceipt(this.options.receipts, receipt, result);
        if (final.phase === 'UNKNOWN') return { receipt: final, result: unknownResult(token.requestId) };
        this.options.context.apply(c, result);
        return { receipt: final, result };
      } catch {
        const unknown = await this.options.receipts.update(token.requestId, { phase: 'UNKNOWN', errorCode: 'UNKNOWN_OUTCOME' }).catch(() => receipt);
        return { receipt: unknown, result: unknownResult(token.requestId) };
      }
    } finally { this.confirming = false; }
  }
}
