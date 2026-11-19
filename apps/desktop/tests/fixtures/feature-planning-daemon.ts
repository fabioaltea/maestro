import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import type {FeaturePlanningPort} from '../../../../src/ports/feature-planning.ts';
import {repositoryRoot} from './desktop.ts';

const archive=process.argv[2];
if(archive){
  const {runControl}=await import(join(repositoryRoot,'dist/core/control-main.js'));
  const {createDaemonLauncher}=await import(join(repositoryRoot,'dist/platform/macos/launcher.js'));
  process.exitCode=await runControl({protocolVersion:1,action:'start',requestId:randomUUID(),canonicalStateDir:archive},
    {launcher:createDaemonLauncher({daemonFile:fileURLToPath(import.meta.url)})});
}else{
  const {runDaemon}=await import(join(repositoryRoot,'dist/core/daemon-main.js'));
  const {readBootstrap}=await import(join(repositoryRoot,'dist/core/entrypoint.js'));
  const featurePlanning:FeaturePlanningPort={
    capabilities:{readonlyPlanning:true,qualified:true},
    async check(){},
    async cancel(identity){return{...identity,hostExited:true,providerExited:true};},
    async reconcile(){return null;},
    async run({identity,bundle,answers}){
      const answer=answers.at(-1);
      return{
        exit:{...identity,hostExited:true,providerExited:true},
        value:answer?{kind:'DRAFT',bundle:{...bundle,implementationPlan:{...bundle.implementationPlan,approach:'Piano del turno: '+answer.text},
          provenance:[{kind:'USER_CONFIRMED',text:'Conferma dell’utente',sourceId:null,answerId:answer.answerId}]}}
        :{kind:'QUESTIONS',questions:[{questionId:'Q1',text:'Quale stato mostrare?',reason:'Serve una scelta esplicita.'}]},
      };
    },
  };
  await runDaemon(await readBootstrap(),{featurePlanning});
}
