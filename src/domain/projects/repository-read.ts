export const REPOSITORY_READ_BYTES = 60 * 1024;

export function validateRepositoryReadOutput(data: Record<string, unknown>, remainingMs: number) {
  if (remainingMs <= 0) throw new Error('DEADLINE_EXCEEDED');
  if (Buffer.byteLength(JSON.stringify(data)) > REPOSITORY_READ_BYTES) throw new Error('OUTPUT_LIMIT');
  return data;
}
