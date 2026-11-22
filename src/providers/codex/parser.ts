import { REQUIRED_DISCOVERY_SECTIONS, type ArchitectResult, type DiscoveryClaim, type DiscoverySection } from '../../domain/discovery/documents.js';
import { DISCOVERY_LIMITS as limits, type DiscoveryFailure, type DiscoveryResult } from '../../domain/discovery/model.js';
import { validateDiscoveryText } from '../../domain/discovery/intent.js';
import { requireDecimal, requireUuid } from '../../domain/identifiers.js';
import type { ProviderEvent, ProviderOutputDecoder, ProviderOutputBatch } from '../../ports/provider.js';

function invalid(): never { throw new Error('PROVIDER_PROTOCOL_ERROR'); }
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(v, key)) || Object.keys(v).some(key => !keys.includes(key) && !optional.includes(key))) return invalid();
  return v;
}
function text(value: unknown, maximum: number, nonempty = true): string {
  if (typeof value !== 'string' || nonempty && !value.trim().length) return invalid();
  try { validateDiscoveryText(value, maximum); } catch { return invalid(); } return value;
}
function array(value: unknown, maximum: number): unknown[] { if (!Array.isArray(value) || value.length > maximum) return invalid(); return value; }
function digest(value: unknown) { const v = text(value, 64); if (!/^[a-f0-9]{64}$/.test(v)) return invalid(); return v; }
/** Structural validation only. Evidence/answer provenance is verified by core review. */
export function decodeCodexArchitectResult(raw: unknown): ArchitectResult {
  const r = object(raw, ['kind', 'questions', 'sections']);
  if (Buffer.byteLength(JSON.stringify(r)) > limits.documentBytes) throw new Error('PROVIDER_OUTPUT_LIMIT');
  if (r.kind === 'QUESTIONS') {
    if (r.sections !== null) return invalid();
    const questions = array(r.questions, limits.questions).map(raw => {
      const q = object(raw, ['text', 'reason', 'section']), section = text(q.section, 128);
      if (!(REQUIRED_DISCOVERY_SECTIONS as readonly string[]).includes(section)) return invalid();
      return { text: text(q.text, limits.questionBytes), reason: text(q.reason, limits.questionBytes), section };
    });
    if (!questions.length) return invalid(); return { kind: 'QUESTIONS', questions };
  }
  if (r.kind !== 'DOCUMENT' || r.questions !== null) return invalid();
  let count = 0;
  const sections: DiscoverySection[] = array(r.sections, limits.sections).map(raw => {
    const s = object(raw, ['id', 'title', 'claims']);
    const claims: DiscoveryClaim[] = array(s.claims, limits.claims).map(raw => {
      const c = object(raw, ['kind', 'text', 'sources', 'answers', 'reason']);
      if (++count > limits.claims || !['CODE', 'USER_CONFIRMED', 'HYPOTHESIS', 'UNKNOWN', 'NOT_APPLICABLE'].includes(String(c.kind))) return invalid();
      const sources = array(c.sources, limits.questions).map(raw => {
        const source = object(raw, ['sourceId', 'sha256', 'startLine', 'endLine', 'quote']);
        if (!Number.isSafeInteger(source.startLine) || !Number.isSafeInteger(source.endLine) || Number(source.startLine) < 1 || Number(source.endLine) < Number(source.startLine)) return invalid();
        return { sourceId: digest(source.sourceId), sha256: digest(source.sha256), startLine: Number(source.startLine), endLine: Number(source.endLine),
          quote: source.quote === null ? null : text(source.quote, limits.fileBytes, false) };
      });
      const answers = array(c.answers, limits.questions).map(raw => {
        const answer = object(raw, ['answerId', 'revision']); const answerId = text(answer.answerId, 36), revision = text(answer.revision, 19);
        try { requireUuid(answerId); requireDecimal(revision); if (revision === '0') return invalid(); } catch { return invalid(); }
        return { answerId, revision };
      });
      return { kind: c.kind as DiscoveryClaim['kind'], text: text(c.text, limits.answerBytes), sources, answers,
        reason: c.reason === null ? null : text(c.reason, limits.answerBytes) };
    });
    return { id: text(s.id, 128), title: text(s.title, 256), claims };
  });
  const ids = new Set(sections.map(s => s.id));
  if (ids.size !== sections.length || REQUIRED_DISCOVERY_SECTIONS.some(id => !ids.has(id))) return invalid();
  return { kind: 'DOCUMENT', sections };
}
function chunks(kind: 'PROGRESS' | 'AGENT_TEXT', value: string): ProviderEvent[] {
  if (!value.length) return [];
  const bytes = Buffer.from(value.endsWith('\n') ? value : value + '\n'), events: ProviderEvent[] = [];
  for (let offset = 0; offset < bytes.length;) {
    let end = Math.min(offset + limits.chunkBytes, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    events.push({ kind, text: bytes.subarray(offset, end).toString('utf8') }); offset = end;
  }
  return events;
}
function providerError(raw: unknown): DiscoveryFailure {
  const e = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (['rate_limit_exceeded', 'insufficient_quota'].includes(String(e.code))) return 'PROVIDER_QUOTA';
  if (['context_length_exceeded', 'input_too_large'].includes(String(e.code))) return 'PROVIDER_CONTEXT_LIMIT';
  if (['invalid_api_key', 'unauthorized', 'authentication_error'].includes(String(e.code))) return 'PROVIDER_AUTH_REQUIRED';
  if (typeof e.message === 'string' && /^Model metadata for `[^`\n]{1,128}` not found\. Defaulting to fallback metadata; this can degrade performance and cause issues\.$/.test(e.message)) return 'PROVIDER_UNSUPPORTED';
  return 'PROVIDER_UNAVAILABLE';
}
/** Pinned CLI JSONL. Unknown event/tool surfaces fail closed, never execute. */
export function createCodexOutputDecoder(): ProviderOutputDecoder {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let total = 0, lineBytes = 0, pending = '', thread = false, started = false, completed = false, finished = false;
  let result: ArchitectResult | null = null, failure: DiscoveryFailure | null = null;
  function latch(code: DiscoveryFailure): { ok: false; code: DiscoveryFailure } { failure ??= code; result = null; pending = ''; return { ok: false, code: failure }; }
  function record(raw: unknown): ProviderEvent[] {
    const event = object(raw, ['type'], ['thread_id', 'item', 'usage', 'error', 'message', 'code']);
    if (event.type === 'error' || event.type === 'turn.failed') throw new Error(providerError(event.error ?? event));
    if (completed) return invalid();
    if (event.type === 'thread.started') {
      object(event, ['type', 'thread_id']); text(event.thread_id, 128); if (thread || started) return invalid(); thread = true; return [];
    }
    if (event.type === 'turn.started') {
      object(event, ['type']); if (!thread || started) return invalid(); started = true;
      return [{ kind: 'PROGRESS', text: '[Codex] Turno avviato\n' }];
    }
    if (event.type === 'turn.completed') {
      object(event, ['type', 'usage']); if (!started || !result) return invalid();
      const usage = object(event.usage, ['input_tokens', 'cached_input_tokens', 'output_tokens'], ['reasoning_output_tokens']);
      if (Object.values(usage).some(n => !Number.isSafeInteger(n) || Number(n) < 0)) return invalid(); completed = true;
      return [{ kind: 'PROGRESS', text: '[Codex] Turno completato\n' }];
    }
    if (!['item.started', 'item.updated', 'item.completed'].includes(String(event.type))) return invalid();
    object(event, ['type', 'item']);
    const item = object(event.item, ['id', 'type'], ['text', 'phase', 'message']); text(item.id, 128);
    if (item.type === 'error') throw new Error(providerError(item));
    if (!started || !['reasoning', 'agent_message'].includes(String(item.type))) return invalid();
    object(item, ['id', 'type', 'text'], ['phase']); const output = text(item.text, limits.outputLineBytes, false);
    if (item.phase !== undefined && !['commentary', 'final_answer'].includes(String(item.phase))) return invalid();
    if (event.type !== 'item.completed') return [];
    if (item.type === 'reasoning') return chunks('PROGRESS', output);
    if (result) return invalid();
    if (/^\s*[{[]/.test(output)) {
      let rawResult: unknown; try { rawResult = JSON.parse(output); } catch { return invalid(); }
      result = decodeCodexArchitectResult(rawResult);
    }
    return chunks('AGENT_TEXT', output);
  }
  return {
    feed(bytes): ProviderOutputBatch {
      if (failure) return { ok: false, code: failure }; if (finished) return latch('PROVIDER_PROTOCOL_ERROR');
      total += bytes.byteLength; if (total > limits.runOutputBytes) return latch('PROVIDER_OUTPUT_LIMIT');
      const events: ProviderEvent[] = [];
      try {
        let offset = 0;
        for (let i = 0; i < bytes.byteLength; i++) {
          if (bytes[i] !== 10) continue;
          lineBytes += i - offset; if (lineBytes > limits.outputLineBytes) throw new Error('PROVIDER_OUTPUT_LIMIT');
          pending += utf8.decode(bytes.subarray(offset, i + 1), { stream: true });
          const line = pending.slice(0, -1); pending = ''; offset = i + 1; lineBytes = 0;
          if (!line.trim()) return invalid(); events.push(...record(JSON.parse(line)));
        }
        lineBytes += bytes.byteLength - offset; if (lineBytes > limits.outputLineBytes) throw new Error('PROVIDER_OUTPUT_LIMIT');
        pending += utf8.decode(bytes.subarray(offset), { stream: true });
        return { ok: true, value: events };
      } catch (error) {
        const failed = latch(error instanceof Error && ['PROVIDER_OUTPUT_LIMIT', 'PROVIDER_QUOTA', 'PROVIDER_CONTEXT_LIMIT', 'PROVIDER_AUTH_REQUIRED', 'PROVIDER_UNSUPPORTED', 'PROVIDER_UNAVAILABLE'].includes(error.message)
          ? error.message as DiscoveryFailure : 'PROVIDER_PROTOCOL_ERROR');
        return events.length ? { ...failed, partial: events } : failed;
      }
    },
    finish(exitCode): DiscoveryResult<ArchitectResult> {
      if (failure) return { ok: false, code: failure };
      try { utf8.decode(); } catch { return latch('PROVIDER_PROTOCOL_ERROR'); }
      if (exitCode !== 0 || pending.length || !completed || !result) return latch('PROVIDER_PROTOCOL_ERROR');
      finished = true; return { ok: true, value: result };
    },
  };
}
