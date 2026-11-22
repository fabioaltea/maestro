import { projectObject, requireProjectFields, requireProjectPath } from './intent.js';
import type { FilesystemAnchor, ReferenceCheckout, RepositoryIdentity } from '../../ports/repository.js';

function anchor(input: unknown): FilesystemAnchor {
  const value = projectObject(input);
  requireProjectFields(value, ['version', 'canonicalPath', 'kind', 'device', 'inode', 'birthtimeNs']);
  if (value.version !== 1 || value.kind !== 'directory') throw new Error('REPOSITORY_CHANGED');
  for (const key of ['device', 'inode', 'birthtimeNs']) {
    if (typeof value[key] !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value[key])
      || BigInt(value[key]) > 18_446_744_073_709_551_615n || (key !== 'device' && value[key] === '0')) throw new Error('REPOSITORY_CHANGED');
  }
  return { version: 1, canonicalPath: requireProjectPath(value.canonicalPath), kind: 'directory', device: value.device as string,
    inode: value.inode as string, birthtimeNs: value.birthtimeNs as string };
}
export function canonicalRepositoryIdentity(input: RepositoryIdentity): string {
  const value = projectObject(input); requireProjectFields(value, ['version', 'commonDirectory']);
  if (value.version !== 1) throw new Error('REPOSITORY_CHANGED');
  return JSON.stringify({ version: 1, commonDirectory: anchor(value.commonDirectory) });
}
export function canonicalReferenceCheckout(input: ReferenceCheckout): string {
  const value = projectObject(input); requireProjectFields(value, ['version', 'root', 'adminDirectory']);
  if (value.version !== 1) throw new Error('REPOSITORY_CHANGED');
  return JSON.stringify({ version: 1, root: anchor(value.root), adminDirectory: anchor(value.adminDirectory) });
}
