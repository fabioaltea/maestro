/** Test-only Responses backend. Never imported by production or connected to OpenAI. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SyntheticRequest { readonly path: string; readonly body: Record<string, unknown> }
export interface SyntheticItem { readonly type: string; readonly [key: string]: unknown }
export async function createDiscoveryInferenceServer(outputs: readonly SyntheticItem[][] = []) {
  const requests: SyntheticRequest[] = [];
  const errors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || !request.url?.endsWith('/responses') || requests.length >= 12) {
        response.writeHead(400); response.end(); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4 * 1024 * 1024) { response.writeHead(413); response.end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('BODY_INVALID');
      requests.push({ path: request.url, body: body as Record<string, unknown> });
      const index = requests.length - 1;
      const items = outputs[index] ?? [{ id: `msg_fixture_${index}`, type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify({ kind: 'QUESTIONS', sections: null, questions: [
          { text: 'Quale ambiente di deployment è previsto?', reason: 'Non presente nel corpus sintetico.', section: 'conventions-and-operations' },
        ] }), annotations: [] }] }];
      const base = { id: `resp_fixture_${index}`, object: 'response', created_at: 1, model: 'maestro-fixture', output: [],
        status: 'in_progress', usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let sequence = 0;
      const event = (type: string, data: Record<string, unknown>) => response.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`);
      event('response.created', { response: base });
      for (const [output_index, item] of items.entries()) {
        event('response.output_item.added', { output_index, item });
        event('response.output_item.done', { output_index, item });
      }
      event('response.completed', { response: { ...base, status: 'completed', output: items } });
      response.end();
    } catch {
      errors.push('SYNTHETIC_BACKEND_ERROR'); response.writeHead(400); response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return { port, baseUrl: `http://127.0.0.1:${port}/v1`, requests, errors,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
    }) };
}
