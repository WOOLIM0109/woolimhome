import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
function loader(overrides = {}) {
  const cache = new Map();
  function load(url) {
    const key = String(url);
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cache.has(key)) return cache.get(key).exports;
    const compiledModule = { exports: {} }; cache.set(key, compiledModule);
    const source = ts.transpileModule(readFileSync(url, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const execute = new Function("module", "exports", "require", source);
    execute(compiledModule, compiledModule.exports, id => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id.startsWith(".")) return load(new URL(id.endsWith(".ts") ? id : `${id}.ts`, url));
      assert.ok(!id.startsWith("@/"), `Unexpected application boundary ${id}`);
      return nativeRequire(id);
    });
    return compiledModule.exports;
  }
  return load;
}
const load = loader();
const { ProgramAdminService } = load(new URL("./admin-api.ts", import.meta.url));
const { ProgramApiError } = load(new URL("./agent-auth.ts", import.meta.url));
const NOW = new Date("2026-10-21T01:00:00.000Z"), DAY = "2026-10-21", SNAPSHOT = "2026-10-21T00:30:00.000Z";
const pid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const aid = n => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORIGIN = "https://fixture-project.supabase.co";
const errorIs = (status, code) => error => error instanceof ProgramApiError && error.status === status && (!code || error.code === code);

function database({ bucketPublic = false, storageFailure = false, signedOrigin = ORIGIN } = {}) {
  const path = `2026/10/${pid(1)}/u8-Zml4dHVyZS5wZGY.pdf`;
  const tables = {
    openchat_sources: [{ id: pid(90), name: "가상 기관", source_key: "public-fixture", category: "public", enabled: true,
      last_status: "failed", last_checked_at: SNAPSHOT, last_succeeded_at: "2026-10-20T00:00:00.000Z", last_error: "FAKE_PRIVATE_SOURCE_ERROR token=not-a-real-credential" }],
    openchat_programs: [{ id: pid(1), title: "가상 공공공고", source_id: pid(90), source_url: "https://public.invalid/notice?id=1", source: { name: "가상 기관" },
      status: "review_required", deadline_at: "2026-10-22T09:00:00.000Z", created_at: "2026-10-20T00:00:00.000Z", updated_at: SNAPSHOT }],
    openchat_program_requirements: [{ program_id: pid(1), status: "extracted", requirements: { regions: ["전국"] },
      source_complete: true, input_truncated: false, normalization_version: 3, source_checked_at: SNAPSHOT, updated_at: SNAPSHOT,
      matched_normalization_version: 3, matched_review_date: DAY, matched_source_checked_at: SNAPSHOT, matched_profile_revision: 1, matched_rule_version: 2 }],
    openchat_program_matches: [{ program_id: pid(1), target_kind: "self", target_id: "woolim-company", target_name: "가상 자사",
      verdict: "candidate", reasons: ["조건부 후보: 확인 필요"], score: 12, review_date: DAY, selected_for_reading: true }],
    openchat_program_attachments: [{ id: aid(1), program_id: pid(1), storage_path: path, file_name: "가상 공고.pdf", file_ext: "pdf", text_status: "extracted",
      text_chars: 100, text_content: "[p.1]\n공개 원문", created_at: "2026-10-20T00:00:00.000Z", extracted_at: "2026-10-21T00:00:00.000Z", processing_started_at: null,
      source_url: "https://public.invalid/?signature=FAKE_STORAGE_URL", error: "FAKE_PRIVATE_ATTACHMENT_ERROR" }],
    openchat_program_attachment_discovery: [{ program_id: pid(1), status: "found", checked_at: "2026-10-21T00:10:00.000Z", detail_text: "[para.1] 공개 본문", error: "FAKE_PRIVATE_DISCOVERY_ERROR" }],
    openchat_program_match_context: [{ id: "current", revision: 1 }],
    openchat_program_self_profiles: ["woolim-company", "cellavento"].map(id => ({ id, name: `가상 자사 ${id}`, aliases: [], profile: {}, version: 1, updated_at: SNAPSHOT })),
    openchat_match_profiles_cache: [{ cache_date: DAY, payload: [{ id: "customer-fixture", name: "가상 고객사" }], fetched_at: SNAPSHOT, expires_at: "2026-10-22T00:00:00.000Z" }],
    openchat_program_reviews: [], openchat_program_profile_proposals: [], openchat_program_review_jobs: [],
  };
  const queries = [], storage = [], rpc = [];
  function from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    let fields = "*", single = false, start = 0, end = Infinity, result;
    const filters = [], orders = [];
    const builder = {
      select(value = "*") { fields = value; return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      neq(key, value) { filters.push(row => row[key] !== value); return this; },
      gte(key, value) { filters.push(row => row[key] != null && row[key] >= value); return this; },
      gt(key, value) { filters.push(row => row[key] != null && row[key] > value); return this; },
      lte(key, value) { filters.push(row => row[key] != null && row[key] <= value); return this; },
      lt(key, value) { filters.push(row => row[key] != null && row[key] < value); return this; },
      in(key, values) { filters.push(row => values.includes(row[key])); return this; },
      is(key, value) { filters.push(row => row[key] === value); return this; },
      not(key, operator, value) { assert.equal(operator, "is"); assert.equal(value, null); filters.push(row => row[key] != null); return this; },
      or(expression) { const prefix = "deadline_at.is.null,deadline_at.gte."; assert.ok(expression.startsWith(prefix));
        filters.push(row => row.deadline_at === null || Date.parse(row.deadline_at) >= Date.parse(expression.slice(prefix.length))); return this; },
      order(key, options = {}) { orders.push([key, options.ascending !== false]); return this; },
      range(first, last) { start = first; end = last; return this; }, limit(value) { end = start + value - 1; return this; },
      maybeSingle() { single = true; return this; }, single() { single = true; return this; }, overrideTypes() { return this; },
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      then(resolve, reject) {
        result ||= Promise.resolve().then(() => {
          queries.push({ table, fields });
          const rows = tables[table].filter(row => filters.every(filter => filter(row))).sort((a, b) => {
            for (const [key, ascending] of orders) { const x = key === "score" ? Number(a[key]) : a[key], y = key === "score" ? Number(b[key]) : b[key];
              if (x < y) return ascending ? -1 : 1; if (x > y) return ascending ? 1 : -1; }
            return 0;
          }).slice(start, end === Infinity ? undefined : end + 1).map(row => fields === "*" ? structuredClone(row)
            : Object.fromEntries(fields.split(/,(?![^()]*\))/).map(field => field.trim().split(":")[0]).map(key => [key, structuredClone(row[key] ?? null)])));
          return { data: single ? rows[0] ?? null : rows, error: null };
        });
        return result.then(resolve, reject);
      },
    };
    return builder;
  }
  const admin = { from, async rpc(name, args) {
    rpc.push({ name, args });
    assert.equal(name, "apply_openchat_program_profile_proposal");
    return { data: { id: args.p_proposal_id, status: args.p_approve ? "approved" : "rejected" }, error: null };
  }, storage: {
    async getBucket(bucket) { storage.push({ operation: "getBucket", bucket }); return { data: { id: bucket, public: bucketPublic }, error: null }; },
    from(bucket) { storage.push({ operation: "from", bucket }); return { async createSignedUrl(key, seconds, options) {
      storage.push({ operation: "sign", bucket, key, seconds, options });
      return storageFailure ? { data: null, error: { message: "FAKE_PRIVATE_STORAGE_ERROR" } }
        : { data: { signedUrl: `${signedOrigin}/storage/v1/object/sign/${bucket}/${key}?token=synthetic-download-value` }, error: null };
    } }; },
  } };
  return { admin, tables, queries, storage, rpc, path, service: new ProgramAdminService(admin, NOW, ORIGIN) };
}

function routeHarness({ authenticated = true, createFailure = false } = {}) {
  const events = [], dispatches = [], user = { id: "admin-fixture", email: "admin@fixture.invalid" };
  class FakeService { constructor(client) { assert.equal(client, "fake-private-client"); events.push("service"); } }
  for (const operation of ["overview", "searchPrograms", "detail", "text", "download", "reviewProposal"]) {
    FakeService.prototype[operation] = async (...args) => { dispatches.push({ operation, args });
      return operation === "download" ? new Response(null, { status: 302, headers: { Location: "https://fixture-project.supabase.co/storage/v1/object/sign/program-attachments/fixture" } }) : { operation };
    };
  }
  const overrides = {
    "@/lib/content-ops/data": { authenticatedAdmin: async () => { events.push("auth"); return authenticated ? user : null; } },
    "@/lib/supabase/admin": { createAdminClient() { events.push("client"); if (createFailure) throw new Error("FAKE_PRIVATE_CLIENT_ERROR"); return "fake-private-client"; } },
    [String(new URL("./admin-api.ts", import.meta.url))]: { ProgramAdminService: FakeService },
  };
  const wrapperLoad = loader(overrides);
  const wrapper = wrapperLoad(new URL("./admin-route.ts", import.meta.url));
  overrides["@/lib/program-review/admin-route"] = wrapper;
  overrides["@/lib/program-review/agent-auth"] = wrapperLoad(new URL("./agent-auth.ts", import.meta.url));
  const invoke = (request, callback = async () => ({ ok: true })) => wrapper.programAdminRoute(request, async (...args) => {
    events.push("work"); return callback(...args);
  });
  return { invoke, events, user, dispatches,
    route: path => wrapperLoad(new URL(`../../app/api/admin/program-review/${path}/route.ts`, import.meta.url)) };
}
function req({ method = "GET", origin = "https://fixture.invalid", body, headers = {}, path = "overview" } = {}) {
  return new Request(`https://fixture.invalid/api/admin/program-review/${path}`, {
    method, headers: { ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

test("admin cookie authentication precedes DB, storage, request body and bearer credentials", async () => {
  for (const request of [req(), req({ headers: { Authorization: "Bearer syntheticAgentCredentialThatIsNotAnAdminCookie" } }),
    req({ method: "POST", origin: "https://elsewhere.invalid", body: "malformed" })]) {
    const h = routeHarness({ authenticated: false });
    const response = await h.invoke(request, () => assert.fail("Unauthenticated callback must not open DB or storage"));
    assert.equal(response.status, 401);
    assert.deepEqual(h.events, ["auth"]);
    assert.equal(request.bodyUsed, false);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
  }
});

test("admin POST requires exact origin and bounded strict JSON before constructing a privileged client", async () => {
  for (const [request, status] of [
    [req({ method: "POST", origin: "https://elsewhere.invalid", body: {} }), 403],
    [req({ method: "POST", origin: "", body: {} }), 403],
    [req({ method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } }), 415],
    [req({ method: "POST", body: "[]" }), 400],
    [req({ method: "POST", body: "malformed" }), 400],
    [req({ method: "POST", body: { padding: "한".repeat(23000) } }), 413],
    [req({ method: "POST", body: "{}", headers: { "Content-Length": "65537" } }), 413],
  ]) {
    const h = routeHarness();
    assert.equal((await h.invoke(request)).status, status);
    assert.deepEqual(h.events, ["auth"]);
  }
  const h = routeHarness();
  const response = await h.invoke(req({ method: "POST", body: { expected_version: 1, approve: false } }), async (service, user, body) => {
    assert.ok(service); assert.equal(user.id, h.user.id); assert.deepEqual(body, { expected_version: 1, approve: false }); return { approved: false };
  });
  assert.equal(response.status, 200);
  assert.deepEqual(h.events, ["auth", "client", "service", "work"]);
  assert.equal(response.headers.get("vary"), "Cookie");
  const boundary = routeHarness();
  const size = 65536 - Buffer.byteLength(JSON.stringify({ padding: "" }));
  assert.equal((await boundary.invoke(req({ method: "POST", body: { padding: "x".repeat(size) } }))).status, 200);
});

test("all six actual admin routes enforce cookie authentication before params, body, DAL and storage dispatch", async () => {
  const routes = [["overview", "GET"], ["programs", "GET"], ["programs/[id]", "GET"], ["programs/[id]/text", "GET"],
    ["programs/[id]/attachments/[attachmentId]/download", "GET"], ["proposals/[id]", "POST"]];
  for (const [path, method] of routes) {
    const h = routeHarness({ authenticated: false }), route = h.route(path);
    assert.equal(route.dynamic, "force-dynamic"); assert.equal(route.runtime, "nodejs");
    assert.deepEqual(Object.keys(route).filter(key => typeof route[key] === "function"), [method]);
    let paramsRead = false;
    const context = { get params() { paramsRead = true; throw new Error("Params must remain unread before authentication"); } };
    const request = req({ method, path, body: method === "POST" ? "invalid-json" : undefined,
      headers: { Authorization: "Bearer syntheticAgentCredentialThatIsNotAnAdminCookie" } });
    const response = await route[method](request, context);
    assert.equal(response.status, 401, path);
    assert.equal(paramsRead, false); assert.equal(request.bodyUsed, false);
    assert.deepEqual(h.events, ["auth"]); assert.equal(h.dispatches.length, 0);
  }
});

test("actual admin routes dispatch only scoped IDs and authenticated proposal actors", async () => {
  const h = routeHarness();
  const routes = [["overview", "GET", "overview"], ["programs", "GET", "searchPrograms"], ["programs/[id]", "GET", "detail"],
    ["programs/[id]/text", "GET", "text"], ["programs/[id]/attachments/[attachmentId]/download", "GET", "download"], ["proposals/[id]", "POST", "reviewProposal"]];
  for (const [path, method, operation] of routes) {
    const response = await h.route(path)[method](req({ method, path,
      body: method === "POST" ? { expected_version: 1, approve: false } : undefined }),
    { params: Promise.resolve({ id: pid(1), attachmentId: aid(1) }) });
    assert.equal(response.status, operation === "download" ? 302 : 200);
    const call = h.dispatches.at(-1); assert.equal(call.operation, operation);
    if (["detail", "text", "download", "reviewProposal"].includes(operation)) assert.equal(call.args[0], pid(1));
    if (operation === "download") assert.equal(call.args[1], aid(1));
    if (operation === "reviewProposal") {
      assert.deepEqual(call.args[1], { expected_version: 1, approve: false });
      assert.equal(call.args[2], h.user.email);
    }
  }
  const before = h.dispatches.length;
  const download = h.route("programs/[id]/attachments/[attachmentId]/download");
  assert.equal((await download.GET(req({ path: "programs/x/download?url=https://untrusted.invalid" }), { params: Promise.resolve({ id: pid(1), attachmentId: aid(1) }) })).status, 400);
  const text = h.route("programs/[id]/text");
  assert.equal((await text.GET(req({ path: "programs/x/text?attachment=a&attachment=b" }), { params: Promise.resolve({ id: pid(1) }) })).status, 400);
  assert.equal(h.dispatches.length, before);
});

test("admin errors are fixed responses and never include private client or storage diagnostics", async () => {
  const h = routeHarness({ createFailure: true });
  const response = await h.invoke(req());
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /FAKE_PRIVATE/);
});

test("downloads bind program and attachment, use the private fixed bucket for 600 seconds and return only a validated redirect", async () => {
  const f = database();
  const response = await f.service.download(pid(1), aid(1));
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).origin, ORIGIN);
  assert.equal(await response.text(), "");
  const signing = f.storage.find(call => call.operation === "sign");
  assert.equal(signing.bucket, "program-attachments");
  assert.equal(signing.key, f.path);
  assert.equal(signing.seconds, 600);
  assert.equal(signing.options.download, "가상 공고.pdf");
  assert.ok(f.storage.every(call => call.bucket === "program-attachments"));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const other = database(); other.tables.openchat_program_attachments[0].program_id = pid(2);
  await assert.rejects(other.service.download(pid(1), aid(1)), errorIs(404));
  assert.equal(other.storage.length, 0);
  const old = database(); old.tables.openchat_programs[0].created_at = "2026-08-01T00:00:00.000Z";
  await assert.rejects(old.service.download(pid(1), aid(1)), errorIs(404));
  assert.equal(old.storage.length, 0);
});

test("download path traversal, cross-program paths, public buckets and untrusted signed origins never produce a redirect", async () => {
  for (const path of [`2026/10/${pid(2)}/u8-Zml4dHVyZS5wZGY.pdf`, `2026/10/${pid(1)}/../private.pdf`,
    `2026/10/${pid(1)}/u8-malicious%2Fprivate.pdf`, "https://private.invalid/document.pdf"]) {
    const f = database(); f.tables.openchat_program_attachments[0].storage_path = path;
    await assert.rejects(f.service.download(pid(1), aid(1)), error => error instanceof ProgramApiError && error.status >= 400);
    assert.equal(f.storage.length, 0);
  }
  const publicBucket = database({ bucketPublic: true });
  await assert.rejects(publicBucket.service.download(pid(1), aid(1)), error => error instanceof ProgramApiError && error.status >= 400);
  assert.ok(!publicBucket.storage.some(call => call.operation === "sign"));
  for (const setup of [{ signedOrigin: "https://untrusted.invalid" }, { storageFailure: true }]) {
    const f = database(setup);
    await assert.rejects(f.service.download(pid(1), aid(1)), error => {
      assert.ok(error instanceof ProgramApiError); assert.doesNotMatch(error.message, /FAKE_PRIVATE|synthetic-download/); return true;
    });
  }
});

test("profile decisions accept only strict approval/version fields and use the authenticated actor for either branch", async () => {
  for (const approve of [true, false]) {
    const f = database(); const before = JSON.stringify(f.tables);
    const result = await f.service.reviewProposal(pid(8), { expected_version: 2, approve }, "cookie-admin-fixture");
    assert.equal(result.proposal.status, approve ? "approved" : "rejected");
    assert.deepEqual(f.rpc[0], { name: "apply_openchat_program_profile_proposal", args: {
      p_proposal_id: pid(8), p_expected_version: 2, p_actor: "cookie-admin-fixture", p_approve: approve,
    } });
    assert.equal(JSON.stringify(f.tables), before);
  }
  for (const body of [{ expected_version: "2", approve: true }, { expected_version: 0, approve: true }, { expected_version: 1.5, approve: false },
    { expected_version: 2, approve: "true" }, { expected_version: 2 }, { expected_version: 2, approve: true, actor: "forged" }]) {
    const f = database();
    await assert.rejects(f.service.reviewProposal(pid(8), body, "cookie-admin-fixture"), errorIs(400));
    assert.equal(f.rpc.length, 0);
  }
});

test("detail and lists return the latest review per target while keeping older append-only history intact", async () => {
  const f = database();
  const review = (id, kind, target, at, markdown) => ({ id: pid(id), program_id: pid(1), target_kind: kind, target_id: target,
    target_name: "가상 대상", conclusion: "검토", review_markdown: markdown, missing_documents: ["확인할 서류"], next_actions: ["확인 작업"],
    reviewer: "ai:gongo-matcher", created_at: `2026-10-21T00:${at}:00.000Z`, private: "FAKE_PRIVATE_REVIEW_FIELD" });
  f.tables.openchat_program_reviews.push(review(10, "self", "woolim-company", "10", "과거 검토"),
    review(11, "self", "woolim-company", "20", "새 검토"), review(12, "self", "woolim-company", "20", "같은 시각이면 높은 ID"),
    review(13, "self", "cellavento", "15", "다른 자사"), review(14, "customer", "woolim-company", "25", "같은 ID여도 다른 대상 종류"),
    { ...review(15, "self", "woolim-company", "50", "다른 공고"), program_id: pid(2) });
  const history = JSON.stringify(f.tables.openchat_program_reviews);
  const detail = await f.service.detail(pid(1));
  assert.deepEqual(detail.latest_reviews.map(row => row.id), [14, 12, 13].map(pid));
  assert.equal(detail.latest_reviews.find(row => row.id === pid(12)).review_markdown, "같은 시각이면 높은 ID");
  assert.doesNotMatch(JSON.stringify(detail.latest_reviews), /FAKE_PRIVATE/);
  const overview = await f.service.overview();
  assert.deepEqual(overview.today.programs[0].latest_reviews.map(row => row.id), [14, 12, 13].map(pid));
  const listed = await f.service.searchPrograms(new URLSearchParams({ target_kind: "self", target_id: "woolim-company" }));
  assert.deepEqual(listed.programs[0].latest_reviews.map(row => row.id), [14, 12, 13].map(pid));
  assert.equal(JSON.stringify(f.tables.openchat_program_reviews), history);
});

test("overview reports the explicit confirmed-future attachment scope and sanitized institutional error counts", async () => {
  const f = database(), base = f.tables.openchat_programs[0];
  f.tables.openchat_programs.push({ ...base, id: pid(2), status: "excluded" }, { ...base, id: pid(3), deadline_at: null },
    { ...base, id: pid(4), deadline_at: "2026-10-20T00:00:00.000Z" },
    { ...base, id: pid(5), created_at: "2026-08-01T00:00:00.000Z" }, { ...base, id: pid(6) });
  f.tables.openchat_program_attachment_discovery.push({ program_id: pid(2), status: "none", checked_at: SNAPSHOT });
  const attachment = f.tables.openchat_program_attachments[0];
  for (const [index, ext, status, program] of [[2, "pdf", "failed", 2], [3, "hwpx", "no_text", 2], [4, "hwp", "skipped", 2],
    [5, "png", "skipped", 2], [6, "zip", "skipped", 2], [7, "hwp", "pending", 6]]) {
    f.tables.openchat_program_attachments.push({ ...attachment, id: aid(index), program_id: pid(program), file_ext: ext, text_status: status,
      text_chars: 0, storage_path: status === "pending" ? null : attachment.storage_path });
  }
  f.tables.openchat_sources.push({ ...f.tables.openchat_sources[0], id: pid(91), source_key: "second-fixture", name: "다른 가상 기관",
    last_error: "다운로드 실패 https://public.invalid/notice?x=3", last_status: "failed" });
  const result = await f.service.overview();
  assert.deepEqual(result.scope, { lookback_days: 60, attachment_scope: "confirmed_future", deadline_unknown_separate: true });
  const source = result.institutions.find(row => row.id === pid(90));
  assert.deepEqual({ programs: source.programs, recent: source.recent_programs, unknownDeadline: source.deadline_unknown_programs,
    found: source.discovered_programs, none: source.no_links, unvisited: source.unvisited, text: source.text_programs,
    supported: source.supported_documents, extracted: source.supported_extracted, failed: source.supported_failed,
    noText: source.supported_no_text, skipped: source.supported_skipped, unsupported: source.unsupported_documents, zip: source.zip_containers },
  { programs: 3, recent: 5, unknownDeadline: 1, found: 1, none: 1, unvisited: 1, text: 1,
    supported: 5, extracted: 1, failed: 1, noText: 1, skipped: 1, unsupported: 1, zip: 1 });
  assert.equal(source.attachment_warning, true);
  assert.equal(source.last_error, "수집 오류 상세는 비공개입니다.");
  assert.equal(result.institutions.find(row => row.id === pid(91)).last_error, "다운로드 실패 [주소 비공개]");
  assert.doesNotMatch(JSON.stringify(result), /FAKE_PRIVATE|FAKE_STORAGE_URL|storage_path|synthetic-download/);
});

test("admin target lists preserve safe default scope and show confirmation-only fallback without resurrecting mismatches", async () => {
  const f = database(), base = f.tables.openchat_programs[0], matched = f.tables.openchat_program_matches[0];
  f.tables.openchat_programs.push({ ...base, id: pid(2), status: "excluded" },
    { ...base, id: pid(3), deadline_at: "2026-10-21T00:59:59.999Z" }, { ...base, id: pid(4) }, { ...base, id: pid(5) });
  f.tables.openchat_program_matches.push({ ...matched, program_id: pid(2), score: 100 }, { ...matched, program_id: pid(3), score: 90 },
    { ...matched, program_id: pid(4), verdict: "unknown", reasons: ["확인 필요"], score: 80 },
    { ...matched, program_id: pid(5), verdict: "mismatch", reasons: ["명시된 지역 제한 불일치"], score: 1000 });
  const params = new URLSearchParams({ target_kind: "self", target_id: "woolim-company", limit: "10" });
  assert.deepEqual((await f.service.searchPrograms(params)).programs.map(row => row.id), [pid(1)]);
  matched.verdict = "mismatch";
  const fallback = await f.service.searchPrograms(params);
  assert.deepEqual(fallback.programs.map(row => row.id), [pid(4)]);
  assert.equal(fallback.programs[0].match.verdict_label, "확인 필요");
});
