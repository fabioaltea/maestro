import { writeFileSync } from 'node:fs';
import Database from '../../src/storage/sqlite-driver.js';
import { openReadonlyDatabase } from '../../src/storage/readonly-database.js';

const reader = openReadonlyDatabase(process.argv[2]!);
process.stdout.write(JSON.stringify({ ready: true }) + '\n');
process.stdin.once('data', () => {
  let queryCode = 'OK', nativeWriteCode = 'OK', writeCode = 'OK';
  try { reader.database.prepare('SELECT count(*) FROM store').get(); }
  catch (error) { queryCode = String((error as { code?: unknown }).code); }
  try { const native = new Database(process.argv[3]!); native.close(); }
  catch (error) { nativeWriteCode = String((error as { code?: unknown }).code); }
  try { writeFileSync(process.argv[3]!, 'forbidden'); }
  catch (error) { writeCode = String((error as { code?: unknown }).code); }
  reader.database.close(); reader.release();
  process.stdout.write(JSON.stringify({ queryCode, nativeWriteCode, writeCode }) + '\n');
  process.stdin.destroy();
});
