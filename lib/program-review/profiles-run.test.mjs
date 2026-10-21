import assert from "node:assert/strict";
import test from "node:test";
import { loadMatchProfiles, loadMatchProfilesSnapshot, MatchProfilesError } from "./profiles-run.ts";
import { SELF_PROFILES, WOOLIMWORKS_API_FIELD_NAMES } from "./profiles.ts";

const instant = new Date("2026-10-21T09:00:00+09:00");
const fakeToken = ["TEST", "ONLY", "NOT", "A", "REAL", "CREDENTIAL"].join("_");
const priorToken = process.env.WOOLIMWORKS_AGENT_TOKEN;
test.before(() => { process.env.WOOLIMWORKS_AGENT_TOKEN = fakeToken; });
test.after(() => {
  if (priorToken === undefined) delete process.env.WOOLIMWORKS_AGENT_TOKEN;
  else process.env.WOOLIMWORKS_AGENT_TOKEN = priorToken;
});

const customer = (id, extra = {}) => ({
  id, name: `가상 고객 ${id}`, companyName: "", customerKind: "customer", region: "", foundedOn: "",
  contactName: "가상 담당자", contactLink: "https://private.invalid/", staffContact: "000-0000-0000",
  businessRegistrationNumber: "0000000000", memo: "FAKE_PRIVATE_MEMO", ...extra,
});
const project = (customerId, extra = {}) => ({
  id: `project-${customerId}`, customerId, projectCategory: "design", createdAt: "2024-01-01T00:00:00Z",
  updatedAt: instant.toISOString(), customerName: "FAKE_PRIVATE_CUSTOMER_NAME", memo: "FAKE_PRIVATE_PROJECT_MEMO", ...extra,
});

function store(initial = null) { return { row: structuredClone(initial), owner: null, calls: [], revision: 1, contextReads: 0,
  selfProfiles: SELF_PROFILES.map(row => ({ id: row.id, name: row.name, aliases: row.aliases, profile: {}, version: 1 })) }; }
function admin(storage, clock = () => instant.getTime()) {
  return {
    from(table) {
      if (table === "openchat_program_self_profiles") return {
        async select() { return { data: structuredClone(storage.selfProfiles), error: storage.selfError ?? null }; },
      };
      if (table === "openchat_program_match_context") return { select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { revision: storage.revisions?.[storage.contextReads++] ?? storage.revision }, error: null }; } };
      assert.equal(table, "openchat_match_profiles_cache");
      return { select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: structuredClone(storage.row), error: null }; } };
    },
    async rpc(name, args) {
      storage.calls.push({ name, args: structuredClone(args) });
      if (name === "claim_openchat_match_profiles_refresh") {
        if (storage.owner || (storage.row?.fetched_at && Date.parse(storage.row.expires_at) > clock())) return { data: false, error: null };
        storage.owner = args.p_owner;
        storage.row ||= { cache_date: args.p_cache_date, payload: [], field_names: {}, fetched_at: null, expires_at: null, refresh_state: null };
        return { data: true, error: null };
      }
      if (args.p_owner !== storage.owner) return { data: false, error: null };
      if (name === "checkpoint_openchat_match_profiles_refresh") {
        storage.row.refresh_state = structuredClone(args.p_state); storage.owner = null;
      } else if (name === "finish_openchat_match_profiles_refresh") {
        Object.assign(storage.row, { payload: structuredClone(args.p_payload), field_names: structuredClone(args.p_field_names),
          fetched_at: new Date(clock()).toISOString(), expires_at: args.p_expires_at, refresh_state: null });
        storage.owner = null;
      } else if (name === "release_openchat_match_profiles_refresh") { storage.owner = null; }
      else assert.fail("Unexpected profile-cache RPC");
      return { data: true, error: null };
    },
  };
}

function api({ customers = [customer("one")], projects = [], histories = {}, failAt, status = 503, throwAt, gate, paginated = false } = {}) {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    requests.push(url);
    assert.equal(url.origin, "https://hub.woolimcompany.kr");
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "manual"); assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, `Bearer ${fakeToken}`);
    if (requests.length === 1 && gate) await gate;
    if (requests.length === throwAt) throw new Error(fakeToken + " FAKE_PRIVATE_ERROR");
    if (requests.length === failAt) return new Response(fakeToken + " FAKE_PRIVATE_RESPONSE", {
      status, headers: status === 302 ? { Location: "https://attacker.invalid/collect" } : {},
    });
    let body;
    if (url.pathname === "/api/agent/customers") body = { customers, ...(paginated ? { hasMore: true } : {}) };
    else if (url.pathname === "/api/agent/projects") body = { projects };
    else {
      const id = decodeURIComponent(url.pathname.slice("/api/agent/customers/".length));
      assert.ok(customers.some((row) => row.id === id));
      body = { customer: customer(id), projects: projects.filter((row) => row.customerId === id),
        legacyPrograms: histories[id] ? [{ id: `legacy-${id}`, customerId: id, note: "FAKE_PRIVATE_LEGACY_NOTE" }] : [], quoteRequests: [] };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { requests, fetchImpl };
}

function options(boundary, extra = {}) {
  return { now: instant, fetchImpl: boundary.fetchImpl, requestIntervalMs: 0, ...extra };
}
function absentPrivateValues(value) {
  const { field_names: fieldNames, ...storedData } = value;
  assert.ok(fieldNames === undefined || typeof fieldNames === "object");
  const serialized = JSON.stringify(storedData);
  for (const forbidden of [fakeToken, "FAKE_PRIVATE", "0000000000", "contactName", "staffContact", "businessRegistrationNumber"]) {
    assert.equal(serialized.includes(forbidden), false, "Only minimized profile information may be persisted");
  }
}
const hasCall = (storage, name) => storage.calls.some((call) => call.name === name);

test("완료 고객 캐시를 재사용해도 승인된 자사 프로필은 매번 최신 비공개 저장소에서 읽는다", async () => {
  const storage = store({ payload: [], fetched_at: instant.toISOString(), expires_at: new Date(instant.getTime() + 3600000).toISOString() });
  const boundary = api(), client = admin(storage);
  assert.equal((await loadMatchProfiles(client, options(boundary)))[0].region, null);
  storage.selfProfiles[0].profile = { region: "부산", founded_on: "2018", certifications: null };
  storage.selfProfiles[0].version++;
  const next = await loadMatchProfiles(client, options(boundary));
  assert.equal(next[0].region, "부산");
  assert.equal(next[0].foundedOn, null);
  assert.equal(next[0].certifications, null);
  assert.equal(boundary.requests.length, 0);
  assert.deepEqual(storage.row.payload, []);
});

test("프로필·캐시 조회 중 revision이 변하면 안정된 스냅샷을 다시 읽고 계속 바뀌면 보류한다", async () => {
  const initial = { payload: [], fetched_at: instant.toISOString(), expires_at: new Date(instant.getTime() + 3600000).toISOString() };
  const storage = store(initial), boundary = api();
  storage.revisions = [1, 2, 2, 2];
  const snapshot = await loadMatchProfilesSnapshot(admin(storage), options(boundary));
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.profiles.length, 2);
  assert.equal(storage.contextReads, 4);
  const changing = store(initial);
  changing.revisions = [1, 2, 3, 4, 5, 6];
  await assert.rejects(loadMatchProfilesSnapshot(admin(changing), options(boundary)), error => error.code === "profile_context_changed");
  assert.equal(changing.contextReads, 6);
  assert.equal(boundary.requests.length, 0);
});

test("승인 자사 저장소를 읽지 못하면 옛 하드코딩 사실이나 고객만으로 매칭하지 않는다", async () => {
  const storage = store({ payload: [], fetched_at: instant.toISOString(), expires_at: new Date(instant.getTime() + 3600000).toISOString() });
  storage.selfError = { message: "FAKE_PRIVATE_SELF_ERROR" };
  await assert.rejects(loadMatchProfiles(admin(storage), options(api())), error => {
    assert.equal(error.code, "self_profiles_read");
    assert.doesNotMatch(error.message, /FAKE_PRIVATE/);
    return true;
  });
});

test("공식 계약의 등록일·지원사업·인증·상세 이력으로 고객을 확정하고 민감 정보는 저장하지 않는다", async () => {
  const rows = [customer("recent", { region: "부산", foundedOn: "2020" }), customer("old", { activeProjectCount: 99, lastActivityAt: instant.toISOString() }),
    customer("support"), customer("cert"), customer("own"), customer("legacy"), customer("inactive", { active: false }), customer("partner", { customerKind: "partner" })];
  const boundary = api({ customers: rows, histories: { legacy: true }, projects: [
    project("recent", { createdAt: "2025-04-21T00:00:00Z" }), project("old"),
    project("support", { projectCategory: "support_client" }), project("cert", { projectCategory: "certification" }),
    project("own", { projectCategory: "support_company" }), project("old", { id: "inactive-project", active: false, createdAt: instant.toISOString() }),
  ] });
  const storage = store();
  const result = await loadMatchProfiles(admin(storage), options(boundary));
  assert.deepEqual(result.filter((row) => row.targetKind === "customer").map((row) => row.targetId), ["recent", "support", "cert", "legacy"]);
  assert.equal(result.length, 6);
  assert.equal(result.find((row) => row.targetId === "cert").certifications, null);
  assert.equal(result.find((row) => row.targetId === "recent").hasSupportHistory, false);
  assert.ok(result.every((row) => row.employees === null && row.industries === null && row.revenueKrw === null));
  assert.equal(boundary.requests.length, 6);
  assert.deepEqual(storage.row.field_names, WOOLIMWORKS_API_FIELD_NAMES);
  assert.deepEqual(Object.keys(storage.row.payload[0]).sort(), ["id", "name", "region", "foundedOn", "hasSupportHistory"].sort());
  absentPrivateValues(storage.row);
});

test("유효한 24시간 완료 캐시는 인증값이나 외부 요청 없이 재사용한다", async () => {
  const storage = store({ payload: [{ id: "cached", name: "가상 캐시 고객", region: null, foundedOn: null, hasSupportHistory: true }],
    fetched_at: new Date(instant.getTime() - 3600000).toISOString(), expires_at: new Date(instant.getTime() + 23 * 3600000).toISOString() });
  const boundary = api();
  delete process.env.WOOLIMWORKS_AGENT_TOKEN;
  try {
    const result = await loadMatchProfiles(admin(storage), options(boundary));
    assert.equal(result.length, 3); assert.equal(result[2].targetId, "cached");
    assert.equal(boundary.requests.length, 0); assert.equal(storage.calls.length, 0);
  } finally { process.env.WOOLIMWORKS_AGENT_TOKEN = fakeToken; }
});

test("빈 payload라도 fetched_at 없는 staging은 완료 캐시로 사용하지 않는다", async () => {
  const storage = store({ payload: [], fetched_at: null, expires_at: new Date(instant.getTime() + 86400000).toISOString(), refresh_state: null });
  const boundary = api({ customers: [], projects: [] });
  const result = await loadMatchProfiles(admin(storage), options(boundary));
  assert.equal(result.length, 2); assert.equal(boundary.requests.length, 2);
  assert.ok(storage.row.fetched_at); assert.equal(hasCall(storage, "finish_openchat_match_profiles_refresh"), true);
});

test("40개 상세씩 진행만 저장하고 다음 실행에서 공식 목록을 재수신하지 않고 재개한다", async () => {
  const customers = Array.from({ length: 41 }, (_, index) => customer(`fixture-${index}`));
  const boundary = api({ customers, histories: { "fixture-40": true } });
  const storage = store(), client = admin(storage);
  await assert.rejects(loadMatchProfiles(client, options(boundary, { maxDetailsPerRun: 1000 })), (error) => error.code === "refresh_pending");
  assert.equal(boundary.requests.length, 42);
  assert.equal(storage.row.fetched_at, null); assert.equal(storage.row.refresh_state.cursor, 40);
  assert.equal(hasCall(storage, "finish_openchat_match_profiles_refresh"), false);
  absentPrivateValues(storage.row);
  const before = structuredClone(storage.row.refresh_state);
  const failing = api({ customers, failAt: 1 });
  await assert.rejects(loadMatchProfiles(client, options(failing)), (error) => error.code === "api_response");
  assert.deepEqual(storage.row.refresh_state, before);
  assert.equal(storage.row.fetched_at, null);
  const result = await loadMatchProfiles(client, options(boundary));
  assert.equal(boundary.requests.length, 43);
  assert.deepEqual(result.filter((row) => row.targetKind === "customer").map((row) => row.targetId), ["fixture-40"]);
  assert.equal(storage.row.refresh_state, null); assert.ok(storage.row.fetched_at);
});

test("상세 일부 실패 시 완료 캐시나 부분 진행을 덮어쓰지 않는다", async () => {
  const boundary = api({ customers: [customer("first"), customer("second")], histories: { first: true }, failAt: 4 });
  const storage = store();
  await assert.rejects(loadMatchProfiles(admin(storage), options(boundary)), (error) => error.code === "api_response");
  assert.equal(storage.row.fetched_at, null); assert.equal(storage.row.refresh_state, null);
  assert.equal(hasCall(storage, "finish_openchat_match_profiles_refresh"), false);
  assert.equal(hasCall(storage, "checkpoint_openchat_match_profiles_refresh"), false);
  assert.equal(hasCall(storage, "release_openchat_match_profiles_refresh"), true);
});

test("redirect는 따라가지 않고 Authorization을 고정된 호스트에만 전송한다", async () => {
  const boundary = api({ failAt: 1, status: 302 }), storage = store();
  await assert.rejects(loadMatchProfiles(admin(storage), options(boundary)), (error) => {
    assert.equal(error.code, "api_redirect"); assert.equal(error.message.includes(fakeToken), false); return true;
  });
  assert.equal(boundary.requests.length, 1); assert.equal(storage.row.fetched_at, null);
});

test("projects 권한 오류·서버 본문과 fetch 예외에 포함된 가짜 비밀을 오류로 노출하지 않는다", async () => {
  for (const setup of [{ failAt: 2, status: 403 }, { throwAt: 1 }]) {
    const boundary = api(setup), storage = store();
    await assert.rejects(loadMatchProfiles(admin(storage), options(boundary)), (error) => {
      assert.ok(error instanceof MatchProfilesError);
      assert.equal(error.message.includes(fakeToken), false); assert.equal(String(error.stack).includes(fakeToken), false);
      return true;
    });
    assert.equal(storage.row.fetched_at, null);
    assert.equal(hasCall(storage, "release_openchat_match_profiles_refresh"), true);
  }
});

test("동일 프로세스의 동시 호출은 한 번만 갱신한다", async () => {
  const boundary = api({ histories: { one: true } }), storage = store(), client = admin(storage);
  const [first, second] = await Promise.all([loadMatchProfiles(client, options(boundary)), loadMatchProfiles(client, options(boundary))]);
  assert.deepEqual(first, second); assert.equal(boundary.requests.length, 3);
  assert.equal(storage.calls.filter((call) => call.name === "claim_openchat_match_profiles_refresh").length, 1);
});

test("서로 다른 클라이언트의 동시 갱신은 DB lease로 차단한다", async () => {
  let release, entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const firstBoundary = api({ histories: { one: true }, gate });
  const original = firstBoundary.fetchImpl;
  firstBoundary.fetchImpl = (...args) => { entered(); return original(...args); };
  const secondBoundary = api(), storage = store();
  const first = loadMatchProfiles(admin(storage), options(firstBoundary));
  await started;
  await assert.rejects(loadMatchProfiles(admin(storage), options(secondBoundary)), (error) => error.code === "refresh_in_progress");
  assert.equal(secondBoundary.requests.length, 0);
  release(); await first;
});

test("토큰 미설정이면 요청하지 않고 잠금을 해제한다", async () => {
  const boundary = api(), storage = store(); delete process.env.WOOLIMWORKS_AGENT_TOKEN;
  try {
    await assert.rejects(loadMatchProfiles(admin(storage), options(boundary)), (error) => error.code === "api_token_missing");
    assert.equal(boundary.requests.length, 0); assert.equal(storage.owner, null);
    assert.equal(storage.row.fetched_at, null);
  } finally { process.env.WOOLIMWORKS_AGENT_TOKEN = fakeToken; }
});

test("요청 간격과 전체 실행 시간을 지키고 완료 시점부터 캐시 24시간을 계산한다", async () => {
  let elapsed = 0;
  const boundary = api({ histories: { one: true } }), storage = store();
  await loadMatchProfiles(admin(storage, () => instant.getTime() + elapsed), options(boundary, {
    clock: () => elapsed, sleep: async (milliseconds) => { elapsed += milliseconds; }, requestIntervalMs: 1100,
  }));
  assert.equal(elapsed, 2200);
  assert.equal(Date.parse(storage.row.expires_at) - Date.parse(storage.row.fetched_at), 86400000);
  elapsed = 0;
  const failed = store(), other = api();
  await assert.rejects(loadMatchProfiles(admin(failed), options(other, {
    clock: () => elapsed, sleep: async (milliseconds) => { elapsed += milliseconds; }, requestIntervalMs: 1100, maxDurationMs: 1500,
  })), (error) => error.code === "refresh_timeout");
  assert.equal(failed.row.fetched_at, null); assert.equal(other.requests.length, 2);
});

test("목록 계약이 페이지 응답으로 바뀌면 일부만 완료 캐시로 저장하지 않는다", async () => {
  const boundary = api({ paginated: true }), storage = store();
  await assert.rejects(loadMatchProfiles(admin(storage), options(boundary)), (error) => error.code === "api_contract");
  assert.equal(boundary.requests.length, 1); assert.equal(storage.row.fetched_at, null);
});

test("캐시 저장소 예외도 인증값이나 내부 에러 내용을 노출하지 않는다", async () => {
  const client = { from() { throw new Error(fakeToken + " FAKE_PRIVATE_DATABASE_ERROR"); } };
  await assert.rejects(loadMatchProfiles(client), (error) => {
    assert.equal(error.code, "profiles_failed"); assert.equal(error.message.includes(fakeToken), false); return true;
  });
});

test("만료 시각 경계에서는 이전 완료 캐시를 반환하지 않고 새 스냅샷으로 바꾼다", async () => {
  const storage = store({ payload: [{ id: "stale", name: "가상 이전 고객", region: null, foundedOn: null, hasSupportHistory: false }],
    fetched_at: new Date(instant.getTime() - 86400000).toISOString(), expires_at: instant.toISOString(), refresh_state: null });
  const boundary = api({ customers: [], projects: [] });
  const result = await loadMatchProfiles(admin(storage), options(boundary));
  assert.equal(result.length, 2); assert.deepEqual(storage.row.payload, []); assert.equal(boundary.requests.length, 2);
});

test("진행 상태에 허용하지 않은 원문 필드가 있으면 재개하거나 완료 캐시에 옮기지 않는다", async () => {
  const storage = store({ payload: [], fetched_at: null, expires_at: null, refresh_state: {
    version: 1, basisNow: instant.toISOString(), cursor: 0,
    customers: [{ id: "one", name: "가상 고객", region: null, foundedOn: null, hasSupportHistory: false, hasRecentProject: false, memo: "FAKE_PRIVATE_MEMO" }],
  } });
  const boundary = api();
  await assert.rejects(loadMatchProfiles(admin(storage), options(boundary)), (error) => error.code === "cache_state");
  assert.equal(boundary.requests.length, 0); assert.equal(storage.row.fetched_at, null); assert.equal(storage.owner, null);
});

test("개별 고객 식별자에 URL 구분자가 있어도 공식 호스트의 인코딩된 경로만 사용한다", async () => {
  const id = "//attacker.invalid/query?fake=value";
  const boundary = api({ customers: [customer(id)], histories: { [id]: true } }), storage = store();
  const result = await loadMatchProfiles(admin(storage), options(boundary));
  assert.equal(result[2].targetId, id);
  assert.equal(boundary.requests[2].origin, "https://hub.woolimcompany.kr");
  assert.equal(boundary.requests[2].search, "");
});

test("NaN 설정으로 요청·chunk 제한을 우회할 수 없다", async () => {
  for (const override of [{ maxDetailsPerRun: NaN }, { maxDurationMs: NaN }, { requestIntervalMs: NaN }, { requestTimeoutMs: NaN }]) {
    const boundary = api(), storage = store();
    await assert.rejects(loadMatchProfiles(admin(storage), options(boundary, override)), (error) => error.code === "invalid_options");
    assert.equal(boundary.requests.length, 0); assert.equal(storage.row.fetched_at, null); assert.equal(storage.owner, null);
  }
});
