import assert from 'node:assert/strict';
import test from 'node:test';
import {createCodexExecutionDecoder} from '../../src/providers/codex/execution-parser.js';
import {createClaudeExecutionDecoder} from '../../src/providers/claude/execution-parser.js';
import {executionInteractionText} from '../../src/domain/execution/interaction.js';

test('bounded provider decoding preserves split UTF-8 and rejects unbrokered requests',()=>{
 const text=Buffer.from(JSON.stringify({method:'item/agentMessage/delta',params:{delta:'Città'}})+'\n');
 const at=text.lastIndexOf(0xc3)+1,decoder=createCodexExecutionDecoder();
 assert.deepEqual(decoder.feed(text.subarray(0,at)),[]);
 assert.deepEqual(decoder.feed(text.subarray(at)),[{kind:'TEXT',text:'Città'}]);
 assert.throws(()=>decoder.feed(Buffer.from('{"id":7,"method":"item/commandExecution/requestApproval","params":{}}\n')),/TOOL_PERMISSION_REQUIRED/);
 assert.throws(()=>decoder.feed(text),/PROVIDER_PROTOCOL_ERROR/);
 const claude=createClaudeExecutionDecoder();
 assert.throws(()=>claude.feed(Buffer.from('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta"}}}\n')),/TOOL_PERMISSION_REQUIRED/);
});

test('interaction text rejects unsupported control characters and byte overflow',()=>{
 assert.equal(executionInteractionText('a'.repeat(4096)).length,4096);
 assert.throws(()=>executionInteractionText('à'.repeat(2049)),/INVALID_REQUEST|CONTEXT_LIMIT/);
 assert.throws(()=>executionInteractionText('status\u001b[2J'),/INVALID_REQUEST/);
});
