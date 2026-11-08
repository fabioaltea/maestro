import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

let text = '';
for await (const chunk of process.stdin) {
  text += String(chunk);
  if (text.length > 65_536) process.exit(2);
}
const intent = JSON.parse(text) as { canonicalStateDir: string };
await writeFile(join(intent.canonicalStateDir, 'received.json'), JSON.stringify(intent));
process.send!({ kind: 'bootstrap', accepted: true }, () => process.disconnect!());
setTimeout(() => process.exit(0), 100);
