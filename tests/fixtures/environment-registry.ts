import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {gzipSync} from 'node:zlib';
export const fixturePackage='maestro-env-fixture';
export const fixtureVersion='9.4.0';
function tarEntry(name:string,text:string){
 const body=Buffer.from(text),header=Buffer.alloc(512);
 function octal(value:number,offset:number,width:number){header.write(value.toString(8).padStart(width-1,'0')+'\0',offset,width,'ascii');}
 header.write(name,0,100,'ascii');octal(0o644,100,8);octal(0,108,8);octal(0,116,8);octal(body.length,124,12);octal(0,136,12);
 header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,6,'ascii');header.write('00',263,2,'ascii');
 header.write(header.reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
 return Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512)]);
}
export async function startFixtureRegistry(holdResponse=false){
 const manifest={name:fixturePackage,version:'1.0.0',scripts:{postinstall:'node ./forbidden.cjs'}};
 const archive=gzipSync(Buffer.concat([
   tarEntry('package/package.json',JSON.stringify(manifest)),
   tarEntry('package/value.txt','clean fixture\n'),
   tarEntry('package/forbidden.cjs',"require('node:fs').writeFileSync('executed-script','wrong')"),
   Buffer.alloc(1024),
 ]));
 const integrity='sha512-'+createHash('sha512').update(archive).digest('base64');
 const archiveUrl=`/${fixturePackage}/-/${fixturePackage}-1.0.0.tgz`;
 let origin='',requests=0,redirect:string|null=null,gotRequest!:()=>void;
 const requested=new Promise<void>(resolve=>{gotRequest=resolve;});
 const server=createServer((req,res)=>{
   requests++;gotRequest();
   if(holdResponse)return;
   if(req.url===archiveUrl){
     if(redirect){res.writeHead(307,{location:redirect});res.end();}
     else{res.writeHead(200,{'content-type':'application/octet-stream','content-length':archive.length});res.end(archive);}
     return;
   }
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
 function close(){server.closeAllConnections();return new Promise<void>(resolve=>server.close(()=>resolve()));}
 return{origin,tarball:origin+archiveUrl,integrity,requested,requests:()=>requests,redirectTo:(target:string)=>{redirect=target;},close};
}
export function fixtureLock(source:{integrity:string;tarball:string}){
 return `lockfileVersion: '9.0'

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
}

