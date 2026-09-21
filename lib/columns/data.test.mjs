import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(new URL("./data.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;

function loadData({ configured = true, data = [], error = null } = {}) {
  const calls = [];
  const query = {
    select(...args) { calls.push(["select", ...args]); return this; },
    eq(...args) { calls.push(["eq", ...args]); return this; },
    lte(...args) { calls.push(["lte", ...args]); return this; },
    order(...args) { calls.push(["order", ...args]); return Promise.resolve({ data, error }); },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    process: { env: configured ? {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-key",
    } : {} },
    console: { error() {} },
    require(name) {
      if (name === "@supabase/supabase-js") return {
        createClient: () => ({ from(table) { calls.push(["from", table]); return query; } }),
      };
      if (name === "@/lib/security/html") return { sanitizeGeneratedHtml: (html) => html };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { api: exports, calls };
}

test("missing local connection is unavailable, not an empty published collection", async () => {
  const { api, calls } = loadData({ configured: false });
  const result = await api.getPublishedColumnsResult();
  assert.equal(result.available, false);
  assert.equal(result.posts.length, 0);
  assert.equal(calls.length, 0);
});

test("database failure is unavailable, while a successful empty read remains available", async () => {
  const failed = loadData({ error: { message: "Connection unavailable" } });
  assert.equal((await failed.api.getPublishedColumnsResult()).available, false);
  const empty = loadData();
  const result = await empty.api.getPublishedColumnsResult();
  assert.equal(result.available, true);
  assert.equal(result.posts.length, 0);
});

test("published listing retains publication guards and existing array callers", async () => {
  const posts = [{ id: "public-column", slug: "published-example", published: true }];
  const { api, calls } = loadData({ data: posts });
  const result = await api.getPublishedColumnsResult();
  assert.equal(result.available, true);
  assert.equal(result.posts, posts);
  assert.ok(calls.some(([method, key, value]) => method === "eq" && key === "published" && value === true));
  assert.ok(calls.some(([method, key, value]) => method === "lte" && key === "published_at" && Number.isFinite(Date.parse(value))));
  assert.equal(await api.getPublishedColumns(), posts);
});
