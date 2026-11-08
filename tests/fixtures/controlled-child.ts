process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'maestro-test-shutdown') process.exit(0);
  if (message.type === 'maestro-test-crash') process.exit(86);
});
process.send!({ type: 'ready' });
