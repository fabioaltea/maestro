import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {intersectProfilePermissions} from '../../src/domain/profiles/permissions.js';

test('deny wins and tool manifests cannot smuggle executable paths or credential values',async()=>{
 const {parseToolManifest,requireToolEnable}=await import(new URL('../../src/domain/profiles/tools.js',import.meta.url).href);
 assert.deepEqual(intersectProfilePermissions([{allow:['WORKSPACE_READ','TOOL_LOCAL'],deny:[]},{allow:['TOOL_LOCAL'],deny:['TOOL_LOCAL']}]),[]);
 const manifest={alias:'check',title:'Check',version:'1.0.0',kind:'LOCAL_COMMAND',commandSpecId:randomUUID(),
   argvSchema:[],inputBytes:1024,outputBytes:8192,requiredPermissions:['TOOL_LOCAL'],credentialRequirements:[],networkScope:'OFFLINE'};
 const parsed=parseToolManifest(manifest);
 assert.deepEqual(requireToolEnable(parsed,['TOOL_LOCAL']),['TOOL_LOCAL']);
 assert.throws(()=>requireToolEnable(parsed,['TOOL_LOCAL','WORKSPACE_WRITE']),/PERMISSION_CONFLICT/);
 for(const extra of [{executable:'/usr/bin/sh'},{credentialRequirements:[{name:'TOKEN',value:'bad'}]},{commandSpecId:'/usr/bin/sh'},{kind:'MCP'}])
   assert.throws(()=>parseToolManifest({...manifest,...extra}),/INVALID_REQUEST|INVALID_IDENTIFIER|PERMISSION_CONFLICT/);
});
