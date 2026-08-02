import assert from "node:assert/strict";
import test from "node:test";
import {
  isPartnerReleaseReady,
  shouldGenerateScheduledItem,
} from "./partner-portal.ts";

test("검증 기록이 없는 과거 승인 원고는 외주 작업실에서 차단한다", () => {
  assert.equal(isPartnerReleaseReady({
    format: "authority",
    status: "approved",
    metadata: null,
  }), false);
});

test("중복 및 구조 검사를 통과한 승인 원고만 외주 작업실에 전달한다", () => {
  assert.equal(isPartnerReleaseReady({
    format: "informational",
    status: "approved",
    metadata: {
      novelty: { duplicate: false },
      validation: { issues: [] },
    },
  }), true);
  assert.equal(isPartnerReleaseReady({
    format: "informational",
    status: "approved",
    metadata: {
      novelty: { duplicate: true },
      validation: { issues: [] },
    },
  }), false);
  assert.equal(isPartnerReleaseReady({
    format: "informational",
    status: "approved",
    metadata: {
      novelty: { duplicate: false },
      validation: { issues: ["본문 1500자"] },
    },
  }), false);
});

test("대표가 기존 원고를 직접 승인하면 검사 기록이 없어도 외주 작업실에 전달한다", () => {
  assert.equal(isPartnerReleaseReady({
    format: "design_insight",
    status: "approved",
    metadata: {
      partnerReleaseOverride: { approvedAt: "2026-08-03T00:00:00.000Z" },
    },
  }), true);
});

test("포트폴리오와 이미 발행된 기존 글은 유지한다", () => {
  assert.equal(isPartnerReleaseReady({
    format: "portfolio",
    status: "approved",
    metadata: null,
  }), true);
  assert.equal(isPartnerReleaseReady({
    format: "authority",
    status: "published",
    metadata: null,
  }), true);
});

test("일정을 먼저 차지한 미검증 승인 글은 자동 생성을 다시 수행한다", () => {
  assert.equal(shouldGenerateScheduledItem({
    format: "design_insight",
    status: "approved",
    metadata: null,
  }), true);
  assert.equal(shouldGenerateScheduledItem({
    format: "design_insight",
    status: "approved",
    metadata: {
      pendingRevision: { note: "WCAG 비중을 줄이고 다른 내용으로 보충해 주세요." },
      novelty: { duplicate: false },
      validation: { issues: [] },
    },
  }), true);
});

test("검증을 통과한 승인 글과 포트폴리오는 완료된 일정으로 유지한다", () => {
  assert.equal(shouldGenerateScheduledItem({
    format: "design_insight",
    status: "approved",
    metadata: {
      novelty: { duplicate: false },
      validation: { issues: [] },
    },
  }), false);
  assert.equal(shouldGenerateScheduledItem({
    format: "portfolio",
    status: "approved",
    metadata: null,
  }), false);
});
