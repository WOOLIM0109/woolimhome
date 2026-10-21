import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("./agent-auth.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(env = {}) {
  const context = { exports: {}, require(id) { assert.equal(id, "node:crypto"); return crypto; },
    process: { env }, Request, Response, TextEncoder, TextDecoder, ReadableStream, Uint8Array };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const { authorizeProgramAgent, readAgentJson, agentJson, agentError, ProgramApiError } = load();
// Entirely synthetic fixture; no local or production credentials are loaded by these tests.
const credential = "syntheticAgentFixture".repeat(3);
const maximum = 64 * 1024;
function request(body, headers = {}) {
  return new Request("https://fixture.example/api/agent/programs/fixture/review", {
    method: "POST", body, headers: { "Content-Type": "application/json", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
async function rejects(body, status, code, headers) {
  await assert.rejects(readAgentJson(request(body, headers)), (error) => {
    assert.equal(error.status, status); assert.equal(error.code, code);
    return true;
  });
}
function authorization(value, cookie) {
  return new Request("https://fixture.example/api/agent/profiles", {
    headers: { ...(value ? { authorization: value } : {}), ...(cookie ? { cookie } : {}) },
  });
}

test("agent authorization is closed without a configured credential and never falls back to cookies", () => {
  assert.equal(authorizeProgramAgent(authorization(`Bearer ${credential}`)), false);
  assert.equal(authorizeProgramAgent(authorization(undefined, "sb-session=synthetic-admin-session"), credential), false);
  assert.equal(authorizeProgramAgent(authorization(`Bearer ${credential}`), ""), false);
  assert.equal(authorizeProgramAgent(authorization("Bearer short"), "short"), false);
});

test("only the exact dedicated bearer credential authenticates; malformed and wrong-length inputs fail safely", () => {
  assert.equal(authorizeProgramAgent(authorization(`Bearer ${credential}`), credential), true);
  for (const supplied of [
    `bearer ${credential}`, `Basic ${credential}`, `Bearer  ${credential}`, `Bearer ${credential},other`,
    `Bearer ${credential}x`, `Bearer ${credential.slice(1)}`, `Bearer ${"q".repeat(120_000)}`,
  ]) assert.equal(authorizeProgramAgent(authorization(supplied), credential), false);
  assert.equal(authorizeProgramAgent(new Request(`https://fixture.example/api/agent/profiles?token=${credential}`), credential), false);
  assert.equal(authorizeProgramAgent(new Request("https://fixture.example/api/agent/profiles", {
    headers: { "x-api-key": credential, cookie: "sb-session=synthetic-admin-session" },
  }), credential), false);
});

test("JSON accepts exactly 64 KiB, but byte limits apply even without or with a false content length", async () => {
  const overhead = JSON.stringify({ note: "" }).length;
  const exact = JSON.stringify({ note: "a".repeat(maximum - overhead) });
  assert.equal(new TextEncoder().encode(exact).byteLength, maximum);
  assert.equal((await readAgentJson(request(exact))).note.length, maximum - overhead);
  await rejects(exact + " ", 413, "BODY_TOO_LARGE");
  await rejects(exact + " ", 413, "BODY_TOO_LARGE", { "Content-Length": "1" });
  await rejects(JSON.stringify({ note: "한".repeat(Math.ceil(maximum / 3)) }), 413, "BODY_TOO_LARGE");
});

test("declared over-limit and invalid content lengths fail before reading the request body", async () => {
  for (const declared of [String(maximum + 1), "-1", "NaN", "1.5", "1e5"]) {
    let reads = 0;
    const fake = { headers: new Headers({ "Content-Type": "application/json", "Content-Length": declared }),
      body: { getReader() { reads += 1; throw new Error("must not read"); } } };
    await assert.rejects(readAgentJson(fake), (error) => error.status === 413 && error.code === "BODY_TOO_LARGE");
    assert.equal(reads, 0);
  }
});

test("chunked over-limit JSON cancels the stream instead of buffering the remaining data", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(maximum)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  await rejects(stream, 413, "BODY_TOO_LARGE");
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("body parsing rejects non-JSON media types, malformed UTF-8, primitives and missing bodies with fixed codes", async () => {
  await rejects("{}", 415, "JSON_REQUIRED", { "Content-Type": "text/plain" });
  await rejects("{}", 415, "JSON_REQUIRED", { "Content-Type": "application/jsonp" });
  await rejects(new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]), 400, "INVALID_BODY");
  for (const body of ["", "{", "null", "[]", "true", "12", '"text"']) await rejects(body, 400, "INVALID_BODY");
  await rejects(undefined, 400, "INVALID_BODY");
  assert.equal((await readAgentJson(request('{"note":"정상 문서"}', { "Content-Type": "Application/JSON; charset=utf-8" }))).note,
    "정상 문서");
});

test("sensitive values are rejected both literally and after JSON Unicode decoding, without reflecting input", async () => {
  const fakeSensitive = "AIza" + "FAKEONLY".repeat(6);
  for (const body of [JSON.stringify({ note: fakeSensitive }), JSON.stringify({ note: fakeSensitive }).replace("AIza", "\\u0041Iza"),
    JSON.stringify({ note: "https://public.example/file?access_token=syntheticFixtureValue" })]) {
    await rejects(body, 400, "SENSITIVE_VALUE_REJECTED");
  }
  const response = agentError(new Error("private-provider-body-with-sensitive-context"));
  assert.equal(response.status, 500);
  assert.equal(await response.text(), '{"error":"REQUEST_FAILED"}');
  const expected = agentError(new ProgramApiError(400, "INVALID_QUERY"));
  assert.equal(expected.status, 400); assert.deepEqual(await expected.json(), { error: "INVALID_QUERY" });
});

test("JSON responses are private and no-store, and output credential patterns cannot escape", async () => {
  const response = agentJson({ note: "Public fixture" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-type"), /^application\/json; charset=utf-8$/);
  const fakeSensitive = "ghp_" + "FAKEONLY".repeat(6);
  for (const streaming of [false, true]) assert.throws(() => agentJson({ note: fakeSensitive }, 200, streaming),
    (error) => error.status === 500 && error.code === "RESPONSE_UNAVAILABLE");
});

test("configured opaque agent and service credentials cannot enter writes or escape in responses", async () => {
  const opaque = { PROGRAM_AGENT_TOKEN: credential, SUPABASE_SERVICE_ROLE_KEY: "syntheticServiceRoleFixture".repeat(3) };
  const protectedAuth = load(opaque);
  for (const value of Object.values(opaque)) {
    // Opaque fixtures have no recognized provider prefix; only the configured-value guard can catch them.
    const body = JSON.stringify({ nested: { note: `prefix ${value} suffix` } });
    await assert.rejects(protectedAuth.readAgentJson(request(body)),
      (error) => error.status === 400 && error.code === "SENSITIVE_VALUE_REJECTED");
    const escaped = body.replace(value, `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}${value.slice(1)}`);
    await assert.rejects(protectedAuth.readAgentJson(request(escaped)),
      (error) => error.status === 400 && error.code === "SENSITIVE_VALUE_REJECTED");
    for (const stream of [false, true]) assert.throws(() => protectedAuth.agentJson({ note: `prefix ${value} suffix` }, 200, stream),
      (error) => error.status === 500 && error.code === "RESPONSE_UNAVAILABLE");
  }
  assert.equal((await protectedAuth.readAgentJson(request('{"note":"Public fixture"}'))).note, "Public fixture");
});

test("full-text streaming preserves multi-byte text and page markers across chunk boundaries", async () => {
  const text = "[p.1] 공공 문서\n" + "한글內容".repeat(300_000) + "\n[p.2] 끝";
  const response = agentJson({ text }, 200, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).text, text);
});
