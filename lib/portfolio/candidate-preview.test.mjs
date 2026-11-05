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
      deterministicShortlist: () => [], metadataEligible: () => true,
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
