import assert from "node:assert/strict";
import test from "node:test";
import {
  isReusableGeminiReviewCache,
  mergeGeminiReviewResults,
  pendingGeminiProviderIds,
  reusableGeminiReviewRows,
} from "./cache-policy.ts";

test("only a complete review with no failed items is reusable", () => {
  assert.equal(isReusableGeminiReviewCache({
    result: { results: [{ id: "one", status: "passed" }], failedItemIds: [] },
  }), true);
  assert.equal(isReusableGeminiReviewCache({
    result: { results: [{ id: "one", status: "failed" }], failedItemIds: ["one"] },
  }), false);
});

test("legacy, malformed, and missing review results are not reusable", () => {
  assert.equal(isReusableGeminiReviewCache({ result: { results: [] } }), false);
  assert.equal(isReusableGeminiReviewCache({ result: null }), false);
  assert.equal(isReusableGeminiReviewCache(null), false);
});

test("partial results recover passed and needs-revision provider ids but never failed ids", () => {
  const stored = {
    result: {
      results: [
        { id: "stable-a", status: "passed", issues: [] },
        { id: "stable-b", status: "needs_revision", issues: ["shorten"] },
        { id: "stable-c", status: "failed", issues: ["missing"] },
      ],
      failedItemIds: ["stable-c"],
    },
  };

  assert.deepEqual(reusableGeminiReviewRows(stored).map((row) => row.id), ["stable-a", "stable-b"]);
  assert.deepEqual(
    pendingGeminiProviderIds(["stable-a", "stable-b", "stable-c"], reusableGeminiReviewRows(stored)),
    ["stable-c"],
  );
});

test("recovered and fresh rows merge in the original full-batch order", () => {
  const recovered = [
    { id: "stable-b", status: "needs_revision", issues: ["edit"], suggestedContent: "B" },
    { id: "stable-a", status: "passed", issues: [], suggestedContent: "" },
  ];
  const fresh = [
    { id: "stable-c", status: "passed", issues: [], suggestedContent: "" },
  ];
  const merged = mergeGeminiReviewResults(
    ["stable-a", "stable-b", "stable-c"],
    recovered,
    fresh,
  );

  assert.deepEqual(merged.results.map((row) => [row.id, row.status]), [
    ["stable-a", "passed"],
    ["stable-b", "needs_revision"],
    ["stable-c", "passed"],
  ]);
  assert.deepEqual(merged.failedItemIds, []);
});

test("missing provider rows remain failed after merge and are the only next prompt", () => {
  const merged = mergeGeminiReviewResults(
    ["stable-a", "stable-b"],
    [{ id: "stable-a", status: "passed", issues: [], suggestedContent: "" }],
  );

  assert.deepEqual(merged.failedItemIds, ["stable-b"]);
  assert.deepEqual(pendingGeminiProviderIds(
    ["stable-a", "stable-b"],
    reusableGeminiReviewRows(merged),
  ), ["stable-b"]);
});

test("dedicated-cache and completed-log stubs recover complementary provider rows", () => {
  const dedicatedCacheStub = {
    result: {
      results: [{ id: "stable-a", status: "passed", issues: [], suggestedContent: "" }],
      failedItemIds: [],
    },
  };
  const completedUsageLogStub = {
    mergedResult: {
      results: [
        { id: "stable-a", status: "passed", issues: [], suggestedContent: "" },
        { id: "stable-b", status: "needs_revision", issues: ["edit"], suggestedContent: "B" },
        { id: "stable-c", status: "failed", issues: [], suggestedContent: "" },
      ],
      failedItemIds: ["stable-c"],
    },
  };
  const recovered = [
    ...reusableGeminiReviewRows(dedicatedCacheStub),
    ...reusableGeminiReviewRows(completedUsageLogStub.mergedResult),
  ];

  assert.deepEqual(pendingGeminiProviderIds(
    ["stable-a", "stable-b", "stable-c"],
    recovered,
  ), ["stable-c"]);
});
