import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';

const root = resolve(process.argv[2] ?? 'src');
const violations = [];
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.ts')) await inspect(path);
  }
}
async function inspect(path) {
  const local = relative(root, path).replaceAll('\\', '/');
  const zone = local.split('/')[0];
  const workflow = local.startsWith('core/features/') || local.startsWith('core/workflow/') || local.startsWith('core/workspaces/') || local.startsWith('core/environments/') || local.startsWith('core/profiles/') || local.startsWith('core/execution/') || local.startsWith('core/scheduler/') || local.startsWith('core/review/');
  if (!['domain', 'client', 'providers'].includes(zone) && !workflow) return;
  // Feature/workflow policies remain inside the existing neutral domain zone.
  const ast = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
  function validate(node) {
    if (!ts.isStringLiteralLike(node)) {
      violations.push(`${local}: non-static module import is not allowed`);
      return;
    }
    const specifier = node.text;
    let forbidden;
    if (specifier.startsWith('.')) {
      const target = relative(root, resolve(dirname(path), specifier)).replaceAll('\\', '/');
      const allowed = workflow ? ['domain/', 'ports/', 'protocol/', 'core/', ...(['core/features/runtime.ts','core/workspaces/runtime.ts','core/environments/runtime.ts','core/profiles/runtime.ts','core/review/runtime.ts'].includes(local) ? ['providers/', 'platform/'] : [])] : zone === 'domain' ? ['domain/', 'ports/']
        : zone === 'providers' ? ['providers/', 'domain/', 'ports/']
        : ['client/', 'domain/', 'ports/', 'protocol/'];
      forbidden = !allowed.some(prefix => target.startsWith(prefix));
    } else {
      forbidden = workflow ? !['node:crypto', 'node:path', 'node:buffer'].includes(specifier) : zone === 'providers'
      ? !specifier.startsWith('node:') || specifier === 'node:sqlite' || specifier.startsWith('node:sqlite/')
      : zone === 'domain' || !specifier.startsWith('node:') || specifier === 'better-sqlite3'
        || specifier === 'node:sqlite' || ['node:fs', 'node:os', 'node:process', 'node:child_process', 'node:worker_threads', 'node:cluster', 'node:net', 'node:tls', 'node:http', 'node:https', 'node:http2', 'node:dgram'].some(prefix => specifier === prefix || specifier.startsWith(prefix + '/'));
    }
    if (forbidden) violations.push(`${local}: forbidden dependency ${specifier}`);
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      validate(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) {
      validate(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      if (node.arguments[0]) validate(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
async function inspectDesktop(directory) {
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) { await scan(path); continue; }
      if (!/\.(?:ts|tsx|cts)$/.test(entry.name)) continue;
      const local = relative(directory, path).replaceAll('\\', '/'), zone = local.split('/')[0];
      const ast = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true, entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function dependency(node) {
        if (!ts.isStringLiteralLike(node)) { violations.push(`${local}: non-static dependency`); return; }
        const specifier = node.text;
        let allowed = false;
        if (specifier.startsWith('.')) {
          const target = relative(directory, resolve(dirname(path), specifier)).replaceAll('\\', '/');
          allowed = (zone === 'shared' ? ['shared/'] : [zone + '/', 'shared/']).some(prefix => target.startsWith(prefix));
        } else if (zone === 'main') allowed = specifier === 'electron' || specifier.startsWith('node:');
        else if (zone === 'preload') allowed = specifier === 'electron';
        else if (zone === 'renderer') allowed = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'].includes(specifier);
        if (!allowed) violations.push(`${local}: forbidden dependency ${specifier}`);
      }
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) dependency(node.moduleSpecifier);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          if (node.arguments[0]) dependency(node.arguments[0]);
        }
        if (['renderer', 'shared'].includes(zone) && ts.isIdentifier(node) && ['process', 'require', 'eval', 'ipcRenderer'].includes(node.text)) violations.push(`${local}: privileged global ${node.text}`);
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  await scan(directory);
}
await walk(root);
const desktopRoot = resolve(process.argv[3] ?? 'apps/desktop/src');
if (await stat(desktopRoot).then(s => s.isDirectory(), () => false)) await inspectDesktop(desktopRoot);
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log('Architecture boundaries verified');
