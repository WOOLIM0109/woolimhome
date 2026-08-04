import assert from "node:assert/strict";
import test from "node:test";
import {
  isCompletePortfolioSourceDownload,
  portfolioConversionRecoveryState,
} from "./conversion-retry.ts";

test("a complete conversion with slides proceeds to mockup rebuild", () => {
  assert.equal(portfolioConversionRecoveryState({
    status: "completed",
    result: { bucket: "portfolio-rendered", slidePaths: ["slide-001.png"] },
  }), "ready");
});

test("an exhausted PC conversion is explicitly retryable", () => {
  assert.equal(portfolioConversionRecoveryState({
    status: "failed",
    errorMessage: "slide-018.png is missing\nPC worker retry limit reached (3/3).",
  }), "retryable");
});

test("an assigned or waiting conversion is not queued twice", () => {
  assert.equal(portfolioConversionRecoveryState({ status: "pc_waiting" }), "active");
  assert.equal(portfolioConversionRecoveryState({ status: "pc_running" }), "active");
});

test("permanent conversion failures are not bypassed by generic rebuild", () => {
  assert.equal(portfolioConversionRecoveryState({
    status: "failed",
    errorMessage: "MISSING_FONTS: Work Sans SemiBold",
  }), "unavailable");
});

test("a retry source requires a complete direct-drive or stored-file chain", () => {
  assert.equal(isCompletePortfolioSourceDownload({
    delivery: "pc_direct",
    originalFileName: "proposal.pptx",
    driveFileId: "drive-file-id",
  }), true);
  assert.equal(isCompletePortfolioSourceDownload({
    originalFileName: "proposal.pptx",
    bucket: "portfolio-source",
    storagePath: "candidate/proposal.pptx",
  }), true);
  assert.equal(isCompletePortfolioSourceDownload({
    delivery: "pc_direct",
    originalFileName: "proposal.pptx",
  }), false);
  assert.equal(isCompletePortfolioSourceDownload({
    originalFileName: "proposal.pptx",
    bucket: "portfolio-source",
  }), false);
});
