import assert from 'node:assert/strict';

export async function loadContract<T>(relative: string, functions: readonly string[]): Promise<T> {
  const url = new URL(`../../src/${relative}`, import.meta.url);
  const module = await import(url.href).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
  }) as Record<string, unknown>;
  for (const name of functions) {
    assert.equal(typeof module[name], 'function', `Required contract ${relative}:${name} is not implemented`);
  }
  return module as T;
}
