import {keys,uuid,text} from '../shared/validation.ts';
import {FEATURE_MUTATIONS} from '../shared/feature-contract.ts';
import type {CliCommand} from './ports.ts';
export function buildFeatureCliArgs(c:CliCommand):string[]{
 const p=c.params??{},args=['feature'];if((FEATURE_MUTATIONS as readonly string[]).includes(c.action))uuid(c.requestId);else if(c.requestId!==undefined)throw new Error('INVALID_INPUT');
 let target:string|undefined;
 if(c.action==='prepare'){args.push('prepare','--input-stdin');}
 else if(c.action==='artifact.import'){keys(p,['bundle']);args.push('artifact','import','--bundle-stdin');}
 else if(c.action==='artifact.get'){keys(p,['artifactId','cursor']);args.push('artifact','get');target=uuid(p.artifactId);}
 else if(c.action==='provider.get'){keys(p,[]);args.push('provider','get');}
 else if((FEATURE_MUTATIONS as readonly string[]).includes(c.action)){keys(p,['grantId']);args.push(c.action,`--grant=${uuid(p.grantId)}`);}
 else{const targets:Record<string,string>={list:'projectId',get:'featureId',revisions:'featureId',revision:'revisionId',approval:'revisionId',envelope:'envelopeId',eligibility:'featureId',operation:'requestId'};if(!Object.hasOwn(targets,c.action))throw new Error('INVALID_INPUT');const key=targets[c.action]!;keys(p,[key,...(['list','revisions'].includes(c.action)?['cursor','limit']:c.action==='eligibility'?['checkId']:[])]);args.push(c.action==='get'?'show':c.action);target=uuid(p[key]);if(p.checkId!==undefined)args.push(`--check-id=${uuid(p.checkId)}`);}
 if(p.limit!==undefined){if(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20)throw new Error('INVALID_INPUT');args.push(`--limit=${p.limit}`);}if(p.cursor!==undefined)args.push(`--cursor=${text(p.cursor,4096)}`);
 args.push(`--state-dir=${c.archive}`,'--json');if(c.requestId)args.push(`--request-id=${c.requestId}`);if(target)args.push('--',target);return args;
}
export function featureCliInput(c:CliCommand):string|null{
 if(c.namespace!=='feature'||!['prepare','artifact.import'].includes(c.action))return null;
 const json=c.action==='artifact.import'?c.params?.bundle:JSON.stringify(c.params);if(typeof json!=='string'||Buffer.byteLength(json)>(c.action==='artifact.import'?262144:32768))throw new Error('INVALID_INPUT');return json;
}
