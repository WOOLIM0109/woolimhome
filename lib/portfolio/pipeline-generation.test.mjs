import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPortfolioGenerationId,
  ownsPortfolioGeneration,
  ownsPortfolioTerminalHold,
} from "./pipeline-generation.ts";

test("portfolio side effects require one exact generation, source, and rule owner", () => {
  const input = {
    jobId: "job-1",
    completedAt: "2026-08-05T00:00:00.000Z",
    sourceFingerprint: "source-a",
  };
  const generationId = createPortfolioGenerationId(input);
  const metadata = {
    portfolioGenerationId: generationId,
    portfolioSourceFingerprint: input.sourceFingerprint,
    portfolioRuleVersion: "rule-v4",
  };

  assert.equal(ownsPortfolioGeneration(metadata, generationId, "source-a", "rule-v4"), true);
  assert.equal(ownsPortfolioGeneration(metadata, `${generationId}-new`, "source-a", "rule-v4"), false);
  assert.equal(ownsPortfolioGeneration(metadata, generationId, "source-b", "rule-v4"), false);
  assert.equal(ownsPortfolioGeneration(metadata, generationId, "source-a", "rule-v5"), false);
  assert.equal(ownsPortfolioGeneration(null, generationId, "source-a", "rule-v4"), false);
});

test("terminal holds cannot follow a newer generation or conversion", () => {
  assert.equal(ownsPortfolioTerminalHold({
    portfolioConversionGenerationId: "convert-a",
  }, { conversionGenerationId: "convert-a" }), true);
  assert.equal(ownsPortfolioTerminalHold({
    portfolioConversionGenerationId: "convert-b",
  }, { conversionGenerationId: "convert-a" }), false);
  assert.equal(ownsPortfolioTerminalHold({
    portfolioGenerationId: "generation-b",
  }, {}), false);
  assert.equal(ownsPortfolioTerminalHold({}, {}), true);
});

test("completed worker callback returns before downstream mutations", () => {
  const source = readFileSync(
    new URL("../../app/api/worker/jobs/complete/route.ts", import.meta.url),
    "utf8",
  );
  const replayGuard = source.indexOf('if (job.status === "completed")');
  const workItemInvalidation = source.indexOf("const completionGenerationId");
  const downstreamMutation = source.indexOf('status: "queued"', workItemInvalidation);
  const finalCompletionCas = source.indexOf('.contains("result", { completionGenerationId })');

  assert.ok(replayGuard >= 0);
  assert.ok(workItemInvalidation > replayGuard);
  assert.ok(downstreamMutation > workItemInvalidation);
  assert.ok(finalCompletionCas > downstreamMutation);
  assert.match(source.slice(replayGuard, workItemInvalidation), /replayed: true/);
});

test("legacy completed mockups are terminally held instead of silently skipped", () => {
  const source = readFileSync(new URL("./job-runner.ts", import.meta.url), "utf8");
  assert.match(source, /PORTFOLIO_REDACTION_UPGRADE_REQUIRED/);
  assert.match(source, /await holdDraftForRedactionUpgrade/);
  assert.match(source, /자동 재생성하지 않으므로/);
});

test("draft and review-asset side effects stay bound to the exact generation", () => {
  const source = readFileSync(new URL("./job-runner.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /ownsPortfolioGeneration\(\s*workItem\.metadata,\s*mockup\.portfolioGenerationId,/,
  );
  assert.match(source, /\.contains\("metadata", \{\s*portfolioGenerationId: mockup\.portfolioGenerationId,/);
  assert.match(source, /catch \(error\) \{\s*try \{\s*await cleanupPendingInsertedAssets\(\);/);
  assert.match(source, /await assertGenerationOwnership\(\);\s*pendingInsertedAssetIds = \[\];/);
});
