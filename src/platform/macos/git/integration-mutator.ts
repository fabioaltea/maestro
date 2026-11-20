import type {GitIntegrationPort} from '../../../ports/review.js';
import {createWorkspaceMutator} from './workspace-mutator.js';

/** Local Git effects remain behind the same anchored, pinned adapter as workspace ownership. */
export function createIntegrationMutator(options:{checkpoint?:(point:'ref.intent'|'ref.updated')=>void}={}):GitIntegrationPort{
 const workspace=createWorkspaceMutator({integrationCheckpoint:options.checkpoint??(()=>{})});
 return{qualification:workspace.qualification,...workspace.integration};
}
