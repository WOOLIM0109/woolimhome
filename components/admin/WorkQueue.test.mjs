import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { CHANNELS, STATUS_LABELS } from "../../lib/content-ops/config.ts";
import * as queueView from "../../lib/content-ops/work-queue-view.ts";

const compiled = ts.transpileModule(
  readFileSync(new URL("./WorkQueue.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } },
).outputText;
const holdHint = "보류는 사유를 적어야 걸 수 있습니다.";

function all(root, predicate) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (predicate(node)) found.push(node);
    walk(node.props?.children);
  };
  walk(root);
  return found;
}

function words(node) {
  if (Array.isArray(node)) return node.map(words).join("");
  if (node && typeof node === "object") return words(node.props?.children);
  return node == null || typeof node === "boolean" ? "" : String(node);
}

async function harness({ status = "review_required", reviewMode = true } = {}) {
  const item = {
    id: "hold-review-item", channel: "naver_consulting", format: "informational",
    title: "검토할 원고", status, review_note: null, metadata: {}, content_review_assets: [],
  };
  const slots = [], pendingEffects = [], timers = [], requests = [];
  let cursor = 0, tree;
  const changed = (previous, next) => !previous || !next || next.some((value, i) => value !== previous[i]);
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) {
        slots[index] = { deps };
        pendingEffects.push(effect);
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const identity = (value) => value;
  const dependencies = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": new Proxy({}, { get: (_, name) => `icon-${String(name)}` }),
    "./StatusBadge": { default: "StatusBadge" },
    "./ProductionMockupEditor": { default: "ProductionMockupEditor" },
    "@/lib/portfolio/display-state": { portfolioDisplayState: () => null },
    "@/lib/portfolio/stall-state": { portfolioStallState: () => null },
    "@/lib/content-ops/editorial-style": { faqAnswerHtml: identity, faqQuestionHtml: identity },
    "@/lib/content-ops/sentence-line-breaks": { formatSentenceLineBreaks: identity },
    "@/lib/http/read-json": { readJsonResponse: (response) => response.json() },
    "@/lib/content-ops/status-history": { actorLabel: identity, statusHistoryOf: () => [] },
    "@/lib/content-ops/config": { CHANNELS, STATUS_LABELS },
    "@/lib/content-ops/work-queue-view": queueView,
    "@/lib/content-ops/source-section": { PRIVATE_PORTFOLIO_SOURCE_NOTE: "", sourceSectionHtml: () => "" },
    "@/lib/portfolio/hyundai-manual-mockups": { HYUNDAI_MANUAL_MOCKUP_LEGACY_TITLE: "현대 원고" },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, URL, URLSearchParams, console,
    window: {
      setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {},
      location: { hash: "" }, addEventListener() {}, removeEventListener() {},
    },
    fetch: async (url, options = {}) => {
      const method = options.method || "GET";
      requests.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, json: async () => method === "GET" ? [item] : { id: item.id } };
    },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected client import: ${name}`);
      return dependencies[name];
    },
  });
  const render = () => { cursor = 0; tree = exports.default({ reviewMode }); };
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      while (pendingEffects.length) pendingEffects.shift()();
      while (timers.length) timers.shift()();
      await new Promise((resolve) => setImmediate(resolve));
      render();
    }
  };
  const button = (label) => {
    const found = all(tree, (node) => node.type === "button" && words(node).trim() === label);
    assert.equal(found.length, 1, `Expected button: ${label}`);
    return found[0];
  };
  render();
  await flush();
  const headers = all(tree, (node) => node.type === "button" && node.props["aria-controls"]);
  assert.equal(headers.length, 1);
  headers[0].props.onClick();
  render();
  return {
    requests, button,
    get tree() { return tree; },
    changeNote(value) {
      const notes = all(tree, (node) => node.type === "textarea" && node.props.placeholder === "수정 요청이나 가려야 할 내용을 적어주세요.");
      assert.equal(notes.length, 1);
      notes[0].props.onChange({ target: { value } });
      render();
    },
    async click(label) {
      const target = button(label);
      assert.equal(Boolean(target.props.disabled), false, `${label} is disabled`);
      target.props.onClick();
      await flush();
    },
  };
}

test("hold needs two non-whitespace characters while approval stays available", async () => {
  const h = await harness();
  for (const value of ["", " \t\n\u3000 ", "가", " 가 \t ", "😀"]) {
    h.changeNote(value);
    assert.equal(h.button("보류").props.disabled, true, JSON.stringify(value));
    assert.ok(words(h.tree).includes(holdHint));
    assert.equal(Boolean(h.button("완성본 승인").props.disabled), false);
  }
  for (const value of ["확인", " 가 \n 나 ", "😀가"]) {
    h.changeNote(value);
    assert.equal(h.button("보류").props.disabled, false, JSON.stringify(value));
    assert.equal(words(h.tree).includes(holdHint), false);
  }
  assert.equal(h.requests.filter((request) => request.method === "PATCH").length, 0);
});

test("hold sends a trimmed reason and keeps whitespace within the reason", async () => {
  const h = await harness();
  h.changeNote(" \t 가 나 \n ");
  await h.click("보류");
  const patches = h.requests.filter((request) => request.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], {
    url: "/api/admin/content/hold-review-item", method: "PATCH",
    body: { status: "on_hold", review_note: "가 나" },
  });
});

test("complete-draft approval still submits without a reason", async () => {
  const h = await harness();
  await h.click("완성본 승인");
  assert.deepEqual(h.requests.find((request) => request.method === "PATCH").body, {
    status: "approved", review_note: "",
  });
});

test("legacy reasonless holds can still be cleared or approved directly", async () => {
  for (const [label, expected] of [
    ["보류 해제 · 검토요청으로", { action: "clear_hold" }],
    ["확인했습니다 · 바로 승인", { status: "approved" }],
  ]) {
    const h = await harness({ status: "on_hold", reviewMode: false });
    assert.ok(words(h.tree).includes("기록된 사유가 없습니다."));
    await h.click(label);
    assert.deepEqual(h.requests.find((request) => request.method === "PATCH").body, expected);
  }
});
