import { createConnection, createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
const denied = process.argv.includes('--expect-denied');
const attempt = (kind) => new Promise(resolve => {
  const object = kind === 'bind' ? createServer() : createConnection({ host: '127.0.0.1', port: 9 });
  const timer = setTimeout(() => { object.close?.(); object.destroy?.(); resolve({ kind, result: 'TIMEOUT' }); }, 1000);
  object.once('error', error => { clearTimeout(timer); resolve({ kind, result: error.code }); });
  if (kind === 'bind') object.listen(0, '127.0.0.1', () => { clearTimeout(timer); object.close(() => resolve({ kind, result: 'ALLOWED' })); });
});
const results = await Promise.all([attempt('bind'), attempt('connect')]);
const child = spawnSync(process.execPath, ['-e', "require('net').createServer().on('error',e=>{console.log(e.code);process.exit(e.code==='EPERM'||e.code==='EACCES'?0:1)}).listen(0,'127.0.0.1',()=>process.exit(2))"], { encoding: 'utf8' });
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), expected: denied ? 'IP_DENIED' : 'POSITIVE_CONTROL', results, child: { exitCode: child.status, output: child.stdout.trim() } }));
if (denied ? results.some(item => !['EPERM', 'EACCES'].includes(item.result)) || child.status !== 0 : !results.some(item => item.kind === 'bind' && item.result === 'ALLOWED')) process.exitCode = 1;
