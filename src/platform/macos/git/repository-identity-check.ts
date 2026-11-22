import type { FilesystemAnchor, FilesystemIdentity } from '../../../ports/repository.js';
import { createFilesystemIdentity } from './filesystem-identity.js';

export async function assertRepositoryIdentity(
  anchors: readonly FilesystemAnchor[], filesystem: FilesystemIdentity = createFilesystemIdentity(),
): Promise<void> {
  for (const expected of anchors) {
    const observed = await filesystem.capture(expected.canonicalPath, expected.kind);
    if (filesystem.compare(expected, observed) !== 'VERIFIED') throw new Error('REPOSITORY_CHANGED');
  }
}
