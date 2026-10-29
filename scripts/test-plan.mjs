import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export const SERIAL_POWERPOINT_TEST_FILES = Object.freeze([
  "lib/pc-worker/preparation/powerpoint-adapter.test.mjs",
  "lib/pc-worker/preparation/powerpoint-cleanup.test.mjs",
  "lib/pc-worker/preparation/preparation-review-service.test.mjs",
]);

export async function discoverTestFiles(root) {
  const files = [];
  async function visit(relativeDirectory) {
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relativePath);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(relativePath);
    }
  }
  await visit("lib");
  return files.sort();
}

// Keep this conservative: tests using a mocked export still belong in the
// serial group if they name the same entry points as a live converter test.
const powerPointMarker = /\bGetTypeFromProgID\s*\(\s*(['"])PowerPoint\.Application\1\s*\)|\bGetActiveObject\b|\bexportLocalPowerPointSlides\b|\binspectLocalPptx\b/i;
const powerPointMutex = /\bLocal\\+WoolimPowerPointPreparation\b/;
const converterPath = /(?:^|[\\/])prepare-slides\.ps1$/;
const lockHelperPath = /(?:^|[\\/])powerpoint-test-lock\.mjs$/;

function hasInjectedProcess(node) {
  // An injected process also owns path assertions nested in its callback.
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isObjectLiteralExpression(ancestor) && ancestor.properties.some(property => (
      property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      && property.name.text === "runProcess"
    ))) return true;
  }
  return false;
}

function inspectConverterReferences(source) {
  const parsed = ts.createSourceFile("test.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let realConverter = powerPointMutex.test(source);
  let importsLockHelper = false;
  function visit(node) {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)) && converterPath.test(node.text) && !hasInjectedProcess(node)) {
      realConverter = true;
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && lockHelperPath.test(node.moduleSpecifier.text)) importsLockHelper = true;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
      && lockHelperPath.test(node.arguments[0].text)) importsLockHelper = true;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return { realConverter, importsLockHelper };
}

export function validatePowerPointTestFiles(sources, serialFiles = SERIAL_POWERPOINT_TEST_FILES) {
  const registered = new Set();
  const errors = [];
  for (const file of serialFiles) {
    if (registered.has(file)) errors.push(`Duplicate serial PowerPoint test file: ${file}`);
    registered.add(file);
    if (!sources.has(file)) errors.push(`Registered serial PowerPoint test file is missing: ${file}`);
    else {
      const source = sources.get(file);
      if (!powerPointMarker.test(source)) {
        errors.push(`Registered serial test file has no PowerPoint source marker: ${file}`);
      }
      const { realConverter, importsLockHelper } = inspectConverterReferences(source);
      if (realConverter && !importsLockHelper) {
        errors.push(`Serial PowerPoint test file runs the real converter without the lock helper: ${file}`);
      }
    }
  }
  for (const [file, source] of sources) {
    if (powerPointMarker.test(source) && !registered.has(file)) {
      errors.push(`PowerPoint test file is missing from the serial list: ${file}`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
}
