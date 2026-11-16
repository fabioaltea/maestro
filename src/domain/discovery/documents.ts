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
