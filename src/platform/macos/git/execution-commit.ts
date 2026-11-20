import {makeDeadline,systemClock} from '../../../ports/clock.js';
import type {WorkspacePort,WorkspaceRecord} from '../../../ports/workspace.js';
import type {ExecutionCheckpointInput} from '../../../ports/execution-runtime.js';

/** Seals portable evidence through the same pinned Git reader used by workspaces. */
export function createExecutionCheckpointCapture(git:WorkspacePort,owned:(workspace:WorkspaceRecord)=>Promise<NonNullable<WorkspaceRecord['ownership']>>){
 return async(workspace:WorkspaceRecord):Promise<ExecutionCheckpointInput>=>{
   if(!git.captureCheckpoint||workspace.state!=='READY')throw new Error('CHECKPOINT_STALE');
   const root=await owned(workspace);
   return git.captureCheckpoint(workspace.target,root,makeDeadline(systemClock,8000));
 };
}
