import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', fileURLToPath(new URL('./idle-resources.test.js', import.meta.url))], {stdio: 'inherit'});
child.once('error', error => {console.error(error.message); process.exitCode = 1;});
child.once('exit', (code, signal) => {if (signal) console.error(`Benchmark terminated: ${signal}`); process.exitCode = code ?? 1;});