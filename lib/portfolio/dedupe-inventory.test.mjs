import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as dedupe from "./project-dedupe.ts";
import * as names from "./project-name.ts";
import * as selection from "../naver-works/portfolio-selection.ts";
import * as fonts from "./font-policy.ts";
import * as sourceInspection from "./source-inspection.ts";
import * as comparisonWaiver from "./comparison-waiver.ts";

const publishedHash = "aaaaaaaaaaaaaaaa";
const freshHash = "cccccccccccccccc";
const modifiedAt = "2026-10-20T00:00:00.000Z";
function candidate(id, status = "processed", hashes = []) {
  const file = { id: `file-${id}`, file_name: `${id} 회사소개서.pptx`, file_path: `포트폴리오/PPT/${id}`,
    file_extension: "pptx", file_size: 100, root_id: "root", modified_at: modifiedAt };
  return { id, project_key: id, project_name: `${id} 회사소개서`, quality_score: 90, status,
    updated_at: modifiedAt, naver_works_drive_files: file,
    metadata: { representativeHashes: hashes, fontPolicyVersion: fonts.PORTFOLIO_FONT_POLICY_VERSION,
      sourceInspection: { version: sourceInspection.SOURCE_INSPECTION_VERSION, driveFileId: file.id,
        modifiedAt, fileSize: file.file_size, fontPolicyVersion: fonts.PORTFOLIO_FONT_POLICY_VERSION,
        sourceFonts: [], representativeHashes: hashes, inspectedAt: modifiedAt } } };
}
function conversion(id, paths = ["slides/old.png"]) {
  return { id: `convert-${id}`, candidate_id: id, job_type: "convert", status: "completed", updated_at: modifiedAt,
    result: { bucket: "portfolio-rendered", slidePaths: paths } };
}
function fixture({ rows = [candidate("old"), candidate("new", "candidate", [freshHash])], jobs = [conversion("old")],
  sets = [], ledger = [], items = [], download = async () => ({ data: new Blob([publishedHash]), error: null }), conflict = false } = {}) {
  const tables = { portfolio_candidates: structuredClone(rows), content_jobs: jobs,
    portfolio_image_sets: sets, portfolio_publication_ledger: ledger, content_work_items: items };
  const downloads = [], updates = [];
  const admin = {
    storage: { from(bucket) { return { async download(path) { downloads.push(`${bucket}/${path}`); return download(path); } }; } },
    from(table) {
      let payload;
      const filters = [];
      const query = {
        select() { return query; }, order() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
        async range(start, end) { return { data: structuredClone(tables[table].slice(start, end + 1)), error: null }; },
        update(value) { payload = value; return query; },
        async maybeSingle() {
          updates.push({ table, payload: structuredClone(payload), filters: structuredClone(filters) });
          const row = tables[table].find(row => filters.every(([key, value]) => row[key] === value));
          if (conflict || !row) return { data: null, error: null };
          Object.assign(row, structuredClone(payload));
          return { data: { id: row.id }, error: null };
        },
      };
      return query;
    },
  };
  const exports = {};
  const dependencies = {
    "@/lib/content-ops/data": { contentAdmin: () => admin }, "./project-dedupe": dedupe, "./project-name": names,
    "../naver-works/portfolio-selection": selection, "./font-policy": fonts, "./source-inspection": sourceInspection,
    "./source-fonts": {}, "./comparison-waiver": comparisonWaiver, jszip: {},
    "./image-fingerprint": { fingerprintPortfolioImage: async buffer => ({ visualHash: buffer.toString() }) },
    "../naver-works/client": { accessToken: () => { throw new Error("Unexpected OAuth request"); } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync("lib/portfolio/dedupe-inventory.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require(id) { assert.ok(id in dependencies, id); return dependencies[id]; },
    Buffer, process, Date, Error, console: { info() {}, warn() {} } });
  return { run: options => exports.readPortfolioDedupeInventory(4, options), downloads, updates, tables };
}

test("published cached fingerprints bypass conversion and image-set downloads after retention", async () => {
  const f = fixture({ rows: [candidate("old", "processed", [publishedHash]), candidate("new", "candidate", [freshHash])],
    sets: [{ id: "set-old", work_item_id: "item-old", manifest: { assets: [{ bucket: "portfolio-rendered", path: "deleted/old.png" }] } }],
    items: [{ id: "item-old", title: "old", channel: "naver_design", format: "portfolio", status: "published",
      metadata: { candidateId: "old", sourceFileName: "old 회사소개서.pptx" } }],
    download: async () => { throw new Error("Deleted image must never be read"); } });
  const result = await f.run();
  assert.deepEqual(f.downloads, []);
  assert.deepEqual(f.updates, []);
  assert.deepEqual(result.accepted.map(row => row.id), ["new"]);
  assert.deepEqual(Array.from(result.metrics.missingImagePaths), []);
});

test("used fingerprints are downloaded once, persisted with all optimistic locks, and reused on the next call", async () => {
  const f = fixture();
  await f.run();
  await f.run();
  assert.deepEqual(f.downloads, ["portfolio-rendered/slides/old.png"]);
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.updates[0].filters, [["id", "old"], ["status", "processed"], ["updated_at", modifiedAt]]);
  assert.deepEqual(f.tables.portfolio_candidates[0].metadata.representativeHashes, [publishedHash]);
  assert.equal(f.tables.portfolio_candidates[0].status, "processed");
});

test("stored published hashes continue to identify a duplicate even though all slide files were deleted", async () => {
  const f = fixture({ rows: [candidate("old", "processed", [publishedHash]), candidate("new", "candidate", [publishedHash])],
    download: async () => ({ data: null, error: { message: "Object not found", statusCode: "404" } }) });
  const result = await f.run();
  assert.equal(f.downloads.length, 0);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.decisions[0].match.candidateId, "old");
});

test("missing images without saved fingerprints block production while preserving fresh candidates for preview", async () => {
  const f = fixture({ download: async () => ({ data: null, error: { message: "Object not found", status: 400, statusCode: "404" } }) });
  const result = await f.run();
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(Array.from(result.needsImageReview, row => row.id), []);
  assert.deepEqual(Array.from(result.previewAccepted, row => row.id), ["new"]);
  assert.equal(result.blockingReferenceCount, 1);
  assert.match(result.comparisonReviewReason, /지문 없는 기존 기록 1건.*중복 확인 불가/);
  assert.equal(result.unavailableReferences[0].imageStatus, "unavailable");
  assert.deepEqual(Array.from(result.metrics.missingImagePaths), ["portfolio-rendered/slides/old.png"]);
});

test("one missing slide is recorded while remaining slides still supply comparison evidence", async () => {
  const f = fixture({ jobs: [conversion("old", ["slides/missing.png", "slides/available.png"])],
    download: async path => path.includes("missing")
      ? { data: null, error: { message: "Gone", status: 404 } }
      : { data: new Blob([publishedHash]), error: null } });
  const result = await f.run();
  assert.deepEqual(f.downloads, ["portfolio-rendered/slides/missing.png", "portfolio-rendered/slides/available.png"]);
  assert.equal(result.accepted[0].id, "new");
  assert.deepEqual(Array.from(result.metrics.missingImagePaths), ["portfolio-rendered/slides/missing.png"]);
});

test("read-only inspection may recover comparison hashes but never saves them", async () => {
  const f = fixture({ conflict: true });
  const result = await f.run({ readOnly: true });
  assert.equal(result.accepted[0].id, "new");
  assert.equal(f.updates.length, 0);
  assert.deepEqual(f.tables.portfolio_candidates[0].metadata.representativeHashes, []);
});

test("a stale used-candidate lock fails instead of overwriting a concurrent change", async () => {
  const f = fixture({ conflict: true });
  await assert.rejects(f.run(), /원본 검사 중 후보가 변경되었습니다/);
});

for (const error of [
  { message: "Unauthorized", status: 401 },
  { message: "Object not found", status: 403, statusCode: "404" },
  { message: "Object not found", statusCode: 403 },
  { message: "Object not found", status: "401" },
  { message: "Object not found", statusCode: 500 },
  { message: "Bucket not found", status: 404 },
  { message: "Invalid key", status: 404 },
  { message: "Network connection refused", status: 404 },
  { message: "Object not found", status: 404, code: "NoSuchBucket" },
  { message: "Object not found", status: 404, error: "InvalidKey" },
  { message: "Object not found", status: 404, code: "AccessDenied" },
  { message: "Object not found", status: 503, statusCode: "404" },
  { message: "fetch failed", status: 404, code: "ECONNRESET" },
  { message: "Network request failed" },
]) test(`storage failure remains fatal: ${JSON.stringify(error)}`, async () => {
  const f = fixture({ download: async () => ({ data: null, error }) });
  await assert.rejects(f.run(), new RegExp(`중복 검수 이미지 조회 실패: ${error.message}`));
});

test("a rejected network download remains fatal", async () => {
  const f = fixture({ download: async () => { throw new Error("fetch failed"); } });
  await assert.rejects(f.run(), /fetch failed/);
});

for (const path of ["../bad.png", "/bad.png", "slides//bad.png", "slides\\bad.png"]) {
  test(`invalid stored path remains fatal: ${path}`, async () => {
    const f = fixture({ jobs: [conversion("old", [path])] });
    await assert.rejects(f.run(), /중복 검수 이미지 경로가 올바르지 않습니다/);
    assert.equal(f.downloads.length, 0);
  });
}

test("an image-set fallback saves used hashes and avoids missing conversion downloads on the next run", async () => {
  const f = fixture({ sets: [{ id: "set", work_item_id: "item", manifest: { assets: [{ bucket: "portfolio-rendered", path: "sets/old.png" }] } }],
    items: [{ id: "item", title: "old", status: "published", channel: "naver_design", format: "portfolio",
      metadata: { candidateId: "old", sourceFileName: "old 회사소개서.pptx" } }],
    download: async path => path.startsWith("slides/") ? { data: null, error: { message: "Object not found" } }
      : { data: new Blob([publishedHash]), error: null } });
  assert.equal((await f.run()).accepted[0].id, "new");
  assert.equal((await f.run()).accepted[0].id, "new");
  assert.deepEqual(f.downloads, ["portfolio-rendered/slides/old.png", "portfolio-rendered/sets/old.png"]);
  assert.deepEqual(f.tables.portfolio_candidates[0].metadata.representativeHashes, [publishedHash]);
});

test("a hashless publication ledger uses the saved candidate evidence", async () => {
  const f = fixture({ rows: [candidate("old", "processed", [publishedHash]), candidate("new", "candidate", [freshHash])],
    ledger: [{ id: "ledger", candidate_id: "old", title: "old", normalized_project_name: "old회사소개서", representative_hashes: [] }] });
  assert.equal((await f.run()).accepted[0].id, "new");
  assert.equal(f.downloads.length, 0);
});

test("a publication without a candidate or surviving set stays unavailable for image comparison", async () => {
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    sets: [{ id: "set", work_item_id: "item", manifest: { assets: [{ bucket: "portfolio-rendered", path: "sets/missing.png" }] } }],
    items: [{ id: "item", title: "legacy", status: "published", channel: "naver_design", format: "portfolio", metadata: { sourceFileName: "legacy.pptx" } }],
    download: async () => ({ data: null, error: { message: "Object not found" } }) });
  const result = await f.run({ readOnly: true });
  assert.equal(result.accepted.length, 0);
  assert.match(result.comparisonReviewReason, /중복 확인 불가/);
  assert.equal(result.blockingReferenceCount, 1);
  assert.equal(result.unavailableReferences[0].title, "legacy");
});

test("a malformed bucket cannot reuse a valid object's cached key", async () => {
  const f = fixture({ rows: [], jobs: [], sets: [
    { id: "valid", manifest: { assets: [{ bucket: "portfolio-rendered", path: "slides/x.png" }] } },
    { id: "invalid", manifest: { assets: [{ bucket: "portfolio-rendered/slides", path: "x.png" }] } },
  ] });
  await assert.rejects(f.run({ readOnly: true }), /중복 검수 이미지 경로가 올바르지 않습니다/);
  assert.deepEqual(f.downloads, ["portfolio-rendered/slides/x.png"]);
});

test("matching project names never replace a different hashless publication's evidence", async () => {
  const first = candidate("old-a"), second = candidate("old-b", "processed", [publishedHash]);
  first.project_name = second.project_name = "같은 회사소개서";
  const f = fixture({ rows: [first, second, candidate("new", "candidate", [freshHash])], jobs: [conversion("old-a")],
    ledger: [{ id: "ledger-a", candidate_id: "old-a", title: "old-a publication",
      normalized_project_name: "같은회사소개서", representative_hashes: [] }],
    download: async () => ({ data: null, error: { message: "Object not found" } }) });
  const result = await f.run({ readOnly: true });
  assert.equal(result.accepted.length, 0);
  assert.match(result.comparisonReviewReason, /1건.*중복 확인 불가/);
  assert.equal(result.unavailableReferences[0].title, "old-a publication");
});

test("a legacy publication reuses a surviving set only through the same work item", async () => {
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [{ id: "ledger", work_item_id: "item", title: "legacy", normalized_project_name: "legacy", representative_hashes: [] }],
    sets: [{ id: "set", work_item_id: "item", manifest: { assets: [{ bucket: "portfolio-rendered", path: "sets/legacy.png" }] } }],
    items: [{ id: "item", title: "legacy", status: "published", channel: "naver_design", format: "portfolio",
      metadata: { sourceFileName: "legacy.pptx" } }] });
  assert.equal((await f.run({ readOnly: true })).accepted[0].id, "new");
});

test("a hashless ledger publication with no candidate or assets requires image review", async () => {
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [{ id: "ledger", title: "unavailable legacy", normalized_project_name: "legacy", representative_hashes: [] }] });
  const result = await f.run({ readOnly: true });
  assert.equal(result.accepted.length, 0);
  assert.match(result.comparisonReviewReason, /1건.*중복 확인 불가/);
  assert.equal(result.unavailableReferences[0].title, "unavailable legacy");
  assert.equal(f.downloads.length, 0);
});

function publication(id, overrides = {}) {
  return { id, title: `${id} 기록`, normalized_project_name: `${id}기록`,
    blog_url: `https://blog.naver.com/wl_0109/${id}`, source: "history", representative_hashes: [], ...overrides };
}
function waiverEvent(action = "waive", reason = "not_portfolio") {
  return { action, reason, actor: "reviewer@woolimcompany.kr", at: "2026-11-05T00:00:00.000Z" };
}

test("every hashless ledger publication includes its title, URL, source and honest image status", async () => {
  const ledger = [publication("101"), publication("102", { source: "auto" }), publication("103", { source: "manual" })];
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [], ledger });
  const result = await f.run({ readOnly: true });
  assert.equal(result.blockingReferenceCount, 3);
  assert.equal(result.unavailableReferences.length, 3);
  assert.deepEqual(Array.from(result.unavailableReferences, row => ({ title: row.title, url: row.url, source: row.source })),
    ledger.map(row => ({ title: row.title, url: row.blog_url, source: row.source })));
  assert.ok(result.unavailableReferences.every(row => row.imageStatus === "unknown" && row.canWaive && row.ledgerId === row.id));
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(Array.from(result.previewAccepted, row => row.id), ["new"]);
  assert.equal(result.previewAccepted[0].metadata.imageReviewReason, null);
});

test("a recorded waiver releases production and retains who, when and why for preview and undo", async () => {
  const event = waiverEvent();
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [publication("101", { comparison_waiver: [event] })] });
  const result = await f.run({ readOnly: true });
  assert.equal(result.blockingReferenceCount, 0);
  assert.equal(result.comparisonReviewReason, null);
  assert.deepEqual(Array.from(result.accepted, row => row.id), ["new"]);
  const reference = result.unavailableReferences[0];
  assert.deepEqual(JSON.parse(JSON.stringify(reference.waiver)), event);
  assert.deepEqual(JSON.parse(JSON.stringify(reference.waiverHistory)), [event]);
  assert.equal(reference.imageStatus, "no_image");
});

test("restoring a waiver blocks production again and retains the earlier audit event", async () => {
  const events = [waiverEvent(), { ...waiverEvent("restore"), actor: "second@woolimcompany.kr", at: "2026-11-05T00:01:00.000Z" }];
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [publication("101", { comparison_waiver: events })] });
  const result = await f.run({ readOnly: true });
  assert.equal(result.blockingReferenceCount, 1);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.unavailableReferences[0].waiver, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.unavailableReferences[0].waiverHistory)), events);
  assert.deepEqual(Array.from(result.previewAccepted, row => row.id), ["new"]);
});

test("a waived publication remains available for undo after its saved fingerprints recover", async () => {
  const event = waiverEvent();
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [publication("101", { comparison_waiver: [event] })] });
  assert.equal((await f.run({ readOnly: true })).unavailableReferences[0].imageStatus, "no_image");
  const ledger = f.tables.portfolio_publication_ledger[0];
  ledger.representative_hashes = [publishedHash];
  const recovered = await f.run({ readOnly: true });
  assert.equal(recovered.unavailableReferences.length, 1);
  assert.equal(recovered.unavailableReferences[0].imageStatus, "available");
  assert.equal(recovered.unavailableReferences[0].imageStatusLabel, "저장된 대표 이미지 지문 있음");
  assert.equal(recovered.unavailableReferences[0].waiver.action, "waive");
  assert.equal(recovered.unavailableReferences[0].canWaive, true);
  assert.equal(recovered.blockingReferenceCount, 0);
  ledger.comparison_waiver.push({ ...waiverEvent("restore"), at: "2026-11-05T00:01:00.000Z" });
  const restored = await f.run({ readOnly: true });
  assert.equal(restored.unavailableReferences.length, 1);
  assert.equal(restored.unavailableReferences[0].waiver, null);
  assert.equal(restored.unavailableReferences[0].waiverHistory.length, 2);
  assert.equal(restored.unavailableReferences[0].imageStatus, "available");
  assert.equal(restored.blockingReferenceCount, 0);
  assert.deepEqual(Array.from(restored.accepted, row => row.id), ["new"]);
});

test("linked candidate fingerprint recovery also keeps the ledger waiver visible for undo", async () => {
  const f = fixture({ rows: [candidate("old", "processed", [publishedHash]), candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [publication("101", { candidate_id: "old", comparison_waiver: [waiverEvent()] })] });
  const recovered = await f.run({ readOnly: true });
  assert.equal(recovered.unavailableReferences.length, 1);
  assert.equal(recovered.unavailableReferences[0].ledgerId, "101");
  assert.equal(recovered.unavailableReferences[0].imageStatus, "available");
  assert.equal(recovered.unavailableReferences[0].waiver.action, "waive");
  assert.equal(recovered.blockingReferenceCount, 0);
  assert.deepEqual(Array.from(recovered.accepted, row => row.id), ["new"]);
});

test("one remaining unwaived publication still blocks automatic selection", async () => {
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [], ledger: [
    publication("101", { comparison_waiver: [waiverEvent()] }), publication("102"),
  ] });
  const result = await f.run();
  assert.equal(result.unavailableReferences.length, 2);
  assert.equal(result.blockingReferenceCount, 1);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.previewAccepted.length, 1);
  assert.match(result.comparisonReviewReason, /지문 없는 기존 기록 1건/);
});

test("ledger-linked hashless aliases share one review action without counting the publication repeatedly", async () => {
  const f = fixture({ rows: [candidate("old"), candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [publication("101", { candidate_id: "old", work_item_id: "item", comparison_waiver: [waiverEvent()] })],
    sets: [{ id: "set", work_item_id: "item", manifest: { assets: [] } }],
    items: [{ id: "item", title: "old publication", status: "published", channel: "naver_design", format: "portfolio",
      metadata: { candidateId: "old", sourceFileName: "old 회사소개서.pptx" } }] });
  const result = await f.run({ readOnly: true });
  assert.equal(result.unavailableReferences.length, 1);
  assert.equal(result.unavailableReferences[0].ledgerId, "101");
  assert.equal(result.blockingReferenceCount, 0);
  assert.deepEqual(Array.from(result.accepted, row => row.id), ["new"]);
});

test("waiving missing evidence never releases a candidate with the same project name", async () => {
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [publication("101", { normalized_project_name: names.normalizePortfolioProjectName("new 회사소개서"),
      comparison_waiver: [waiverEvent()] })] });
  const result = await f.run({ readOnly: true });
  assert.equal(result.blockingReferenceCount, 0);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.previewAccepted.length, 0);
  assert.equal(result.decisions[0].match.id, "101");
});

test("waiving another missing record never releases differently named candidates with the same image", async () => {
  const f = fixture({ rows: [candidate("new", "candidate", [publishedHash])], jobs: [], ledger: [
    publication("101", { comparison_waiver: [waiverEvent()] }),
    publication("102", { representative_hashes: [publishedHash] }),
  ] });
  const result = await f.run({ readOnly: true });
  assert.equal(result.blockingReferenceCount, 0);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.previewAccepted.length, 0);
  assert.equal(result.decisions[0].match.id, "102");
  assert.equal(result.decisions[0].distance, 0);
});

test("complete saved fingerprints keep automatic and preview selection unchanged", async () => {
  const f = fixture({ rows: [candidate("new", "candidate", [freshHash])], jobs: [],
    ledger: [publication("101", { representative_hashes: [publishedHash] })] });
  const result = await f.run({ readOnly: true });
  assert.equal(result.unavailableReferences.length, 0);
  assert.equal(result.blockingReferenceCount, 0);
  assert.equal(result.comparisonReviewReason, null);
  assert.deepEqual(Array.from(result.accepted, row => row.id), ["new"]);
  assert.deepEqual(Array.from(result.previewAccepted, row => row.id), ["new"]);
});
