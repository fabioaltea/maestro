const deniedDirectories = new Set(['.git', '.ssh', '.aws', '.azure', '.gcp', '.config', '.codex', '.claude', '.gnupg', '.npm', '.cache', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', '.next', '.nuxt', '.turbo', '.venv', 'venv', '__pycache__']);
const binary = /\.(?:png|jpe?g|gif|webp|ico|svgz|pdf|zip|gz|bz2|xz|7z|tar|dmg|iso|exe|dll|so|dylib|node|bin|o|a|class|jar|wasm|woff2?|ttf|otf|mp[34]|mov|sqlite(?:3)?|db|lockb)$/i;
export function discoverySourceExclusion(path: string): string | null {
  const parts = path.toLowerCase().split('/');
  if (parts.some(part => deniedDirectories.has(part))) return 'PRIVATE_OR_BUILD_DIRECTORY';
  const name = parts.at(-1)!;
  if (name.startsWith('.env') || ['.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials', 'credentials.json', 'credentials.yaml', 'credentials.yml', 'auth.json', 'secrets', '.secrets', 'secrets.json', 'secrets.yaml', 'secrets.yml', 'secrets.ini', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(name) || /\.(?:pem|key|p12|pfx|ppk|keystore|keychain-db|kdbx)$/.test(name)) return 'CREDENTIAL_PATH';
  if (binary.test(name)) return 'BINARY'; return null;
}
