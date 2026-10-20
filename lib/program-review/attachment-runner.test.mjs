import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import sanitizeHtml from "sanitize-html";
import * as attachmentHelpers from "./attachments.ts";

const compiled = ts.transpileModule(readFileSync(new URL("./attachment-runner.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

// Execute the real runner. Only service boundaries and the independently tested document parser are replaced.
function harness({ attachments = [], programs, discovery = [], publicBucket = false, download, zipChildren = [] } = {}) {
  let now = Date.parse("2026-10-21T08:10:00+09:00");
  const tables = {
    openchat_programs: programs || [{ id: "program", source_url: "https://agency.example/detail", status: "review_required", deadline_at: null, created_at: new Date(now).toISOString() }],
    openchat_program_attachment_discovery: discovery,
    openchat_program_attachments: attachments,
    openchat_run_logs: [],
  };
  const writes = [], requests = [], uploads = [], downloads = [], objects = new Map();
  let extracts = 0, expansions = 0, generated = 0;
  function query(table) {
    let action = "select", values, options = {}, single = false, maximum = Infinity, outcome;
    const filters = [], orders = [];
    const builder = {
      select() { return this; },
      insert(value) { action = "insert"; values = value; return this; },
      upsert(value, opts = {}) { action = "upsert"; values = value; options = opts; return this; },
      update(value) { action = "update"; values = value; return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      neq(key, value) { filters.push(row => row[key] !== value); return this; },
      lt(key, value) { filters.push(row => row[key] < value); return this; },
      in(key, values) { filters.push(row => values.includes(row[key])); return this; },
      or(expression) {
        if (table === "openchat_programs") filters.push(row => !row.deadline_at || Date.parse(row.deadline_at) >= now);
        assert.equal(typeof expression, "string"); return this;
      },
      order(key, opts = {}) { orders.push([key, opts.ascending !== false]); return this; },
      limit(value) { maximum = value; return this; },
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      single() { single = true; return this; },
      then(resolve, reject) {
        outcome ||= Promise.resolve().then(() => {
          let result = tables[table].filter(row => filters.every(filter => filter(row)));
          if (action === "insert" || action === "upsert") {
            result = [];
            for (const value of Array.isArray(values) ? values : [values]) {
              const conflict = options.onConflict?.split(",") || (table.endsWith("discovery") ? ["program_id"] : ["id"]);
              const previous = action === "upsert" && tables[table].find(row => conflict.every(key => row[key] === value[key]));
              if (previous) { if (!options.ignoreDuplicates) Object.assign(previous, value); result.push(previous); }
              else {
                const row = { id: `generated-${++generated}`, created_at: new Date(now).toISOString(), attempts: 0,
                  text_status: "pending", parent_id: null, storage_path: null, sha256: null, ...value };
                tables[table].push(row); result.push(row);
              }
            }
          } else if (action === "update") result.forEach(row => Object.assign(row, values));
          if (action !== "select") writes.push({ table, action, values });
          result = [...result].sort((a, b) => {
            for (const [key, ascending] of orders) {
              if (a[key] < b[key]) return ascending ? -1 : 1;
              if (a[key] > b[key]) return ascending ? 1 : -1;
            }
            return 0;
          }).slice(0, maximum);
          return { data: single ? result[0] : result.map(row => ({ ...row })), error: null };
        });
        return outcome.then(resolve, reject);
      },
    };
    return builder;
  }
  const admin = {
    from: query,
    rpc(name, { attachment_id }) {
      assert.equal(name, "claim_openchat_attachment");
      return { abortSignal() { return this; }, then(resolve) {
        const row = tables.openchat_program_attachments.find(item => item.id === attachment_id);
        const program = tables.openchat_programs.find(item => item.id === row?.program_id);
        if (!row || !["pending", "failed"].includes(row.text_status) || row.attempts >= 3
          || row.processing_started_at || program?.status === "excluded" || (program?.deadline_at && Date.parse(program.deadline_at) < now)) {
          return Promise.resolve(resolve({ data: [], error: null }));
        }
        row.attempts++; row.processing_started_at = new Date(now).toISOString();
        return Promise.resolve(resolve({ data: [{ ...row }], error: null }));
      } };
    },
    storage: {
      async getBucket(name) { assert.equal(name, "program-attachments"); return { data: { public: publicBucket }, error: null }; },
      from(name) {
        assert.equal(name, "program-attachments");
        return {
          async upload(path, bytes, options) {
            uploads.push(path); assert.equal(options.upsert, false);
            if (objects.has(path)) return { error: { message: "duplicate" } };
            objects.set(path, Buffer.from(bytes)); return { data: { path }, error: null };
          },
          async download(path) {
            downloads.push(path);
            return objects.has(path) ? { data: new Blob([objects.get(path)]), error: null } : { data: null, error: {} };
          },
        };
      },
    },
  };
  class AttachmentLimitError extends Error {}
  const exports = {};
  const dependencies = {
    "node:crypto": crypto, "sanitize-html": sanitizeHtml,
    "@supabase/supabase-js": { createClient() { throw new Error("Unexpected real database client"); } },
    "./attachments": attachmentHelpers, "./extract-text": { AttachmentLimitError },
  };
  vm.runInNewContext(compiled, {
    exports, require(name) { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
    Buffer, Uint8Array, Headers, URL, URLSearchParams, TextDecoder, AbortSignal, Error, Date, process: { env: {} },
  });
  const overrides = {
    admin, now: () => now,
    async fetchResource(url, maxBytes, timeout, options) {
      requests.push({ url, maxBytes, timeout, options });
      assert.ok(timeout > 0 && timeout <= 20_000);
      if (download) return download(url, { advance: milliseconds => { now += milliseconds; }, maxBytes, options });
      return { bytes: Buffer.from("identical document bytes"), headers: new Headers(), url };
    },
    async extractText() { extracts++; return { status: "extracted", text: "[para.1] 신청자격 및 제출서류", textChars: 22, error: null }; },
    async expandZip() { expansions++; return zipChildren; },
  };
  return { tables, writes, requests, uploads, downloads, objects, exports, run: () => exports.runAttachmentTask(overrides),
    metrics: () => ({ extracts, expansions }), advance: milliseconds => { now += milliseconds; } };
}

function pending(index, extra = {}) {
  return { id: `attachment-${index}`, program_id: "program", parent_id: null, file_name: `문서-${index}.pdf`, file_ext: "pdf",
    source_url: `https://agency.example/document-${index}.pdf`, text_status: "pending", storage_path: null, sha256: null,
    attempts: 0, created_at: new Date(Date.parse("2026-10-20T23:00:00Z") + index * 1000).toISOString(), ...extra };
}
const checked = () => [{ program_id: "program", status: "found", checked_at: "2026-10-20T23:05:00Z" }];

test("runner caps work at 15, reuses identical text hashes, and never changes publication records", async () => {
  const h = harness({ attachments: Array.from({ length: 20 }, (_, index) => pending(index)), discovery: checked() });
  const programsBefore = JSON.stringify(h.tables.openchat_programs);
  const first = await h.run();
  assert.equal(first.processed, 15); assert.equal(first.extracted, 15); assert.equal(first.reused, 14);
  assert.equal(h.metrics().extracts, 1); assert.equal(h.uploads.length, 15);
  assert.equal(h.tables.openchat_program_attachments.filter(row => row.text_status === "pending").length, 5);
  const second = await h.run();
  assert.equal(second.processed, 5); assert.equal(second.reused, 5); assert.equal(h.metrics().extracts, 1);
  assert.equal(JSON.stringify(h.tables.openchat_programs), programsBefore);
  assert.ok(h.writes.every(write => write.table !== "openchat_programs"));
  assert.ok(h.uploads.every(path => /^2026\/10\/program\/%/.test(path)));
});

test("ZIP expansion counts parent and leaves all children pending when the shared 15-file budget is exhausted", async () => {
  const children = Array.from({ length: 10 }, (_, index) => ({ fileName: `folder/child-${index}.pdf`, fileExt: "pdf", bytes: Buffer.from(`child-${index}`) }));
  const h = harness({ attachments: [...Array.from({ length: 14 }, (_, index) => pending(index)),
    pending(14, { file_name: "공고.zip", file_ext: "zip", source_url: "https://agency.example/공고.zip" })], discovery: checked(), zipChildren: children });
  const first = await h.run();
  assert.equal(first.processed, 15); assert.equal(first.expanded, 10); assert.equal(first.skipped, 1);
  const childRows = h.tables.openchat_program_attachments.filter(row => row.parent_id);
  assert.equal(childRows.length, 10); assert.ok(childRows.every(row => row.text_status === "pending" && row.attempts === 0));
  const second = await h.run();
  assert.equal(second.processed, 10); assert.equal(second.extracted, 10);
  assert.equal(h.downloads.length, 1); assert.equal(h.metrics().expansions, 2);
  assert.ok(childRows.every(row => row.text_status === "extracted" && row.storage_path.includes("folder%2Fchild-")));
});

test("runtime deadline stops with work pending and provider failures never persist URL or token diagnostics", async () => {
  const secretMarker = "sensitive-test-marker";
  const h = harness({ attachments: [pending(0), pending(1)], discovery: checked(), download: async (_url, { advance }) => {
    advance(235_000); throw new Error(`https://agency.example/?token=${secretMarker}`);
  } });
  const summary = await h.run();
  assert.equal(summary.processed, 1); assert.equal(summary.failed, 1); assert.equal(summary.stoppedForTime, true);
  assert.equal(h.tables.openchat_program_attachments[0].attempts, 1);
  assert.equal(h.tables.openchat_program_attachments[1].attempts, 0);
  assert.doesNotMatch(JSON.stringify(h.writes), new RegExp(secretMarker));
  assert.equal(h.tables.openchat_program_attachments[0].error, "첨부 다운로드 또는 비공개 저장 실패");
});

test("less than 45 seconds remaining defers a downloaded file, releases its claim and resumes next invocation", async () => {
  let firstRequest = true;
  const h = harness({ attachments: [pending(0), pending(1)], discovery: checked(), download: async (url, { advance }) => {
    if (firstRequest) { advance(200_000); firstRequest = false; }
    return { bytes: Buffer.from("PDF document"), headers: new Headers(), url };
  } });
  const first = await h.run();
  assert.equal(first.processed, 1); assert.equal(first.deferred, 1); assert.equal(first.stoppedForTime, true);
  assert.equal(h.metrics().extracts, 0); assert.equal(h.uploads.length, 0);
  assert.ok(h.tables.openchat_program_attachments.every(row => row.text_status === "pending" && row.attempts === 0 && !row.processing_started_at));
  const second = await h.run();
  assert.equal(second.processed, 2); assert.equal(second.extracted, 2);
  assert.ok(h.tables.openchat_program_attachments.every(row => row.text_status === "extracted" && row.attempts === 1));
});

test("Content-Disposition original name replaces discovery labels while source-URL identity remains stable", async () => {
  const h = harness({ attachments: [pending(0, { file_name: "첨부-1", file_ext: "unknown" })], discovery: checked(), download: async url => ({
    bytes: Buffer.from("document"), headers: new Headers({ "content-disposition": "attachment; filename*=UTF-8''%EC%9B%90%EB%B3%B8.pdf" }), url,
  }) });
  const summary = await h.run();
  assert.equal(summary.extracted, 1);
  assert.equal(h.tables.openchat_program_attachments[0].file_name, "원본.pdf");
  assert.equal(h.tables.openchat_program_attachments[0].file_ext, "pdf");
  assert.ok(h.uploads[0].endsWith(encodeURIComponent("원본.pdf")));
});

test("excluded, expired, previously claimed and exhausted files cannot be processed", async () => {
  const h = harness({ programs: [
    { id: "excluded", source_url: "https://agency.example/excluded", status: "excluded", deadline_at: null, created_at: "2026-10-20" },
    { id: "expired", source_url: "https://agency.example/expired", status: "review_required", deadline_at: "2026-10-19", created_at: "2026-10-20" },
    { id: "program", source_url: "https://agency.example/detail", status: "review_required", deadline_at: null, created_at: "2026-10-20" },
  ], attachments: [pending(0, { program_id: "excluded" }), pending(1, { program_id: "expired" }),
    pending(2, { processing_started_at: "2026-10-20T23:09:00Z" }), pending(3, { attempts: 3 })], discovery: checked() });
  const summary = await h.run();
  assert.equal(summary.processed, 0); assert.equal(h.requests.length, 0); assert.equal(h.uploads.length, 0);
});

test("private bucket is required and a public bucket fails before source requests", async () => {
  const h = harness({ attachments: [pending(0)], publicBucket: true });
  await assert.rejects(h.run(), /첨부 수집 작업 실패/);
  assert.equal(h.requests.length, 0); assert.equal(h.tables.openchat_run_logs[0].status, "failed");
});

test("discovery handles the real agency HTML and Fanfandaero JSON POST patterns with numbered evidence", async () => {
  const h = harness({ programs: [{ id: "program", source_url: "https://fanfandaero.kr/portal/read.do?sprtBizCd=PUBLIC-1",
    status: "review_required", deadline_at: null, created_at: "2026-10-20" }], download: async (url, { options }) => {
    if (url.includes("selectSprtBiz")) {
      assert.equal(options.method, "POST"); assert.equal(options.body.get("sprtBizCd"), "PUBLIC-1");
      return { bytes: Buffer.from(JSON.stringify({ spinPb: { description: "신청자격: 소기업\n제출서류: 사업계획서",
        files: [{ itemWonFileNm: "공고문.pdf", fileStreCoursOrg: "/public/agency-doc.pdf" }] } })), headers: new Headers(), url };
    }
    if (url.includes("download.do")) return { bytes: Buffer.from("public PDF"), headers: new Headers(), url };
    return { bytes: Buffer.from("<main><p>안내</p><script>private-script</script></main>"), headers: new Headers(), url };
  } });
  const summary = await h.run();
  assert.equal(summary.discovered, 1); assert.equal(summary.discoveredAttachments, 1); assert.equal(summary.extracted, 1);
  const check = h.tables.openchat_program_attachment_discovery[0];
  assert.equal(check.status, "found"); assert.match(check.detail_text, /\[para\.1\].*신청자격/);
  assert.match(check.detail_text, /\[para\.2\].*제출서류/);
  assert.equal(h.requests.filter(request => request.options?.method === "POST").length, 1);
  assert.doesNotMatch(h.exports.attachmentDetailText("<main><p>자격</p><script>private-script</script><p>서류</p></main>"), /private-script/);
});
