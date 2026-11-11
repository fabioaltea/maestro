import { readFile, readdir } from 'node:fs/promises';
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
  if (!['domain', 'client'].includes(zone)) return;
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
      const allowed = zone === 'domain' ? ['domain/', 'ports/'] : ['client/', 'domain/', 'ports/', 'protocol/'];
      forbidden = !allowed.some(prefix => target.startsWith(prefix));
    } else {
      forbidden = zone === 'domain' || !specifier.startsWith('node:') || specifier === 'better-sqlite3'
        || specifier === 'node:sqlite' || specifier === 'node:child_process';
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
await walk(root);
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log('Architecture boundaries verified');
