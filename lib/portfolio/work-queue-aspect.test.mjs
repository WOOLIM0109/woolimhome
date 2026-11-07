import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual queue details without loading its networked admin page.
const source = readFileSync(new URL("../../components/admin/WorkQueue.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("WorkQueue.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Set([
  "isMockupMode", "isAspectClass", "isRedactionStatus", "safeSlideIndexes", "safeReasons",
  "classifyAspectRatio", "legacyAspectClass", "legacyMockupMode", "PortfolioMockupDetails",
]);
const variables = new Set(["mockupModeLabels", "aspectClassLabels"]);
const declarations = parsed.statements.filter(node => (
  ts.isFunctionDeclaration(node) && functions.has(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => variables.has(item.name.getText(parsed)))
));
assert.equal(declarations.length, functions.size + variables.size);
const compiled = ts.transpileModule(declarations.map(node => node.getText(parsed)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type, props) => ({ type, props });
const { isAspectClass, classifyAspectRatio, PortfolioMockupDetails } = vm.runInNewContext(
  `${compiled}\n({ isAspectClass, classifyAspectRatio, PortfolioMockupDetails })`,
  { exports: {}, require(name) {
    assert.equal(name, "react/jsx-runtime");
    return { jsx, jsxs: jsx, Fragment: "Fragment" };
  } },
);
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object") return text(node.props?.children);
  return node == null || typeof node === "boolean" ? "" : String(node);
}

test("queue displays 세로 4:3 from canonical metadata and legacy slide dimensions", () => {
  assert.equal(isAspectClass("4:3_portrait"), true);
  assert.equal(classifyAspectRatio(0.75), "4:3_portrait");
  assert.equal(classifyAspectRatio(210 / 297), "a4_portrait");
  for (const metadata of [
    { portfolioMockup: { aspectClass: "4:3_portrait" } },
    { portfolioAssets: [{ kind: "body_image", slideAspectRatio: 0.75 }] },
  ]) {
    assert.match(text(PortfolioMockupDetails({ metadata })), /규격 세로 4:3/);
    assert.doesNotMatch(text(PortfolioMockupDetails({ metadata })), /규격 A4 세로|규격 확인 필요/);
  }
  assert.match(text(PortfolioMockupDetails({ metadata: {
    portfolioAssets: [{ kind: "body_image", slideAspectRatio: 210 / 297 }],
  } })), /규격 A4 세로/);
});
