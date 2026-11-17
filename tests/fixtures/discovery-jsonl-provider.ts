/** Local process fixture; no provider network, login, filesystem or token access. */
const mode = process.argv[2] ?? 'success';
let size = 0; const inputChunks: Buffer[] = [];
process.stdin.on('data', bytes => { size += bytes.length; inputChunks.push(Buffer.from(bytes)); if (size > 2 * 1024 * 1024) process.exit(1); });
process.stdin.on('end', () => {
  const line = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  process.stderr.write('SYNTHETIC_PRIVATE_STDERR_NOT_PUBLIC\n');
  line({ type: 'thread.started', thread_id: 'synthetic-thread' }); line({ type: 'turn.started' });
  line({ type: 'item.completed', item: { id: 'reasoning', type: 'reasoning', text: 'Checking approved synthetic sources.' } });
  if (mode === 'waiting') { setTimeout(() => process.exit(0), 10000); return; }
  if (mode === 'tool') { line({ type: 'item.completed', item: { id: 'unapproved', type: 'command_execution', command: 'never executed' } }); setTimeout(() => process.exit(0), 3000); return; }
  if (mode === 'empty') return;
  if (mode === 'malformed') { process.stdout.write(new Uint8Array([0xff])); return; }
  if (mode === 'flow') {
    const raw = JSON.parse(Buffer.concat(inputChunks).toString()), input = raw.input ?? raw;
    if (input.requestKind !== 'INITIAL') {
      const source = input.sources[0], answer = input.answers.find((a: { kind: string }) => a.kind === 'ANSWER');
      const sections = ['purpose-and-features', 'architecture-and-dependencies', 'conventions-and-operations'].map((id, index) => ({ id, title: id, claims: [index === 0 ? { kind: 'CODE', text: 'Fonte sintetica presente', sources: [{ sourceId: source.sourceId, sha256: source.sha256, startLine: 1, endLine: 1, quote: source.text.split('\n')[0] }], answers: [], reason: null }
        : index === 1 && answer ? { kind: 'USER_CONFIRMED', text: answer.text, sources: [], answers: [{ answerId: answer.answerId, revision: answer.revision }], reason: null }
        : { kind: 'UNKNOWN', text: input.requestKind === 'CORRECTION' ? 'Documento corretto: informazione assente' : 'Informazione assente', sources: [], answers: [], reason: 'Non documentata' }] }));
      line({ type: 'item.completed', item: { id: 'final', type: 'agent_message', text: JSON.stringify({ kind: 'DOCUMENT', questions: null, sections }) } });
      line({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 8 } }); return;
    }
  }
  line({ type: 'item.completed', item: { id: 'final', type: 'agent_message', text: JSON.stringify({ kind: 'QUESTIONS', sections: null,
    questions: [{ text: 'Quale deployment è previsto?', reason: 'Manca nel corpus sintetico.', section: 'conventions-and-operations' }] }) } });
  line({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 8 } });
  if (mode === 'nonzero') process.exitCode = 1;
});
