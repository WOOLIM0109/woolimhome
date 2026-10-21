import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as requirements from "./requirements.ts";

const compiled = ts.transpileModule(readFileSync(new URL("./requirements-generation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const input = requirements.buildRequirementInput([{ id: "0:detail", text: "[para.1] 부산광역시 중소기업 대상." }]);

function harness(generate) {
  const requests = [];
  const exports = {};
  const dependencies = {
    "../gemini/client": { generateGeminiText: async (request) => {
      requests.push(request);
      return generate ? generate(request) : { text: "{}", finishReason: "STOP", usage: {}, attempts: [{ httpStatus: 200 }] };
    } },
    "../gemini/automation": { GEMINI_AUTOMATION_MODEL: "unchanged-existing-model" },
    "./requirements": requirements,
  };
  vm.runInNewContext(compiled, {
    exports,
    require(name) { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
    Error, structuredClone,
    console: { log() { assert.fail("Generation helper must not log"); }, warn() { assert.fail("Generation helper must not log"); }, error() { assert.fail("Generation helper must not log"); } },
    fetch() { assert.fail("Generation tests must never make network requests"); },
  });
  return { exports, requests, run: (options) => exports.generateRequirementResponse(input, options) };
}

test("기존 모델·입력 프롬프트는 유지하고 low thinking·JSON schema·16000 출력·80초·1회 호출을 설정한다", async () => {
  const h = harness();
  const originalInput = structuredClone(input);
  await h.run();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.model, "unchanged-existing-model");
  assert.equal(request.attempts, 1);
  assert.equal(request.timeoutMs, 80_000);
  assert.equal(request.parts[0].text, requirements.requirementsPrompt(input));
  assert.equal(request.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(request.generationConfig.maxOutputTokens, 16_000);
  assert.ok(!Object.hasOwn(request.generationConfig, "responseSchema"));
  assert.ok(!Object.hasOwn(request.generationConfig.thinkingConfig, "thinkingBudget"));
  assert.deepEqual(input, originalInput);
});

test("응답 스키마는 공식 지원 키만 사용하고 nullable leaf·선택 기준일·동적 evidence를 보존한다", async () => {
  const h = harness();
  await h.run();
  const schema = h.requests[0].generationConfig.responseJsonSchema;
  const supported = new Set(["type", "properties", "required", "additionalProperties", "items", "minimum", "format"]);
  function inspect(node, path = "") {
    assert.ok(node && typeof node === "object");
    for (const key of Object.keys(node)) assert.ok(supported.has(key), `Unsupported schema keyword at ${path}`);
    if (Array.isArray(node.type) && node.type.some((type) => ["string", "integer", "number", "array"].includes(type))) assert.ok(node.type.includes("null"));
    if (node.properties) for (const [name, child] of Object.entries(node.properties)) inspect(child, path ? `${path}.${name}` : name);
    if (node.items) inspect(node.items, `${path}[]`);
    if (typeof node.additionalProperties === "object") inspect(node.additionalProperties, `${path}.*`);
  }
  inspect(schema);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.required.length, 15);
  assert.ok(schema.properties.business_age.properties.as_of.type.includes("null"));
  assert.ok(!schema.properties.business_age.required.includes("as_of"));
  assert.equal(schema.properties.evidence.additionalProperties.type, "string");
  assert.ok(schema.properties.evidence.type.includes("null"));
  assert.ok(schema.properties.bonus_points.items.properties.item.type.includes("null"));
  assert.deepEqual(Array.from(schema.properties.bonus_points.items.properties.points.type), ["number", "null"]);
  assert.ok(schema.properties.submission_documents.items.properties.name.type.includes("null"));
});

test("남은 시간 제한은 1~80000ms로 제한하고 잘못된 값에는 기본 제한을 적용한다", async () => {
  for (const [timeoutMs, expected] of [[60_123.9, 60_123], [100_000, 80_000], [0, 1], [-1, 1], [NaN, 80_000], [Infinity, 80_000]]) {
    const h = harness();
    await h.run({ timeoutMs });
    assert.equal(h.requests[0].timeoutMs, expected);
    assert.equal(h.requests.length, 1);
  }
});

test("호출별 스키마 사본으로 다른 실행이 구조를 변형하지 못한다", async () => {
  const h = harness(async (request) => {
    request.generationConfig.responseJsonSchema.properties.regions.type.push("unexpected");
    return { text: "{}", finishReason: "STOP", usage: {} };
  });
  await h.run();
  assert.ok(!h.exports.REQUIREMENTS_RESPONSE_SCHEMA.properties.regions.type.includes("unexpected"));
});

test("MAX_TOKENS와 잘린 JSON을 숨기거나 재호출하지 않고 private 저장용 원문으로 돌려준다", async () => {
  const rawText = '{"regions":["부산광역시"],"unfinished":';
  const h = harness(async () => ({ text: rawText, finishReason: "MAX_TOKENS",
    usage: { inputTokens: 5000, outputTokens: 16000, candidateTokens: 15000, thoughtsTokens: 1000, totalTokens: 21000, cachedInputTokens: 0 },
    attempts: [{ httpStatus: 200 }] }));
  const response = await h.run();
  assert.equal(response.rawText, rawText);
  assert.equal(response.finishReason, "MAX_TOKENS");
  assert.equal(response.safeDiagnostics.finishReason, "MAX_TOKENS");
  assert.equal(response.safeDiagnostics.status, 200);
  assert.equal(response.safeDiagnostics.usage.outputTokens, 16000);
  assert.equal(h.requests.length, 1);
});

test("성공 진단에는 허용된 종료 사유와 사용량 숫자만 포함한다", async () => {
  const h = harness(async () => ({ text: "{}", finishReason: "STOP", message: "private-provider-detail", rawKey: "private-provider-detail",
    usage: { inputTokens: 0, outputTokens: 12, candidateTokens: -1, thoughtsTokens: Infinity, totalTokens: "12", cachedInputTokens: NaN, diagnostic: "private-provider-detail" },
    attempts: [{ httpStatus: 200, body: "private-provider-detail" }] }));
  const response = await h.run();
  assert.equal(response.finishReason, "STOP");
  assert.deepEqual(Object.keys(response.safeDiagnostics).sort(), ["code", "finishReason", "status", "usage"]);
  assert.deepEqual(Object.keys(response.safeDiagnostics.usage).sort(), ["inputTokens", "outputTokens"]);
  assert.doesNotMatch(JSON.stringify(response.safeDiagnostics), /private-provider-detail|rawKey|body|diagnostic/);
});

test("알 수 없는 종료 사유·상태는 원문을 진단에 복사하지 않는다", async () => {
  const h = harness(async () => ({ text: "{}", finishReason: "private-unrecognized-value", status: "private-unrecognized-value", usage: {} }));
  const response = await h.run();
  assert.equal(response.finishReason, null);
  assert.equal(response.safeDiagnostics.status, null);
  assert.doesNotMatch(JSON.stringify(response.safeDiagnostics), /private-unrecognized-value/);
});

test("provider 오류 메시지·본문·원인·임의 코드는 전파하지 않고 고정 진단으로 실패한다", async () => {
  const original = Object.assign(new Error("private-provider-detail"), {
    code: "private-provider-detail", status: 503, cause: { privateValue: "private-provider-detail" },
    body: "private-provider-detail", usage: { inputTokens: 42, unsafe: "private-provider-detail" },
  });
  const h = harness(async () => { throw original; });
  await assert.rejects(() => h.run(), (error) => {
    assert.equal(error.name, "RequirementGenerationError");
    assert.equal(error.message, "공고 요건 응답 생성 실패");
    assert.equal(error.safeDiagnostics.code, "GEMINI_REQUEST_FAILED");
    assert.equal(error.safeDiagnostics.status, 503);
    assert.equal(error.safeDiagnostics.usage.inputTokens, 42);
    assert.ok(!Object.hasOwn(error, "cause"));
    assert.doesNotMatch(JSON.stringify(error), /private-provider-detail|privateValue|unsafe|body/);
    assert.doesNotMatch(error.stack, /private-provider-detail/);
    return true;
  });
  assert.equal(h.requests.length, 1);
});

test("알려진 client 오류 코드와 HTTP 상태는 보존하지만 메시지는 읽지 않는다", async () => {
  const original = { code: "GEMINI_RATE_LIMIT", status: 429, attempts: [{ inputTokens: 0, outputTokens: 0 }] };
  Object.defineProperty(original, "message", { get() { assert.fail("Provider error message must not be read"); } });
  const h = harness(async () => { throw original; });
  await assert.rejects(() => h.run(), (error) => {
    assert.equal(error.safeDiagnostics.code, "GEMINI_RATE_LIMIT");
    assert.equal(error.safeDiagnostics.status, 429);
    assert.equal(error.safeDiagnostics.usage.inputTokens, 0);
    return true;
  });
});

test("진단 속성 자체가 실패해도 원본 오류를 누설하지 않는 fallback을 사용한다", async () => {
  const original = {};
  Object.defineProperty(original, "code", { get() { throw new Error("private-provider-detail"); } });
  const h = harness(async () => { throw original; });
  await assert.rejects(() => h.run(), (error) => {
    assert.equal(error.safeDiagnostics.code, "GEMINI_REQUEST_FAILED");
    assert.equal(error.safeDiagnostics.status, null);
    assert.equal(error.safeDiagnostics.finishReason, null);
    assert.equal(Object.keys(error.safeDiagnostics.usage).length, 0);
    assert.doesNotMatch(JSON.stringify(error), /private-provider-detail/);
    return true;
  });
});
