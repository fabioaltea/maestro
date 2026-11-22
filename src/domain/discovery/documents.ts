export type ProvenanceKind = 'CODE' | 'USER_CONFIRMED' | 'HYPOTHESIS' | 'UNKNOWN' | 'NOT_APPLICABLE';
export interface SourceReference {
  readonly sourceId: string; readonly sha256: string; readonly startLine: number; readonly endLine: number;
  readonly quote: string | null;
}
export interface AnswerReference { readonly answerId: string; readonly revision: string }
export interface DiscoveryClaim {
  readonly kind: ProvenanceKind; readonly text: string; readonly sources: readonly SourceReference[];
  readonly answers: readonly AnswerReference[]; readonly reason: string | null;
}
export interface DiscoverySection { readonly id: string; readonly title: string; readonly claims: readonly DiscoveryClaim[] }
export interface DiscoveryDocument { readonly kind: 'DOCUMENT'; readonly sections: readonly DiscoverySection[] }
export interface ArchitectQuestion { readonly text: string; readonly reason: string; readonly section: string }
export interface DiscoveryQuestions { readonly kind: 'QUESTIONS'; readonly questions: readonly ArchitectQuestion[] }
export type ArchitectResult = DiscoveryQuestions | DiscoveryDocument;
export const REQUIRED_DISCOVERY_SECTIONS = Object.freeze(['purpose-and-features', 'architecture-and-dependencies', 'conventions-and-operations'] as const);
export interface DiscoveryDocumentRevision {
  readonly revisionId: string; readonly discoveryId: string; readonly revisionNumber: string;
  readonly parentRevisionId: string | null; readonly snapshotId: string; readonly contextDigest: string;
  readonly artifactId: string; readonly bundleDigest: string; readonly bytes: number; readonly provenanceValidated: boolean;
  readonly status: 'DRAFT' | 'READY_FOR_REVIEW' | 'INVALID';
}

/** Verifies structure and references, never the semantic truth of a claim. */
export function validateDiscoveryDocument(input: unknown, evidence: {
  readonly sources: readonly { readonly sourceId: string; readonly sha256: string; readonly text: string }[];
  readonly answers: readonly { readonly answerId: string; readonly revision: string; readonly kind: string }[];
}): { readonly document: DiscoveryDocument; readonly unknownIds: readonly string[] } {
  const invalid = (): never => { throw new Error('PROVIDER_PROTOCOL_ERROR'); };
  const obj = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) return invalid();
    return v as Record<string, unknown>;
  };
  const text = (v: unknown, max = 256 * 1024): string => {
    if (typeof v !== 'string' || !v.trim() || !v.isWellFormed() || v.includes('\0') || new TextEncoder().encode(v).length > max) return invalid(); return v;
  };
  const d = obj(input, ['kind', 'sections']);
  if (d.kind !== 'DOCUMENT' || !Array.isArray(d.sections) || d.sections.length < 3 || d.sections.length > 20 || new TextEncoder().encode(JSON.stringify(input)).length > 256 * 1024) return invalid();
  const ids = new Set<string>(), unknownIds: string[] = []; let count = 0;
  for (const raw of d.sections) {
    const s = obj(raw, ['id', 'title', 'claims']), id = text(s.id, 128); text(s.title, 4096);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id) || !Array.isArray(s.claims) || !s.claims.length) return invalid(); ids.add(id);
    for (const [index, item] of s.claims.entries()) {
      if (++count > 200) return invalid();
      const c = obj(item, ['kind', 'text', 'sources', 'answers', 'reason']); text(c.text);
      if (!['CODE', 'USER_CONFIRMED', 'HYPOTHESIS', 'UNKNOWN', 'NOT_APPLICABLE'].includes(String(c.kind)) || !Array.isArray(c.sources) || !Array.isArray(c.answers) || c.sources.length > 200 || c.answers.length > 20) return invalid();
      if (c.reason !== null) text(c.reason, 4096);
      if (c.kind === 'CODE') {
        if (!c.sources.length || c.answers.length) return invalid();
        for (const rawRef of c.sources) {
          const r = obj(rawRef, ['sourceId', 'sha256', 'startLine', 'endLine', 'quote']), source = evidence.sources.find(source => source.sourceId === r.sourceId && source.sha256 === r.sha256);
          if (!source || !Number.isSafeInteger(r.startLine) || !Number.isSafeInteger(r.endLine) || (r.startLine as number) < 1 || (r.endLine as number) < (r.startLine as number)) return invalid();
          const lines = source.text.split('\n'); if (source.text.endsWith('\n')) lines.pop();
          if ((r.endLine as number) > lines.length || r.quote !== null && (typeof r.quote !== 'string' || r.quote !== lines.slice((r.startLine as number) - 1, r.endLine as number).join('\n'))) return invalid();
        }
      } else if (c.kind === 'USER_CONFIRMED') {
        if (c.sources.length || !c.answers.length) return invalid();
        for (const rawRef of c.answers) { const r = obj(rawRef, ['answerId', 'revision']); if (!evidence.answers.some(a => a.answerId === r.answerId && a.revision === r.revision && a.kind === 'ANSWER')) return invalid(); }
      } else {
        if (c.sources.length || c.answers.length || c.reason === null) return invalid();
        if (c.kind === 'UNKNOWN') unknownIds.push(`${id}:${index}`);
      }
    }
  }
  if (REQUIRED_DISCOVERY_SECTIONS.some(id => !ids.has(id))) return invalid();
  return { document: input as DiscoveryDocument, unknownIds };
}
