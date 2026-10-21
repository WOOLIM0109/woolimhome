import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../../app/api/admin/program-review/run/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness({ authenticated = true, failure = false, ids = [] } = {}) {
  const calls = [];
  const query = { select() { return this; }, gte() { return this; }, order() { return this; }, limit() { return this; },
    abortSignal() { return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }); } };
  const admin = { from: () => query };
  const result = { extracted: 7, remaining: 69 };
  const modules = {
    "@/lib/content-ops/data": { authenticatedAdmin: async () => authenticated },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/program-review/requirements-runner": { runRequirementsTask: async (options) => {
      calls.push(["requirements", options]); if (failure) throw new Error("private-provider-body"); return result;
    } },
    "@/lib/program-review/attachment-runner": { runAttachmentTask: async (options) => { calls.push(["attachments", options]); return result; } },
    "@/lib/program-review/jobs": { withReviewJob: async (_, task, work) => { calls.push(["lease", task]); return work(); } },
  };
  const context = { exports: {}, require: (id) => { assert.ok(modules[id], id); return modules[id]; }, Response, AbortSignal, URL, Date };
  vm.runInNewContext(compiled, context);
  function post(fields = {}, origin = "https://www.woolimcompany.kr") {
    const body = new FormData(); for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return context.exports.POST(new Request("https://www.woolimcompany.kr/api/admin/program-review/run", {
      method: "POST", body, headers: { Origin: origin },
    }));
  }
  return { ...context.exports, calls, post };
}
test("admin review denies unauthenticated reads and writes", async () => {
  const h = harness({ authenticated: false });
  assert.equal((await h.GET()).status, 401); assert.equal((await h.post({ task: "all" })).status, 401);
  assert.equal(h.calls.length, 0);
});
test("cookie writes require the exact same origin before any work", async () => {
  const h = harness(); assert.equal((await h.post({ task: "all" }, "https://elsewhere.example")).status, 403);
  assert.equal(h.calls.length, 0);
});
test("manual attachments take the shared lease and only the confirmed deadline scope", async () => {
  const h = harness(); assert.equal((await h.post({ task: "attachments" })).status, 200);
  assert.equal(h.calls[0][0], "lease"); const options = h.calls[1][1];
  assert.equal(options.maxProcessed, 100); assert.equal(options.maxDiscovered, 100);
  assert.equal(options.knownDeadlineOnly, true); assert.equal(options.includeExcluded, true);
});
test("confirmed scope supplies all 76 IDs to the runner", async () => {
  const ids = Array.from({ length: 76 }, (_, i) => `notice-${i}`); const h = harness({ ids });
  assert.equal((await h.post({ task: "requirements" })).status, 200);
  assert.deepEqual(Array.from(h.calls[0][1].programIds), ids);
});
test("recovery rejects malformed IDs and explicitly limits the selected notice", async () => {
  const h = harness(); assert.equal((await h.post({ task: "recover", programId: "bad" })).status, 400);
  assert.equal(h.calls.length, 0);
  const id = "95588b72-e451-4656-a1a9-932e460c8deb";
  await h.post({ task: "recover", programId: id });
  assert.equal(h.calls[0][1].recoveryProgramId, id); assert.equal(h.calls[0][1].limit, 1);
});
test("unknown actions never execute and provider exceptions never reach HTML", async () => {
  const h = harness({ failure: true }); assert.equal((await h.post({ task: "unknown" })).status, 400);
  const response = await h.post({ task: "all" }); assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private-provider-body/);
});
