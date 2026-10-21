import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

const credential = "syntheticAgentRouteFixture".repeat(3);
const id = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";
const routes = [
  { path: "programs/today", verb: "GET", operation: "today" },
  { path: "programs", verb: "GET", operation: "searchPrograms", query: "?status=collected&q=public" },
  { path: "programs/[id]", verb: "GET", operation: "detail", params: { id } },
  { path: "programs/[id]/text", verb: "GET", operation: "text", params: { id }, query: `?attachment=${attachmentId}` },
  { path: "profiles", verb: "GET", operation: "profiles" },
  { path: "programs/[id]/review", verb: "POST", operation: "appendReview", params: { id } },
  { path: "profiles/[key]/proposal", verb: "POST", operation: "proposeProfile", params: { key: "woolimworks" } },
];
function compile(file) {
  return ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function evaluate(source, modules, env = {}) {
  const context = { exports: {}, require(module) { assert.ok(Object.hasOwn(modules, module), module); return modules[module]; },
    process: { env }, Request, Response, URL, TextEncoder, TextDecoder, ReadableStream, Uint8Array };
  vm.runInNewContext(source, context);
  return context.exports;
}
const authSource = compile("./agent-auth.ts");
const wrapperSource = compile("./agent-route.ts");
const routeSources = new Map(routes.map(route => [route.path, compile(`../../app/api/agent/${route.path}/route.ts`)]));
function harness({ configured = true, failure = null, clientFailure = false } = {}) {
  const auth = evaluate(authSource, { "node:crypto": crypto }, configured ? { PROGRAM_AGENT_TOKEN: credential } : {});
  const calls = [];
  let clients = 0;
  class ProgramAgentService {
    constructor(admin) { assert.equal(admin, "synthetic-admin-client"); }
  }
  for (const { operation } of routes) ProgramAgentService.prototype[operation] = async (...args) => {
    calls.push({ operation, args });
    if (failure) throw failure;
    return { operation, text: "[p.1] Public fixture" };
  };
  const wrapper = evaluate(wrapperSource, {
    "@/lib/supabase/admin": { createAdminClient() { clients += 1;
      if (clientFailure) throw new Error("private-provider-details");
      return "synthetic-admin-client";
    } },
    "./agent-auth.ts": auth, "./agent-api.ts": { ProgramAgentService },
  });
  const modules = { "@/lib/program-review/agent-route": wrapper, "@/lib/program-review/agent-auth": auth };
  function route(path) { return evaluate(routeSources.get(path), modules); }
  function req(definition, { authenticated = true, cookie = false, body = { note: "Public fixture" }, query = definition.query ?? "",
    media = "application/json" } = {}) {
    const path = definition.path.replace("[id]", id).replace("[key]", "woolimworks");
    return new Request(`https://fixture.example/api/agent/${path}${query}`, {
      method: definition.verb,
      headers: { ...(authenticated ? { Authorization: `Bearer ${credential}` } : {}),
        ...(cookie ? { Cookie: "sb-session=synthetic-admin-session" } : {}),
        ...(definition.verb === "POST" ? { "Content-Type": media } : {}) },
      ...(definition.verb === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
  }
  return { route, req, calls, auth, clients: () => clients };
}

test("all seven agent endpoints deny missing token and admin cookies before DB, route params or POST body access", async () => {
  for (const definition of routes) {
    const h = harness();
    const route = h.route(definition.path);
    const req = h.req(definition, { authenticated: false, cookie: true, body: "malformed-json" });
    let paramsRead = false;
    const context = { get params() { paramsRead = true; throw new Error("must not inspect params"); } };
    const response = await route[definition.verb](req, context);
    assert.equal(response.status, 401, definition.path);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Authorization");
    assert.equal(h.clients(), 0, definition.path); assert.equal(h.calls.length, 0);
    assert.equal(paramsRead, false); assert.equal(req.bodyUsed, false);
  }
});

test("even a supplied bearer credential cannot access routes while the dedicated environment variable is absent", async () => {
  const h = harness({ configured: false });
  for (const definition of routes) assert.equal((await h.route(definition.path)[definition.verb](
    h.req(definition), { params: Promise.resolve(definition.params ?? {}) })).status, 401);
  assert.equal(h.clients(), 0); assert.equal(h.calls.length, 0);
});

test("authenticated endpoints dispatch only their declared operation and expose no additional write methods", async () => {
  const h = harness();
  for (const definition of routes) {
    const route = h.route(definition.path);
    assert.deepEqual(Object.keys(route).filter(key => typeof route[key] === "function"), [definition.verb]);
    assert.equal(route.dynamic, "force-dynamic"); assert.equal(route.runtime, "nodejs");
    const before = h.calls.length;
    const response = await route[definition.verb](h.req(definition), { params: Promise.resolve(definition.params ?? {}) });
    assert.equal(response.status, definition.verb === "POST" ? 201 : 200);
    assert.equal(h.calls.length, before + 1);
    const call = h.calls.at(-1); assert.equal(call.operation, definition.operation);
    if (definition.operation === "detail") assert.equal(call.args[0], id);
    if (definition.operation === "text") assert.deepEqual(call.args, [id, attachmentId]);
    if (definition.operation === "searchPrograms") {
      assert.equal(call.args[0].get("status"), "collected"); assert.equal(call.args[0].get("q"), "public");
    }
    if (definition.verb === "POST") {
      assert.equal(call.args[0], definition.params.id ?? definition.params.key);
      assert.equal(call.args[1].note, "Public fixture");
    }
    assert.equal((await response.json()).operation, definition.operation);
  }
});

test("both write endpoints enforce JSON and stream body limits before the service write operation", async () => {
  for (const definition of routes.filter(route => route.verb === "POST")) {
    const h = harness(), route = h.route(definition.path);
    for (const [options, status, code] of [
      [{ body: "malformed-json" }, 400, "INVALID_BODY"],
      [{ media: "text/plain" }, 415, "JSON_REQUIRED"],
      [{ body: { note: "a".repeat(65_536) } }, 413, "BODY_TOO_LARGE"],
    ]) {
      const response = await route.POST(h.req(definition, options), { params: Promise.resolve(definition.params) });
      assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: code });
    }
    assert.equal(h.calls.length, 0);
  }
});

test("text route rejects extra or duplicate query keys instead of broadening attachment scope", async () => {
  const definition = routes.find(route => route.operation === "text");
  const h = harness(), route = h.route(definition.path);
  for (const query of ["?storage_path=other", `?attachment=${attachmentId}&attachment=${id}`, `?attachment=${attachmentId}&program_id=${id}`]) {
    const response = await route.GET(h.req(definition, { query }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "INVALID_QUERY" });
  }
  assert.equal(h.calls.length, 0);
});

test("service and client construction failures return fixed private errors without provider details", async () => {
  const definition = routes[0];
  for (const options of [{ failure: new Error("private-provider-details") }, { clientFailure: true }]) {
    const h = harness(options);
    const response = await h.route(definition.path).GET(h.req(definition));
    assert.equal(response.status, 500); assert.equal(await response.text(), '{"error":"REQUEST_FAILED"}');
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("the agent credential alone grants no access to the existing admin review route", async () => {
  const admin = evaluate(compile("../../app/api/admin/program-review/run/route.ts"), {
    "@/lib/content-ops/data": { authenticatedAdmin: async () => null },
    "@/lib/supabase/admin": { createAdminClient() { throw new Error("must not access DB"); } },
    "@/lib/program-review/requirements-runner": { runRequirementsTask() { throw new Error("must not run"); } },
    "@/lib/program-review/attachment-runner": { runAttachmentTask() { throw new Error("must not run"); } },
    "@/lib/program-review/jobs": { withReviewJob() { throw new Error("must not run"); } },
  });
  const req = new Request("https://fixture.example/api/admin/program-review/run", {
    method: "POST", headers: { Authorization: `Bearer ${credential}`, Origin: "https://fixture.example" }, body: "task=all",
  });
  assert.equal((await admin.GET(req)).status, 401);
  assert.equal((await admin.POST(req)).status, 401);
  assert.equal(req.bodyUsed, false);
});
