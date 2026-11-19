import {readFile} from 'node:fs/promises';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import type {WorkspaceMutationTarget} from '../../src/ports/workspace.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';

const path=process.argv[2];
if(!path)throw new Error('MISSING_OWNED_FIXTURE');
const {point,request}=JSON.parse(await readFile(path,'utf8')) as {point:'before-add'|'after-add';request:WorkspaceMutationTarget};
const deadline=()=>makeDeadline(systemClock,5000);
const adapter=createWorkspaceMutator();
process.on('message',(message:{type?:string})=>{if(message.type==='maestro-test-shutdown')process.exit(86);});
await adapter.createBranch(request,deadline());
if(point==='after-add')await adapter.addWorktree(request,deadline());
process.send?.(point);
