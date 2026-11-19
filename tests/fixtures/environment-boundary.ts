import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import type {TestContext} from 'node:test';
import {createFilesystemIdentity} from '../../src/platform/macos/git/filesystem-identity.js';
import {createTestContext} from './test-context.js';

export const fixturePackage='maestro-env-fixture';
export const fixtureVersion='9.4.0';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function tarEntry(name:string,text:string){
 const body=Buffer.from(text),header=Buffer.alloc(512);
 function octal(value:number,offset:number,width:number){header.write(value.toString(8).padStart(width-1,'0')+'\0',offset,width,'ascii');}
 header.write(name,0,100,'ascii');octal(0o644,100,8);octal(0,108,8);octal(0,116,8);octal(body.length,124,12);octal(0,136,12);
 header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,6,'ascii');header.write('00',263,2,'ascii');
 header.write(header.reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
 return Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512)]);
}
export async function fixtureRegistry(t:TestContext,holdResponse=false){
 const manifest={name:fixturePackage,version:'1.0.0',scripts:{postinstall:'node ./forbidden.cjs'}};
 const archive=gzipSync(Buffer.concat([
   tarEntry('package/package.json',JSON.stringify(manifest)),
   tarEntry('package/value.txt','clean fixture\n'),
   tarEntry('package/forbidden.cjs',"require('node:fs').writeFileSync('executed-script','wrong')"),
   Buffer.alloc(1024),
 ]));
 const integrity='sha512-'+createHash('sha512').update(archive).digest('base64');
 const archiveUrl=`/${fixturePackage}/-/${fixturePackage}-1.0.0.tgz`;
 let origin='',requests=0,gotRequest!:()=>void;
 const requested=new Promise<void>(resolve=>{gotRequest=resolve;});
 const server=createServer((req,res)=>{
   requests++;gotRequest();
   if(holdResponse)return;
   if(req.url===archiveUrl){res.writeHead(200,{'content-type':'application/octet-stream','content-length':archive.length});res.end(archive);return;}
   if(req.url===`/${fixturePackage}`){
     res.setHeader('Content-Type','application/json');
     res.end(JSON.stringify({name:fixturePackage,'dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{...manifest,dist:{integrity,tarball:origin+archiveUrl}}}}));
     return;
   }
   res.writeHead(404);res.end();
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const bound=server.address();assert.ok(bound&&typeof bound==='object');
 origin=`http://127.0.0.1:${bound.port}`;
 t.after(()=>{server.closeAllConnections();return new Promise<void>(resolve=>server.close(()=>resolve()));});
 return{origin,tarball:origin+archiveUrl,integrity,requested,requests:()=>requests};
}

export async function environmentBoundaryFixture(t:TestContext,held=false){
 const context=await createTestContext(t);
 const registry=await fixtureRegistry(t,held);
 const identity=createFilesystemIdentity();
 const stateRoot=join(context.directory,'environment-store'),scratchRoot=join(context.directory,'scratch');
 await mkdir(stateRoot,{mode:0o700});await mkdir(scratchRoot,{mode:0o700});
 const store=await identity.capture(stateRoot,'directory');
 async function workspace(name:string,source=registry){
   assert.match(name,/^[a-z]+$/);
   const path=join(context.directory,name),scratchPath=join(scratchRoot,name);
   await mkdir(path,{mode:0o700});await mkdir(scratchPath,{mode:0o700});
   const lockPath=join(path,'pnpm-lock.yaml'),manifestPath=join(path,'package.json');
   await writeFile(manifestPath,JSON.stringify({name:'fixture-project',private:true,packageManager:`pnpm@${fixtureVersion}`,
     dependencies:{[fixturePackage]:'1.0.0'},scripts:{postinstall:'node ./forbidden.cjs'}},null,2)+'\n');
   await writeFile(join(path,'forbidden.cjs'),"require('node:fs').writeFileSync('executed-script','wrong')");
   const lockText=`lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
  .:
    dependencies:
      ${fixturePackage}:
        specifier: 1.0.0
        version: 1.0.0

packages:
  ${fixturePackage}@1.0.0:
    resolution: {integrity: ${source.integrity}, tarball: ${source.tarball}}

snapshots:
  ${fixturePackage}@1.0.0: {}
`;
   await writeFile(lockPath,lockText);
   const anchor=await identity.capture(path,'directory'),scratch=await identity.capture(scratchPath,'directory');
   async function scope(){return{workspace:anchor,store,scratch,registryOrigin:registry.origin,
     manifestDigest:hash(await readFile(manifestPath)),lockDigest:hash(await readFile(lockPath))};}
   return{path,lockPath,manifestPath,scope,contents:join(path,'node_modules',fixturePackage,'value.txt')};
 }
 return{workspace,registry,stateRoot};
}
