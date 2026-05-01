export function notImplemented(name: string): never {
  console.error(`[maestro] '${name}' not implemented yet (V1 step pending).`);
  process.exit(2);
}
