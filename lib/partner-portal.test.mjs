import assert from "node:assert/strict";
import test from "node:test";
import { isPartnerReleaseReady } from "./partner-portal.ts";

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
