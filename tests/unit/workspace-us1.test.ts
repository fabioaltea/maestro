import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

import {requireProvisioningObservation,workspaceBranchRef} from '../../src/domain/workspaces/provision.js';
test('provisioning binds an approved local base and the generated workspace identity',()=>{
 const featureId=randomUUID(),workspaceId=randomUUID(),baseOid='a'.repeat(40);
 assert.equal(workspaceBranchRef(featureId,workspaceId),`refs/heads/maestro/feature/${featureId}/${workspaceId}`);
 const initial={baseOid,branchOid:null,worktree:null};
 assert.doesNotThrow(()=>requireProvisioningObservation(baseOid,initial,'ABSENT'));
 assert.throws(()=>requireProvisioningObservation(baseOid,{...initial,baseOid:'b'.repeat(40)},'ABSENT'),/BASE_CHANGED/);
 assert.throws(()=>requireProvisioningObservation(baseOid,{...initial,branchOid:baseOid},'ABSENT'),/BRANCH_EXISTS/);
 assert.throws(()=>requireProvisioningObservation(baseOid,initial,'BRANCH_CREATED'),/OWNERSHIP_UNPROVEN/);
 assert.doesNotThrow(()=>requireProvisioningObservation(baseOid,{...initial,branchOid:baseOid},'BRANCH_CREATED'));
});
