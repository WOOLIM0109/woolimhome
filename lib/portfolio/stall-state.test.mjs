import assert from "node:assert/strict";
import test from "node:test";
import { portfolioDisplayState } from "./display-state.ts";
import { portfolioStallState } from "./stall-state.ts";

const now = new Date("2026-11-03T03:00:00Z");
const hoursAgo = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();

test("a portfolio without a body or body job needs notice immediately", () => {
  const item = {
    status: "creating",
    updated_at: hoursAgo(1),
    metadata: { portfolioStage: "design_completed", generated: { bodyHtml: "   " } },
    portfolio_jobs: [],
  };
  const display = portfolioDisplayState(item);
  const stalled = portfolioStallState(item, now);
  assert.equal(stalled.label, display.label);
  assert.equal(stalled.detail, display.detail);
  assert.equal(stalled.reason, "본문 작업 없음");
  assert.equal(stalled.days, 1);
});

test("body and font waits receive no notice until more than 24 hours have passed", () => {
  for (const item of [
    { status: "draft_waiting", portfolio_jobs: [{ id: "draft-job" }] },
    { status: "on_hold", review_note: "MISSING_FONTS: fonts: Work Sans." },
  ]) {
    for (const hours of [0, 23.99, 24]) {
      assert.equal(portfolioStallState({ ...item, updated_at: hoursAgo(hours) }, now), null);
    }
    const stalled = portfolioStallState({ ...item, updated_at: hoursAgo(24.01) }, now);
    assert.ok(stalled);
    assert.equal(stalled.days, 2);
    assert.equal(stalled.label, portfolioDisplayState(item).label);
  }
});

test("a held portfolio needs more than 48 hours and keeps its review reason", () => {
  const item = { status: "on_hold", review_note: "관리자 확인 필요" };
  assert.equal(portfolioStallState({ ...item, updated_at: hoursAgo(47.99) }, now), null);
  assert.equal(portfolioStallState({ ...item, updated_at: hoursAgo(48) }, now), null);
  const stalled = portfolioStallState({ ...item, updated_at: hoursAgo(48.01) }, now);
  assert.equal(stalled.reason, "보류");
  assert.equal(stalled.detail, item.review_note);
  assert.equal(stalled.days, 3);
});

test("published, approved, and scheduled portfolios do not become stalled", () => {
  for (const status of ["published", "approved", "scheduled"]) {
    assert.equal(portfolioStallState({
      status,
      updated_at: hoursAgo(240),
      metadata: { portfolioStage: "design_completed", missingFonts: ["Work Sans"] },
      portfolio_jobs: [],
    }, now), null);
  }
});

test("other displayed problems and review requests do not gain a new stall rule", () => {
  for (const item of [
    { status: "review_required" },
    { status: "on_hold", review_note: "유료 글꼴 미보유: Font A" },
    { status: "on_hold", review_note: "PC worker retry limit reached (3/3)." },
    { status: "researching" },
  ]) {
    assert.equal(portfolioStallState({ ...item, updated_at: hoursAgo(240) }, now), null);
  }
});

test("elapsed days count from the last work change without modifying it", () => {
  const item = Object.freeze({ status: "draft_waiting", updated_at: hoursAgo(72) });
  assert.equal(portfolioStallState(item, now).days, 3);
  assert.equal(item.updated_at, hoursAgo(72));
});
