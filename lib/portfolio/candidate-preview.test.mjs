import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function preview(inventory) {
  const calls = [];
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/content-ops/data": {
      authenticatedAdmin: async () => ({ email: "admin@example.com" }),
      contentAdmin: () => ({ from(table) {
        assert.equal(table, "content_work_items");
        const query = {
          select() { return query; }, eq() { return query; },
          then(resolve) { return Promise.resolve({ count: 0, error: null }).then(resolve); },
        };
        return query;
      } }),
    },
    "@/lib/portfolio/dedupe-inventory": {
      async readPortfolioDedupeInventory(threshold, options) {
        calls.push({ threshold, options });
        return inventory;
      },
    },
    "@/lib/naver-works/portfolio-selection": {
      deterministicShortlist: rows => rows.map(row => ({ id: row.id, confidence: 0.9, reasons: ["파일명·경로·형식 순위"] })),
      driveFile: row => row.naver_works_drive_files,
      metadataEligible: () => true,
    },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync("app/api/admin/naver-works/candidates/preview/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    }, URL, Error,
  });
  return { calls, run: () => exports.GET(new Request("http://localhost/api/admin/naver-works/candidates/preview")) };
}

test("preview exposes missing image paths and the comparison review reason without starting production", async () => {
  const reason = "중복 확인 불가: 발행본의 대표 이미지 지문이 없습니다.";
  const missingImagePaths = ["portfolio-rendered/retained-job/slide-1.png"];
  const candidate = { id: "candidate", project_name: "새 회사소개서", metadata: {
    inspectionState: "passed", representativeHashes: ["aaaaaaaaaaaaaaaa"], imageReviewReason: reason,
  } };
  const h = preview({
    accepted: [], groups: [], decisions: [], sourceFailures: [],
    needsImageReview: [candidate], needsFontReview: [], metrics: { remaining: 0, missingImagePaths },
  });
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.inspection.missingImagePaths, missingImagePaths);
  assert.deepEqual(body.inspectionMetrics.missingImagePaths, missingImagePaths);
  assert.deepEqual(body.top10, []);
  assert.deepEqual(body.reviewRequired, [{ id: candidate.id, title: candidate.project_name, reason }]);
  assert.equal(body.readOnly, true);
  assert.equal(body.productionStarted, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.readOnly, true);
});

test("preview keeps the existing no-preview review message when no comparison reason is present", async () => {
  const h = preview({
    accepted: [], groups: [], decisions: [], sourceFailures: [], needsFontReview: [],
    needsImageReview: [{ id: "empty", project_name: "미리보기 없음", metadata: { inspectionState: "no_preview" } }],
    metrics: { remaining: 0, missingImagePaths: [] },
  });
  const body = await (await h.run()).json();
  assert.equal(body.reviewRequired[0].reason, "검사 완료 · 파일 안에 미리보기 이미지가 없어 중복 확인 불가");
});

test("preview keeps candidate ranking and every unavailable record while production remains blocked", async () => {
  const candidate = { id: "new-project", project_name: "새 회사소개서", naver_works_drive_files: { file_name: "새 회사소개서.pptx" } };
  const waiver = { action: "waive", reason: "not_portfolio", actor: "admin@example.com", at: "2026-11-05T00:00:00.000Z" };
  const unavailableReferences = [
    { id: "history-a", ledgerId: "history-a", title: "그림 확인 대기", url: "https://blog.naver.com/wl_0109/101", source: "history", imageStatus: "unavailable", imageStatusLabel: "그림을 구하지 못함", waiver: null, waiverHistory: [], canWaive: true },
    { id: "manual-b", ledgerId: "manual-b", title: "디자인 팁 안내", url: "https://blog.naver.com/wl_0109/102", source: "manual", imageStatus: "no_image", imageStatusLabel: "비교할 그림이 없는 글", waiver, waiverHistory: [waiver], canWaive: true },
    { id: "auto-c", ledgerId: "auto-c", title: "원본 확인 대기", url: "https://blog.naver.com/wl_0109/103", source: "auto", imageStatus: "unknown", imageStatusLabel: "그림 유무 확인 필요", waiver: null, waiverHistory: [], canWaive: true },
  ];
  const reason = "지문 없는 기존 기록 2건이 확인을 기다립니다.";
  const h = preview({
    accepted: [], previewAccepted: [candidate], groups: [], decisions: [], sourceFailures: [],
    needsImageReview: [], needsFontReview: [], metrics: { remaining: 0, missingImagePaths: [] },
    unavailableReferences, blockingReferenceCount: 2, comparisonReviewReason: reason,
  });
  const response = await h.run();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.unavailableReferences, unavailableReferences);
  assert.equal(body.blockingReferenceCount, 2);
  assert.equal(body.comparisonReviewReason, reason);
  assert.equal(body.productionBlocked, true);
  assert.deepEqual(body.top10.map(row => row.id), [candidate.id]);
  assert.equal(body.top10[0].file, "새 회사소개서.pptx");
  assert.match(body.top10[0].reasons[0], /확인 대기/);
  assert.doesNotMatch(body.top10[0].reasons[0], /중복 검사 통과/);
  assert.equal(body.productionStarted, false);
  assert.equal(h.calls[0].options.readOnly, true);
});

test("preview reports completed comparison when all unavailable records have been marked", async () => {
  const candidate = { id: "ready", project_name: "제작 후보" };
  const h = preview({ accepted: [candidate], previewAccepted: [candidate], groups: [], decisions: [], sourceFailures: [],
    needsImageReview: [], needsFontReview: [], metrics: { remaining: 0 }, unavailableReferences: [], blockingReferenceCount: 0 });
  const body = await (await h.run()).json();
  assert.equal(body.productionBlocked, false);
  assert.equal(body.top10[0].id, "ready");
  assert.match(body.top10[0].reasons[0], /중복 검사 통과/);
});
