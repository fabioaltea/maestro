/** Local process fixture; no provider network, login, filesystem or token access. */
const mode = process.argv[2] ?? 'success';
let size = 0;
process.stdin.on('data', bytes => { size += bytes.length; if (size > 2 * 1024 * 1024) process.exit(1); });
process.stdin.on('end', () => {
  const line = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  process.stderr.write('SYNTHETIC_PRIVATE_STDERR_NOT_PUBLIC\n');
  line({ type: 'thread.started', thread_id: 'synthetic-thread' }); line({ type: 'turn.started' });
  line({ type: 'item.completed', item: { id: 'reasoning', type: 'reasoning', text: 'Checking approved synthetic sources.' } });
  if (mode === 'waiting') { setTimeout(() => process.exit(0), 10000); return; }
  if (mode === 'tool') { line({ type: 'item.completed', item: { id: 'unapproved', type: 'command_execution', command: 'never executed' } }); setTimeout(() => process.exit(0), 3000); return; }
  if (mode === 'empty') return;
  if (mode === 'malformed') { process.stdout.write(new Uint8Array([0xff])); return; }
  line({ type: 'item.completed', item: { id: 'final', type: 'agent_message', text: JSON.stringify({ kind: 'QUESTIONS', sections: null,
    questions: [{ text: 'Quale deployment è previsto?', reason: 'Manca nel corpus sintetico.', section: 'conventions-and-operations' }] }) } });
  line({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 8 } });
  if (mode === 'nonzero') process.exitCode = 1;
});
