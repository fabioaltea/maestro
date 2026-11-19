import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {requireCurrentFeatureApproval,envelopeContent} from '../../src/domain/features/approval.js';
import {requireApprovableBundle} from '../../src/domain/features/bundle.js';
import {featureDraft} from '../fixtures/feature-boundary.js';
import type {FeatureRecord,FeatureRevision,FeatureApproval} from '../../src/domain/features/model.js';
import type {FeatureBundle} from '../../src/ports/feature.js';
import type {FeatureContextProof} from '../../src/ports/feature.js';
test('US2 approval matches exact current revision, project, Discovery and owner-bound immutable references',()=>{
 const feature:FeatureRecord={featureId:randomUUID(),projectId:randomUUID(),title:'fixture',state:'APPROVED',stateRevision:'2',currentRevisionId:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archivedAt:null};
 const revision:FeatureRevision={featureId:feature.featureId,revisionId:feature.currentRevisionId,revisionNumber:'1',parentRevisionId:null,artifactId:randomUUID(),bundleDigest:'a'.repeat(64),discoveryApprovalId:randomUUID(),discoveryRevisionId:randomUUID(),contextDigest:'b'.repeat(64),configRevision:'1',createdAt:feature.createdAt};
 const proof:FeatureContextProof={projectId:feature.projectId,configRevision:'1',discoveryApprovalId:revision.discoveryApprovalId,discoveryRevisionId:revision.discoveryRevisionId,contextDigest:revision.contextDigest,checkedAt:feature.updatedAt};
 const approval:FeatureApproval={approvalId:randomUUID(),requestId:randomUUID(),featureId:feature.featureId,revisionId:revision.revisionId,bundleDigest:revision.bundleDigest,discoveryApprovalId:proof.discoveryApprovalId,contextDigest:proof.contextDigest,configRevision:'1',acceptedUnknownIds:[],ownerUid:501,approvedAt:feature.updatedAt};
 assert.doesNotThrow(()=>requireCurrentFeatureApproval(feature,revision,approval,proof,501));
 for(const a of [null,{...approval,revisionId:randomUUID()},{...approval,ownerUid:502},{...approval,bundleDigest:'c'.repeat(64)}])assert.throws(()=>requireCurrentFeatureApproval(feature,revision,a,proof,501));
 assert.throws(()=>requireCurrentFeatureApproval({...feature,state:'NEEDS_REVIEW'},revision,approval,proof,501));
 assert.throws(()=>requireCurrentFeatureApproval(feature,revision,approval,{...proof,projectId:randomUUID()},501));
 const content=envelopeContent(feature,revision,approval);assert.equal(content.projectId,feature.projectId);assert.equal(content.approvalId,approval.approvalId);assert.ok(!JSON.stringify(content).includes('grant'));
});
test('US2 blocking unknowns cannot be accepted; nonblocking unknowns require exact explicit consent and story coverage',()=>{
 const b:FeatureBundle={...featureDraft(),unknowns:[{unknownId:'u',text:'decision pending',impact:'BLOCKING',decision:'OPEN'}]};assert.throws(()=>requireApprovableBundle(b,['u']));const allowed:FeatureBundle={...b,unknowns:[{...b.unknowns[0]!,impact:'NON_BLOCKING'}]};assert.throws(()=>requireApprovableBundle(allowed,[]));assert.doesNotThrow(()=>requireApprovableBundle(allowed,['u']));assert.throws(()=>requireApprovableBundle(allowed,['u','forged']));assert.throws(()=>requireApprovableBundle({...allowed,acceptanceCriteria:[]},['u']));
});
