import {createWorkspaceMutator} from '../platform/macos/git/workspace-mutator.js';
import {createReviewRuntime,nativeReviewGit,nativeReviewIntegration} from './review/runtime.js';
import {createSchedulerRuntime} from './scheduler/runtime.js';
import {createExecutionRuntime} from './execution/runtime.js';
import {createProfileRuntime} from './profiles/runtime.js';
import {createEnvironmentRuntime,nativeEnvironmentServices} from './environments/runtime.js';
import {createWorkspaceRuntime,nativeWorkspaceServices} from './workspaces/runtime.js';
import {createFeatureRuntime} from './features/runtime.js';
import { createDiscoveryRuntime } from './discovery/runtime.js';
import { EventStreamError } from '../protocol/event-cursor.js';
import { createLiveEvents } from './live-events.js';
import { diagnosticsData, readEventPage } from './diagnostics.js';
import { observePendingControl } from './control-observation.js';
import type { CoreDependencies } from './runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import { makeDeadline, systemClock } from '../ports/clock.js';
import { foundationError, type SafeError } from '../domain/errors.js';
import { drainFoundationAuxiliaries } from './foundation-auxiliary-policy.js';
import { createDaemonLauncher } from '../platform/macos/launcher.js';
import { createProcessIdentity } from '../platform/macos/process-identity.js';
import { join } from 'node:path';
import type { DaemonIntent, LeaseHandle, LocalRole, LocalServer } from '../ports/platform.js';
import type { StoragePort, StoreSnapshot } from '../ports/storage.js';
import { createPlatformPaths } from '../platform/macos/paths.js';
import { createOwnershipLease } from '../platform/macos/lease.js';
import { createLocalTransport } from '../platform/macos/transport.js';
import { openStorage } from '../storage/worker.js';
import { createOperations, authorizePrepareStop } from './operations.js';
import { requireUuid } from '../domain/identifiers.js';
import { isEntrypoint, readBootstrap, reportBootstrap } from './entrypoint.js';
import { classifyError } from './control-main.js';
import { createProjectOperations } from './projects/operations.js';
import { interruptProjectOperations } from './projects/recovery.js';
import { drainProjectOperations } from './lifecycle.js';
import { createProbeSupervisor } from '../platform/macos/git/probe-supervisor.js';
import { createGitRunner } from '../platform/macos/git/runner.js';
import { createProjectDispatch, PROJECT_METHODS } from './projects/dispatch.js';
import { removeProject } from './projects/remove.js';
import { updateProject } from './projects/update.js';
import { verifyProject } from './projects/verify.js';
import { registerProject } from './projects/register.js';
import { createFilesystemIdentity } from '../platform/macos/git/filesystem-identity.js';

export async function runDaemon(intent: DaemonIntent, dependencies: CoreDependencies = {}): Promise<void> {
  const checkpoint = dependencies.checkpoint ?? (async () => {});
  const report = dependencies.report ?? reportBootstrap;
  let lease: LeaseHandle | undefined;
  let store: StoragePort | undefined;
  let server: LocalServer | undefined;
  const ignoreHangup = () => {};
  process.on('SIGHUP', ignoreHangup);
  let onShutdownSignal: (() => void) | undefined;
  try {
    requireUuid(intent.instanceId); requireUuid(intent.ticketId);
    if (typeof intent.canonicalStateDir !== 'string' || !/^[0-9]{1,19}$/.test(intent.generation)) throw new Error('INVALID_REQUEST');
    const adapter = createPlatformPaths();
    const paths = await adapter.resolveArchive(intent.canonicalStateDir, 'read');
    if (!paths) throw new Error('STATE_CORRUPT');
    const lock = createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon');
    if (lock.status !== 'HELD') throw new Error('BLOCKED');
    lease = lock.handle;
    const storage = await (dependencies.storage ?? openStorage)({ path: paths.stateFile });
    store = storage;
    let volatileError: SafeError | null = null;
    let lastSnapshot: StoreSnapshot | null = null;
    let streams: ReturnType<typeof createLiveEvents> | undefined;
    let projects: ReturnType<typeof createProjectOperations> | undefined;
    let review:ReturnType<typeof createReviewRuntime>|undefined;
    let scheduler:ReturnType<typeof createSchedulerRuntime>|undefined;
    let execution:ReturnType<typeof createExecutionRuntime>|undefined;
    let profiles:ReturnType<typeof createProfileRuntime>|undefined;
    let environments:ReturnType<typeof createEnvironmentRuntime>|undefined;
    let workspaces:ReturnType<typeof createWorkspaceRuntime>|undefined;
    let features: ReturnType<typeof createFeatureRuntime> | undefined;
    let discovery: ReturnType<typeof createDiscoveryRuntime> | undefined;
    storage.onFailure(error => { volatileError = error; streams?.closeAll('PERSISTENCE_UNAVAILABLE'); void projects?.shutdown(); discovery?.fence(); features?.fence(); workspaces?.fence(); environments?.fence(); profiles?.fence(); execution?.fence(); scheduler?.fence(); review?.fence(); });
    const ticket = await storage.getTicket(intent.ticketId);
    if (!ticket || ticket.instanceId !== intent.instanceId || ticket.generation !== intent.generation
      || !await createOperations(storage, paths.ownerUid).claimLaunch(intent.ticketId, intent.generation, process.pid)) {
      throw new Error('STALE_TARGET');
    }
    await checkpoint('daemon.claimed');
    await storage.recordInstance({ instanceId: intent.instanceId, pid: process.pid, generation: intent.generation,
      lifecycle: 'STARTING', startedAt: new Date().toISOString(), shutdownPrepared: false, lastError: null });
    lastSnapshot = await storage.readSnapshot();
    await checkpoint('daemon.recorded');
    const clientKey = await adapter.readCredential(paths.clientKeyFile);
    streams = createLiveEvents(storage, intent.instanceId);
    projects = createProjectOperations({ storage, ownerUid: paths.ownerUid, instanceId: intent.instanceId,
      checkpoint,
      supervisor: createProbeSupervisor({ paths, onResource: resource => storage.saveResource(resource) }),
      execute: dependencies.projectExecute ?? (context => context.operation.action === 'REMOVE' ? removeProject(context, storage) : context.operation.action === 'UPDATE' ? updateProject(context, storage, createFilesystemIdentity()) : context.operation.action === 'VERIFY' ? verifyProject(context, storage, createFilesystemIdentity()) : registerProject(context, storage, createFilesystemIdentity())),
      onBlocked: error => {
        void storage.blockInstance(intent.instanceId, { ...error, persisted: true }).catch(() => {
          volatileError ??= foundationError('PERSISTENCE_UNAVAILABLE');
        });
      } });
    const inspection = await createGitRunner().capabilities();
    discovery = createDiscoveryRuntime(storage, paths, intent.instanceId, dependencies.discovery);
    features = createFeatureRuntime(storage, paths, intent.instanceId, { currentEligibility: (peer, projectId) => discovery!.operations.currentEligibility(peer, projectId),
      ...(dependencies.featurePlanning ? { planning: dependencies.featurePlanning } : {}) });
    workspaces=createWorkspaceRuntime(storage,dependencies.workspaces??nativeWorkspaceServices({
      storage,paths,instanceId:intent.instanceId,currentEligibility:(peer,projectId)=>discovery!.operations.currentEligibility(peer,projectId),
      ...(dependencies.workspaceFiles?{files:dependencies.workspaceFiles}:{}),
    }));
    const reviewGit=dependencies.review??(workspaces.leases?nativeReviewGit(createWorkspaceMutator(),workspaces.leases.owned):undefined);
    const environmentCompose=dependencies.environments??(workspaces.leases?nativeEnvironmentServices({
      storage,instanceId:intent.instanceId,paths,owned:workspaces.leases.owned,lease:workspaces.leases.forConsumer('ENVIRONMENT'),
      ...(reviewGit?{readValidationTree:async workspace=>(await reviewGit.captureCheckpoint(workspace)).treeDigest}:{}),
    }):undefined);
    environments=createEnvironmentRuntime({storage,instanceId:intent.instanceId,...(environmentCompose?{compose:environmentCompose}:{})});
    profiles=createProfileRuntime({storage,paths,instanceId:intent.instanceId,native:true,...dependencies.profiles});
    execution=createExecutionRuntime({storage,paths,instanceId:intent.instanceId,
      currentEligibility:(peer,projectId)=>discovery!.operations.currentEligibility(peer,projectId),
      ...(workspaces.leases?{lease:workspaces.leases.forConsumer('RUN')}:{}) ,
      ...(dependencies.execution?{dependencies:dependencies.execution}:{})});
    scheduler=createSchedulerRuntime({storage,paths,instanceId:intent.instanceId,...dependencies.scheduler});
    review=createReviewRuntime({storage,paths,instanceId:intent.instanceId,currentEligibility:(peer,projectId)=>discovery!.operations.currentEligibility(peer,projectId),
      ...(reviewGit?{readGit:reviewGit}:{}),...(environments.runDelegatedCheck?{runCheck:environments.runDelegatedCheck}:{}),
      ...(workspaces.files?{integration:nativeReviewIntegration(workspaces.files)}:{})});
    const capabilities = { ...((lastSnapshot?.store.schemaVersion??0)>=11&&storage.readReviewState?{reviewVersion:1,reviewMethods:review.methods}:{}), ...((lastSnapshot?.store.schemaVersion??0)>=10&&storage.readSchedulerState?{schedulerVersion:1,schedulerMethods:scheduler.methods}:{}), ...((lastSnapshot?.store.schemaVersion??0)>=9&&storage.readExecutionState?{executionVersion:1,executionMethods:execution.methods}:{}), ...((lastSnapshot?.store.schemaVersion??0)>=8?{profileVersion:1,profileMethods:profiles.methods}:{}), ...((lastSnapshot?.store.schemaVersion??0)>=7?{environmentVersion:1,environmentMethods:environments.methods}:{}), ...((lastSnapshot?.store.schemaVersion??0)>=6?{workspaceVersion:1,workspaceMethods:workspaces.methods}:{}), ...((lastSnapshot?.store.schemaVersion ?? 0) >= 5 ? {featureVersion: 1, featureMethods: features.methods} : {}), discoveryVersion: 1, discoveryMethods: discovery.methods, projectRegistryVersion: 1, projectRegistryMethods: PROJECT_METHODS, gitInspection: inspection };
    const discoveryDispatch = discovery.dispatch;
    const projectDispatch = createProjectDispatch({ operations: projects, storage });
    let draining = false;
    let deniedCount = 0, lastDeniedAudit = -Infinity;
    async function auditDenied(correlationId: string, code: 'UNAUTHORIZED' | 'STALE_TARGET') {
      deniedCount = Math.min(65535, deniedCount + 1);
      if (performance.now() - lastDeniedAudit < 1_000) return;
      lastDeniedAudit = performance.now();
      const count = deniedCount; deniedCount = 0;
      await storage.recordEvents([{type: 'authorization.denied', instanceId: intent.instanceId,
        payload: {correlationId, code, count}}]).catch(() => {});
    }
    server = await createLocalTransport().listen(paths.daemonEndpoint, intent.instanceId, async () => {
      const keys = new Map<string, LocalRole>([[clientKey, 'client']]);
      if (volatileError) return keys;
      const snapshot = await storage.readSnapshot();
      const pending = snapshot?.pendingOperation;
      if (pending && (pending.successorInstanceId === intent.instanceId || pending.targetInstanceId === intent.instanceId)) {
        const attempt = await storage.getControllerAttempt(pending.requestId);
        if (attempt && attempt.endedAt === null) {
          const key = await adapter.readCredential(join(paths.credentialsDirectory, `controller-${attempt.attemptId}.key`));
          keys.set(key, 'controller');
        }
      }
      return keys;
    }, async (request, peer) => {
      if (volatileError) {
        const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
        if(request.method==='review.operation.get'&&lastSnapshot)return review!.dispatch(request,peer,lastSnapshot);
        if(request.method==='scheduler.operation.get'&&lastSnapshot)return scheduler!.dispatch(request,peer,lastSnapshot);
        if(request.method==='execution.operation.get'&&lastSnapshot)return execution!.dispatch(request,peer,lastSnapshot);
        if(request.method==='profile.operation.get'&&lastSnapshot)return profiles!.dispatch(request,peer,lastSnapshot);
        if(request.method==='environment.operation.get'&&lastSnapshot)return environments!.dispatch(request,peer,lastSnapshot);
        if (request.method === 'workspace.operation.get' && lastSnapshot) return workspaces!.dispatch(request,peer,lastSnapshot);
        if (request.method === 'feature.operation.get' && lastSnapshot) return features!.dispatch(request, peer, lastSnapshot);
        if (request.method === 'discovery.operation.get' && lastSnapshot) return discoveryDispatch(request, peer, lastSnapshot);
        if (request.method === 'projects.operation.get' && lastSnapshot) return projectDispatch(request, peer, lastSnapshot);
        if (request.method !== 'status.get') return { ...base, result: 'BLOCKED', data: { code: 'PERSISTENCE_UNAVAILABLE' } };
        return { ...base, result: 'OK', data: { storeId: lastSnapshot?.store.storeId, instanceId: intent.instanceId,
          pid: process.pid, generation: intent.generation, lifecycle: 'BLOCKED', ready: false, freshness: 'VOLATILE',
          capabilities,
          revision: lastSnapshot?.store.revision, lastError: volatileError, currentOperation: lastSnapshot?.pendingOperation,
          resourceIssues: [], pendingFinalization: true } };
      }
      const snapshot = await storage.readSnapshot();
      lastSnapshot = snapshot;
      const instance = snapshot?.instance;
      if (!snapshot || !instance || instance.instanceId !== intent.instanceId) throw new Error('STATE_CORRUPT');
      const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
      if (request.method === 'status.get') return { ...base, result: 'OK' as const, data: {
        storeId: snapshot.store.storeId, instanceId: instance.instanceId, pid: instance.pid,
        capabilities,
        generation: instance.generation, lifecycle: instance.lifecycle, ready: instance.lifecycle === 'RUNNING',
        revision: snapshot.store.revision, currentOperation: snapshot.pendingOperation,
        observability: await storage.getEventState(), lastError: instance.lastError, ...await observePendingControl(snapshot, storage, createProcessIdentity()),
        resourceIssues: instance.lifecycle === 'BLOCKED' ? (await storage.listResources(instance.instanceId))
          .filter(resource => resource.releaseState !== 'RELEASED').map(resource => ({ resourceId: resource.resourceId,
            kind: resource.kind, observation: resource.observation, releaseState: resource.releaseState })) : [],
      } };
      if(request.method.startsWith('review.'))return review!.dispatch(request,peer,snapshot);
      if(request.method.startsWith('scheduler.'))return scheduler!.dispatch(request,peer,snapshot);
      if(request.method.startsWith('execution.'))return execution!.dispatch(request,peer,snapshot);
      if(request.method.startsWith('profile.'))return profiles!.dispatch(request,peer,snapshot);
      if(request.method.startsWith('environment.'))return environments!.dispatch(request,peer,snapshot);
      if (request.method.startsWith('workspace.')) return workspaces!.dispatch(request,peer,snapshot);
      if (request.method.startsWith('feature.')) return features!.dispatch(request, peer, snapshot);
      if (request.method.startsWith('discovery.')) return discoveryDispatch(request, peer, snapshot);
      if (request.method.startsWith('projects.')) return projectDispatch(request, peer, snapshot);
      if (request.method === 'diagnostics.get' || request.method === 'events.list') {
        try {
          const data = request.method === 'diagnostics.get' ? await diagnosticsData(storage, snapshot, projects?.diagnostics())
            : {events: await readEventPage(storage, snapshot.store.storeId, request.params)};
          return {...base, result: 'OK', data: {storeId: snapshot.store.storeId, ...data, ...(request.method === 'diagnostics.get' ? {subscriptions: streams!.diagnostics()} : {})}};
        } catch (error) { return {...base, result: 'ERROR', data: {code: classifyError(error), ...(error instanceof EventStreamError && error.gap ? error.gap : {})}}; }
      }
      if (request.method === 'events.subscribe' || request.method === 'subscription.close') return streams!.dispatch(request, peer, snapshot.store.storeId);
      if (request.method === 'internal.readiness') {
        if (peer.role !== 'controller') {
          await auditDenied(request.correlationId, 'UNAUTHORIZED');
          return { ...base, result: 'ERROR', data: { code: 'UNAUTHORIZED' } };
        }
        if (request.params.expectedInstanceId !== intent.instanceId || request.params.launchGeneration !== intent.generation) {
          return { ...base, result: 'ERROR', data: { code: 'STALE_TARGET' } };
        }
        return { ...base, result: 'OK', data: { identity: intent.instanceId, generation: intent.generation,
          ready: instance.lifecycle === 'RUNNING' } };
      }
      if (request.method === 'internal.prepareStop') {
        const pending = snapshot.pendingOperation;
        const attempt = pending ? await storage.getControllerAttempt(pending.requestId) : null;
        let currentCredential = false;
        if (attempt && attempt.endedAt === null) {
          const key = await adapter.readCredential(join(paths.credentialsDirectory, `controller-${attempt.attemptId}.key`));
          currentCredential = peer.credentialId === createHash('sha256').update(key).digest('hex');
        }
        const controlLease = createOwnershipLease().tryAcquire(paths.controlLeaseFile, 'control');
        if (controlLease.status === 'HELD') controlLease.handle.release();
        try {
          authorizePrepareStop({ role: peer.role, currentCredential, controlLeaseHeld: controlLease.status === 'BUSY',
            instance, operation: pending, params: request.params });
        } catch (error) {
          await auditDenied(request.correlationId, classifyError(error) === 'STALE_TARGET' ? 'STALE_TARGET' : 'UNAUTHORIZED');
          return { ...base, result: 'ERROR', data: { code: classifyError(error) } };
        }
        if (draining) return { ...base, result: 'OK', data: { preparingStop: true } };
        draining = true;
        const drainDeadline = makeDeadline(systemClock, 8_000);
        // Fence synchronously before publishing STOPPING; accepted work is independent of the RPC.
        void projects!.shutdown();
        discovery!.fence(); features!.fence();workspaces!.fence();environments!.fence();profiles!.fence();execution!.fence();scheduler!.fence();review!.fence();
        try { await storage.transitionInstance(intent.instanceId, 'STOPPING'); }
        catch (error) { draining = false; throw error; }
        setImmediate(() => {
          void (async () => {
            await drainProjectOperations(projects!, drainDeadline);
            await Promise.all([discovery!.stop(drainDeadline), features!.stop(drainDeadline),workspaces!.stop(drainDeadline),environments!.stop(drainDeadline),profiles!.stop(drainDeadline),execution!.stop(drainDeadline),scheduler!.stop(drainDeadline),review!.stop(drainDeadline)]);
            await drainFoundationAuxiliaries({ store: storage, instanceId: intent.instanceId, paths,
              identity: createProcessIdentity(), transport: createLocalTransport(), platformPaths: adapter,
              deadline: drainDeadline, excludedPids: [process.pid, attempt!.pid],
              sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            });
            await storage.prepareShutdown(intent.instanceId, intent.generation);
            await checkpoint('daemon.shutdownPrepared');
            streams!.closeAll();
            await server!.close();
            await storage.close();
            // Keep the main ownership lease until the actual process terminates.
            process.exit(0);
          })().catch(async error => {
            draining = false;
            await storage.blockInstance(intent.instanceId, foundationError(classifyError(error), { persisted: true,
              operationId: pending!.requestId })).catch(() => { report(false, 'PERSISTENCE_UNAVAILABLE'); });
          });
        });
        return { ...base, result: 'OK', data: { preparingStop: true } };
      }
      return { ...base, result: 'ERROR', data: { code: 'INVALID_REQUEST' } };
    });
    await storage.transitionInstance(intent.instanceId, 'RECOVERING');
    await checkpoint('daemon.recovering');
    const pending = (await storage.readSnapshot())?.pendingOperation;
    const controller = pending ? await storage.getControllerAttempt(pending.requestId) : null;
    await drainFoundationAuxiliaries({ store: storage, instanceId: intent.instanceId, paths,
      identity: createProcessIdentity(), transport: createLocalTransport(), platformPaths: adapter,
      deadline: makeDeadline(systemClock, 8_000), excludedPids: [process.pid, ...(controller ? [controller.pid] : [])],
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    });
    await interruptProjectOperations(storage, new Date().toISOString());
    await checkpoint('daemon.projectsRecovered');
    await discovery.recover();
    await features.recover();
    await workspaces.recover();
    await environments.recover();
    profiles.start();
    await execution.recover();
    await scheduler.recover();
    await review.recover();
    await storage.transitionInstance(intent.instanceId, 'RUNNING');
    review.start();
    lastSnapshot = await storage.readSnapshot();
    await checkpoint('daemon.running');
    let signalPending = false;
    onShutdownSignal = () => {
      if (signalPending || draining) return;
      signalPending = true;
      void (async () => {
        const pending = (await storage.readSnapshot())?.pendingOperation;
        // An accepted stop/restart already owns the shutdown; signals add no new effects.
        if (pending && ['stop', 'restart'].includes(pending.action) && pending.targetInstanceId === intent.instanceId) return;
        const controller = await createDaemonLauncher().spawnController({ protocolVersion: 1,
          requestId: randomUUID(), action: 'stop', canonicalStateDir: paths.directory });
        const bootstrap = await controller.bootstrap;
        if (bootstrap && !bootstrap.accepted) {
          await storage.recordInstanceError(intent.instanceId, foundationError(classifyError(new Error(bootstrap.errorCode)), { persisted: true }));
        }
        await controller.exit;
      })().catch(async error => {
        await storage.recordInstanceError(intent.instanceId, foundationError(classifyError(error), { persisted: true })).catch(() => {});
      }).finally(() => { signalPending = false; });
    };
    process.on('SIGTERM', onShutdownSignal);
    process.on('SIGINT', onShutdownSignal);
    report(true);
    // The listening server keeps the process alive; the ownership connection remains held.
  } catch (error) {
    process.off('SIGHUP', ignoreHangup);
    if (onShutdownSignal) { process.off('SIGTERM', onShutdownSignal); process.off('SIGINT', onShutdownSignal); }
    await server?.close();
    try { await store?.close(); } finally { lease?.release(); }
    throw error;
  }
}

if (isEntrypoint(import.meta.url)) {
  try { await runDaemon(await readBootstrap() as unknown as DaemonIntent); }
  catch (error) { reportBootstrap(false, classifyError(error)); process.exitCode = 7; }
}
