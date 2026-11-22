import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { appendStatusChange } from "./status-history.ts";

const source = readFileSync(new URL("../../app/api/admin/content/[id]/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const imports = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true).statements
  .filter(ts.isImportDeclaration).map((statement) => statement.moduleSpecifier.text);
const initialMetadata = {
  candidateId: "b219c1d2-58eb-4bfa-b458-96b91667cafe",
  driveFileId: "original-drive-file",
  pipeline: "portfolio",
  sourceFileName: "proposal.pptx",
  selectionScore: 92,
  automated: true,
  generated: { bodyHtml: "<p>기존 원고</p>" },
  validation: { issues: ["이미지 재검토"] },
  statusHistory: [{ status: "creating", at: "2026-11-22T00:00:00.000Z", by: "automation" }],
};

function fixture({ metadata = initialMetadata, status = "on_hold", readError = null,
  manualApproval = false, editorialIssues = [] } = {}) {
  let item = structuredClone({ id: "metadata-item", title: "검토 원고", format: "portfolio",
    status, review_note: "이미지 재검토", metadata, updated_at: "2026-11-22T00:00:00.000Z" });
  const reads = [];
  const updates = [];
  const dependencies = Object.fromEntries(imports.map((name) => [name, {}]));
  const db = {
    from(table) {
      assert.ok(["content_work_items", "content_jobs"].includes(table));
      let patch;
      let columns;
      const query = {
        select(value) { columns = value; return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        update(value) { patch = JSON.parse(JSON.stringify(value)); updates.push(patch); return query; },
        async single() {
          if (table === "content_jobs") return { data: null, error: null };
          if (!patch) {
            reads.push(columns);
            return { data: readError ? null : structuredClone(item), error: readError };
          }
          item = { ...item, ...patch };
          return { data: structuredClone(item), error: null };
        },
        maybeSingle() { return query.single(); },
      };
      return query;
    },
  };
  Object.assign(dependencies, {
    "next/server": { NextResponse: Response },
    "@/lib/content-ops/data": { authenticatedAdmin: async () => ({ email: "admin@example.test" }), contentAdmin: () => db },
    "@/lib/content-ops/status-history": { appendStatusChange },
    "@/lib/portfolio/production-image-projection": { hasProductionPortfolioImageSelection: () => !manualApproval },
    "@/lib/portfolio/production-publication": { readVerifiedProductionPublicationIssues: async () => [] },
    "@/lib/content-ops/editorial-policy": { editorialPublicationIssues: () => editorialIssues },
    "@/lib/portfolio/manual-overrides": { isTourismMarketingWorkItem: () => false },
    "@/lib/portfolio/hyundai-manual-mockups": {
      hyundaiManualApprovalMetadata: (_title, current) => ({ ...current, manualMockupOverride: { approved: true } }),
    },
  });
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, Error, Request, Response, URL,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`); return dependencies[name]; },
  });
  return {
    reads, updates,
    get item() { return item; },
    patch(body) {
      return exports.PATCH(new Request("https://example.test/api/admin/content/metadata-item", {
        method: "PATCH", body: JSON.stringify(body),
      }), { params: Promise.resolve({ id: item.id }) });
    },
  };
}

test("non-approval status changes preserve source metadata and previous status history", async () => {
  for (const status of ["topic_candidate", "researching", "review_required", "draft_waiting"]) {
    const h = fixture();
    const response = await h.patch({ status });
    assert.equal(response.status, 200, status);
    assert.equal(h.reads.length, 1, status);
    assert.equal(h.item.status, status);
    const { statusHistory, ...preserved } = h.item.metadata;
    const { statusHistory: previousHistory, ...original } = initialMetadata;
    assert.deepEqual(preserved, original, status);
    assert.deepEqual(statusHistory.slice(0, -1), previousHistory, status);
    assert.equal(statusHistory.at(-1).status, status);
    assert.equal(statusHistory.at(-1).by, "admin@example.test");
  }
});

test("approval and hold reuse their metadata reads even when saved metadata is null", async () => {
  for (const metadata of [initialMetadata, null]) {
    for (const status of ["approved", "naver_ready", "scheduled", "on_hold"]) {
      const h = fixture({ metadata });
      const response = await h.patch({ status, review_note: "재검토" });
      assert.equal(response.status, 200, status);
      assert.equal(h.reads.length, 1, status);
      if (metadata) {
        assert.equal(h.item.metadata.candidateId, metadata.candidateId);
        assert.deepEqual(h.item.metadata.generated, metadata.generated);
        assert.deepEqual(h.item.metadata.statusHistory[0], metadata.statusHistory[0]);
      }
      assert.equal(h.item.metadata.statusHistory.at(-1).status, status);
    }
  }
});

test("manual approval, editorial override, and held-state cleanup survive the history append", async () => {
  const metadata = { ...initialMetadata, mockupOnlyRestoreState: { status: "on_hold" } };
  const h = fixture({ metadata, manualApproval: true, editorialIssues: ["문체 확인"] });
  const response = await h.patch({ status: "approved", overrideEditorial: true });
  assert.equal(response.status, 200);
  assert.equal(h.reads.length, 1);
  assert.equal(h.item.metadata.candidateId, metadata.candidateId);
  assert.deepEqual(h.item.metadata.generated, metadata.generated);
  assert.deepEqual(h.item.metadata.manualMockupOverride, { approved: true });
  assert.deepEqual(h.item.metadata.editorialOverride.overriddenIssues, ["문체 확인"]);
  assert.equal(h.item.metadata.editorialOverride.approvedBy, "admin@example.test");
  assert.equal(h.item.metadata.mockupOnlyRestoreState, null);
  assert.equal(h.item.review_note, null);
  assert.deepEqual(h.item.metadata.statusHistory.slice(0, -1), metadata.statusHistory);
  assert.equal(h.item.metadata.statusHistory.at(-1).status, "approved");
});

test("failed metadata reads return 500 before any status or other fields are written", async () => {
  for (const status of ["review_required", "draft_waiting", "approved", "naver_ready", "scheduled", "on_hold"]) {
    const h = fixture({ readError: { message: "metadata lookup failed" } });
    const response = await h.patch({ status, review_note: "변경 메모", scheduled_at: "2026-11-24T00:00:00Z" });
    assert.equal(response.status, 500, status);
    assert.deepEqual(await response.json(), { error: "metadata lookup failed" });
    assert.equal(h.updates.length, 0, status);
    assert.deepEqual(h.item.metadata, initialMetadata);
  }
});

test("a status change from null metadata still reads once before creating history", async () => {
  const h = fixture({ metadata: null });
  const response = await h.patch({ status: "draft_waiting" });
  assert.equal(response.status, 200);
  assert.equal(h.reads.length, 1);
  assert.deepEqual(Object.keys(h.item.metadata), ["statusHistory"]);
  assert.equal(h.item.metadata.statusHistory[0].status, "draft_waiting");
});

test("a note-only update leaves metadata untouched without reading it", async () => {
  const h = fixture();
  const response = await h.patch({ review_note: "메모만 수정" });
  assert.equal(response.status, 200);
  assert.equal(h.reads.length, 0);
  assert.equal(h.item.review_note, "메모만 수정");
  assert.equal(Object.hasOwn(h.updates[0], "metadata"), false);
  assert.deepEqual(h.item.metadata, initialMetadata);
});
