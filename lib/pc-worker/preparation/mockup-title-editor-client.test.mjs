import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script = await readFile(new URL("./mockup-editor-client.mjs", import.meta.url), "utf8");
const mainTitle = { main: "행사 제안서", sub: "브랜드", showSub: false, style: "bold" };
const image = (n, scale = 1) => ({ sha256: String(n).repeat(64), width: 1080 * scale, height: 1080 * scale, scale });
const copy = (value) => JSON.parse(JSON.stringify(value));
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let n = 0; n < 8; n++) await new Promise((resolve) => setImmediate(resolve)); };

async function clientFixture(overrides = {}) {
  const requests = [];
  let imageLoads = 0;
  class Node {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.listeners = new Map(); this.dataset = {}; this.value = ""; this.checked = false; this.disabled = false; this.hidden = false; this.className = ""; this.textContent = ""; }
    set src(value) { this._src = value; imageLoads++; }
    get src() { return this._src; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key === "src" ? "_src" : key]; }
    addEventListener(kind, callback) { const events = this.listeners.get(kind) ?? []; events.push(callback); this.listeners.set(kind, events); }
    emit(kind) { for (const callback of this.listeners.get(kind) ?? []) callback({ preventDefault() {} }); }
    querySelectorAll(selector) { const matches = (node) => selector.startsWith(".") ? node.className.split(" ").includes(selector.slice(1)) : node.tagName === selector; return this.children.flatMap((node) => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit("close"); }
  }
  const nodes = new Map([...script.matchAll(/document\.querySelector\("(#[^"]+)"\)/g)].map((match) => [match[1], new Node()]));
  let titleReview = {
    available: true, revision: 1, baseFingerprint: "a".repeat(64), legacyTitle: "기존 제목",
    title: copy(mainTitle), stale: false, holds: [], draft: image(1, 0.5), final: image(2), active: image(3), activeTitle: copy(mainTitle), legacyFinalAvailable: true, localOnly: true,
    ...overrides,
  };
  let error = null;
  let paused = null;
  const oldReview = { state: { initialized: true }, title: "기존 작업물명", revision: 8, minimum: 1, candidates: [{ sourceSlideNumber: 1, status: "approved", title: "합성" }], boards: [{ templateId: "synthetic-thumb", label: "썸네일", slots: [{ slotId: "hero", position: 1, role: "대표", sourceSlideNumber: 1 }], holds: [], draft: image(7, 0.5), final: image(8) }], requests: [] };
  const context = vm.createContext({
    document: { querySelector: (selector) => nodes.get(selector), createElement: (tag) => new Node(tag) },
    fetch: async (url, options) => {
      requests.push({ url, ...options, ...(options.body ? { parsed: JSON.parse(options.body) } : {}) });
      if (paused) await paused;
      if (error && options.method === "POST") return { ok: false, headers: { get: () => "application/json" }, json: async () => ({ error }) };
      if (url === "/api/mockups") return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ csrfToken: "c".repeat(64), review: copy(oldReview) }) };
      if (url === "/api/mockups/title/save") { titleReview = { ...titleReview, revision: (titleReview.revision ?? 0) + 1, title: JSON.parse(options.body).title, draft: null, final: null }; }
      if (url === "/api/mockups/title/render") { const scale = JSON.parse(options.body).scale; titleReview = { ...titleReview, revision: titleReview.revision + 1, [scale === 1 ? "final" : "draft"]: image(scale === 1 ? 4 : 5, scale) }; }
      if (url === "/api/mockups/title/confirm") { titleReview = { ...titleReview, revision: titleReview.revision + 1, active: titleReview.final, activeTitle: titleReview.title }; }
      if (url === "/api/mockups/save") { oldReview.revision++; titleReview = { ...titleReview, baseFingerprint: "b".repeat(64), stale: true }; return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ review: copy(oldReview) }) }; }
      return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ csrfToken: "c".repeat(64), review: copy(titleReview) }) };
    },
  });
  vm.runInContext(script, context);
  await settle();
  return { requests, nodes, context, get imageLoads() { return imageLoads; }, setError: (value) => { error = value; }, updateReview: (value) => { titleReview = { ...titleReview, ...value }; }, pause: (value) => { paused = value; }, node: (selector) => nodes.get(selector), async edit(selector, value, kind = "input") { const node = nodes.get(selector); node[kind === "change" ? "checked" : "value"] = value; node.emit(kind); await settle(); }, async click(selector) { nodes.get(selector).emit("click"); await settle(); } };
}

test("title editor loads by GET only and typing changes neither network nor displayed image sources", async () => {
  const f = await clientFixture();
  assert.deepEqual(f.requests.map((r) => [r.url, r.method]), [["/api/mockups", "GET"], ["/api/mockups/title", "GET"]]);
  const imageLoads = f.imageLoads;
  await f.edit("#thumbnail-main-title", "새 작업물 종류");
  await f.edit("#thumbnail-sub-title", "선택 브랜드");
  await f.edit("#thumbnail-show-sub", true, "change");
  assert.equal(f.requests.length, 2);
  assert.equal(f.imageLoads, imageLoads);
  assert.equal(f.node("#save-thumbnail-title").disabled, false);
  assert.equal(f.node("#preview-thumbnail-title").disabled, true);
  assert.equal(f.node("#render-thumbnail-title").disabled, true);
  assert.equal(f.node("#confirm-thumbnail-title").disabled, true);
  assert.equal(f.node("#mockup-title").value, "기존 작업물명");
});

test("title editor absent sidecar starts blank without guessing legacy brand or creating state", async () => {
  const f = await clientFixture({ revision: null, title: { main: "", sub: "", showSub: false, style: "bold" }, draft: null, final: null, active: null });
  assert.equal(f.node("#thumbnail-main-title").value, "");
  assert.equal(f.node("#thumbnail-sub-title").value, "");
  assert.equal(f.node("#save-thumbnail-title").disabled, true);
  await f.edit("#thumbnail-main-title", "건물관리 제안서");
  await f.click("#save-thumbnail-title");
  const request = f.requests.at(-1);
  assert.equal(request.url, "/api/mockups/title/save");
  assert.equal(request.parsed.expectedRevision, null);
  assert.deepEqual(request.parsed.title, { main: "건물관리 제안서", sub: "", showSub: false, style: "bold" });
});

test("unchanged title input is a no-op, including whitespace normalization", async () => {
  const f = await clientFixture();
  await f.edit("#thumbnail-main-title", "  행사   제안서 ");
  assert.equal(f.node("#save-thumbnail-title").disabled, true);
  await f.click("#save-thumbnail-title");
  assert.equal(f.requests.length, 2);
});

test("title saves use only separate revision, base hash and title; then one explicit draft and final request", async () => {
  const f = await clientFixture();
  await f.edit("#thumbnail-main-title", "새 제안서");
  await f.click("#save-thumbnail-title");
  assert.deepEqual(f.requests.at(-1).parsed, { expectedRevision: 1, expectedBaseFingerprint: "a".repeat(64), title: { ...mainTitle, main: "새 제안서" } });
  assert.equal(f.requests.at(-1).headers["X-Woolim-CSRF"], "c".repeat(64));
  assert.equal(f.node("#render-thumbnail-title").disabled, true);
  await f.click("#preview-thumbnail-title");
  assert.deepEqual(f.requests.at(-1).parsed, { expectedRevision: 2, expectedBaseFingerprint: "a".repeat(64), scale: 0.5 });
  await f.click("#render-thumbnail-title");
  assert.deepEqual(f.requests.at(-1).parsed, { expectedRevision: 3, expectedBaseFingerprint: "a".repeat(64), scale: 1 });
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 3);
  assert.equal(f.node("#confirm-thumbnail-title").disabled, true);
});

test("failed save preserves entered fields and previous output without retry or reload", async () => {
  const f = await clientFixture();
  const activeSrc = f.node("#thumbnail-title-active").querySelector("img").src;
  await f.edit("#thumbnail-main-title", "너무 긴 제목도 사용자 입력은 보존");
  f.setError("다른 편집이 먼저 저장됐습니다.");
  await f.click("#save-thumbnail-title");
  assert.equal(f.node("#thumbnail-main-title").value, "너무 긴 제목도 사용자 입력은 보존");
  assert.equal(f.node("#thumbnail-title-active").querySelector("img").src, activeSrc);
  assert.equal(f.requests.length, 3);
  assert.match(f.node("#thumbnail-title-status").textContent, /입력 문구와 이전 완성본/);
  assert.equal(f.node("#confirm-thumbnail-title").disabled, true);
});

test("explicit refresh retains dirty fields and adopts current revision/base without saving", async () => {
  const f = await clientFixture();
  await f.edit("#thumbnail-main-title", "내가 입력한 제목");
  f.updateReview({ revision: 9, baseFingerprint: "b".repeat(64), title: { ...mainTitle, main: "다른 창 제목" } });
  await f.click("#refresh-thumbnail-title");
  assert.equal(f.node("#thumbnail-main-title").value, "내가 입력한 제목");
  assert.equal(f.requests.at(-1).method, "GET");
  await f.click("#save-thumbnail-title");
  assert.equal(f.requests.at(-1).parsed.expectedRevision, 9);
  assert.equal(f.requests.at(-1).parsed.expectedBaseFingerprint, "b".repeat(64));
});

test("local confirm is bound to loaded final image and exact current final hash", async () => {
  const f = await clientFixture();
  f.node("#thumbnail-title-inspected").checked = true;
  f.node("#thumbnail-title-inspected").emit("change");
  await f.click("#confirm-thumbnail-title");
  assert.equal(f.requests.length, 2);
  const open = f.node("#thumbnail-title-candidate").querySelector("button");
  open.emit("click");
  assert.equal(f.node("#thumbnail-title-inspected").disabled, true);
  f.node("#mockup-preview-image").emit("load");
  assert.equal(f.node("#thumbnail-title-inspected").disabled, false);
  await f.edit("#thumbnail-title-inspected", true, "change");
  await f.click("#confirm-thumbnail-title");
  assert.deepEqual(f.requests.at(-1).parsed, { expectedRevision: 1, expectedBaseFingerprint: "a".repeat(64), expectedFinalHash: image(2).sha256, visualConfirmed: true });
  assert.equal(f.node("#thumbnail-title-active").querySelector("img").src, `/mockup-title-image/active/${image(2).sha256}`);
});

test("failed final image load and title edits revoke visual confirmation", async () => {
  const f = await clientFixture();
  f.node("#thumbnail-title-candidate").querySelector("button").emit("click");
  f.node("#mockup-preview-image").emit("error");
  assert.equal(f.node("#thumbnail-title-inspected").disabled, true);
  f.node("#thumbnail-title-candidate").querySelector("button").emit("click");
  f.node("#mockup-preview-image").emit("load");
  await f.edit("#thumbnail-title-inspected", true, "change");
  await f.edit("#thumbnail-sub-title", "새 브랜드");
  assert.equal(f.node("#thumbnail-title-inspected").checked, false);
  assert.equal(f.node("#confirm-thumbnail-title").disabled, true);
});

test("busy title request blocks double clicks and legacy rendering without background retries", async () => {
  const f = await clientFixture();
  let resume;
  f.pause(new Promise((resolve) => { resume = resolve; }));
  await f.edit("#thumbnail-main-title", "다른 제목");
  f.node("#save-thumbnail-title").emit("click");
  f.node("#save-thumbnail-title").emit("click");
  assert.equal(f.node("#render-draft").disabled, true);
  assert.equal(f.node("#thumbnail-main-title").disabled, true);
  assert.equal(f.requests.filter((r) => r.method === "POST").length, 1);
  resume();
  await settle();
  assert.equal(f.node("#thumbnail-main-title").disabled, false);
});

test("legacy slot save refreshes title binding but retains separately unsaved title fields", async () => {
  const f = await clientFixture();
  await f.edit("#thumbnail-main-title", "제목 입력 보존");
  await f.edit("#mockup-title-confirmed", true, "change");
  vm.runInContext("dirty = true; renderControls();", f.context);
  await f.click("#save-assignments");
  assert.equal(f.node("#thumbnail-main-title").value, "제목 입력 보존");
  assert.equal(f.requests.at(-1).url, "/api/mockups/title");
  assert.equal(f.node("#confirm-thumbnail-title").disabled, true);
  assert.equal(plain(vm.runInContext("thumbnailTitleReview.baseFingerprint", f.context)), "b".repeat(64));
});
