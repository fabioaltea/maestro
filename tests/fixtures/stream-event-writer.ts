import { readFileSync } from 'node:fs';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
const {path} = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {path: string};
const store = new SQLiteStore({path}, {checkpoint: point => { if (point === 'journal.appended') process.exit(86); }});
store.recordEvents([{type: 'diagnostics.degraded', payload: {code: 'BUSY'}}]);
store.close();
