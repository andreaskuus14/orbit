// Walks the static import graph (incl. dynamic import()) from the demo entry files. Used by tests/demo-leak.test.ts.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const options: ts.CompilerOptions = { baseUrl: ROOT, paths: { "@/*": ["./src/*"] }, moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext, allowImportingTsExtensions: true, jsx: ts.JsxEmit.Preserve, resolveJsonModule: true };

/** Module specifiers that survive compilation: type-only imports/exports are erased, so they are skipped. */
function runtimeImports(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause, named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : undefined;
      const typeOnly = c && (c.isTypeOnly || (!c.name && named && named.length > 0 && named.every((e) => e.isTypeOnly)));
      if (!typeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.arguments.length && ts.isStringLiteralLike(n.arguments[0])
      && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** Every local file reachable from `entries`, and every bare package specifier they import (file -> specifiers). */
export function importGraph(entries: string[]) {
  const files = new Map<string, string[]>(), packages = new Map<string, string[]>();
  const todo = entries.map((e) => resolve(ROOT, e));
  while (todo.length) {
    const file = todo.pop()!;
    if (files.has(file)) continue;
    const specs = runtimeImports(file);
    files.set(file, specs);
    for (const spec of specs) {
      const r = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule;
      if (r && !r.isExternalLibraryImport && !r.resolvedFileName.endsWith(".d.ts")) todo.push(r.resolvedFileName);
      else packages.set(file, [...(packages.get(file) ?? []), spec]);
    }
  }
  return { files, packages };
}

if (import.meta.main) {
  const { files, packages } = importGraph(process.argv.slice(2));
  console.log(files.size, "files");
  for (const [f, p] of packages) console.log(f.replace(ROOT + "/", ""), "->", p.join(", "));
}
