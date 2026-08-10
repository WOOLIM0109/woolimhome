import assert from "node:assert/strict";
import test from "node:test";

import {
  isVisibleToPartner,
  partnerVisibilityBlockers,
} from "./partner-portal.ts";

/** 규칙을 모두 지킨 본문. 이 본문이면 문체 검사에 걸리지 않습니다. */
const cleanBody = `
<p>제안서를 처음 만들면 어디부터 손대야 할지 막막하시죠?</p>
<h2>먼저 확인할 세 가지</h2>
<ol>
<li><strong>발주처 평가표</strong>를 먼저 확인합니다.</li>
<li><strong>제출 규격</strong>을 문서 첫 장에 적어 둡니다.</li>
<li><strong>담당자 연락</strong> 시점을 정해 둡니다.</li>
</ol>
<p>여기까지 정리하면 나머지는 훨씬 수월합니다. <strong>순서</strong>만 지켜 주세요!</p>
<p>다음 장부터는 <strong>장표 배치</strong>를 정리합니다.</p>
`;

const cleanFaq = [
  { question: "제안서 분량은 얼마가 적당한가요", answer: "발주처가 정한 상한을 그대로 따릅니다." },
  { question: "장표 순서를 바꿔도 되나요", answer: "평가표 항목 순서에 맞추는 편이 안전합니다." },
  { question: "표지 문구는 언제 정하나요", answer: "본문을 마친 뒤 마지막에 정합니다." },
];

function portfolio(overrides = {}) {
  return {
    channel: "naver_design",
    format: "portfolio",
    status: "approved",
    metadata: {
      generated: { bodyHtml: cleanBody, faq: cleanFaq },
      ...overrides,
    },
  };
}

test("규칙을 지킨 승인 포트폴리오는 외주 작업실에 보인다", () => {
  assert.deepEqual(partnerVisibilityBlockers(portfolio()), []);
  assert.equal(isVisibleToPartner(portfolio()), true);
});

test("문체 규칙에 걸리면 사유를 남긴다. 조용히 사라지지 않는다", () => {
  const blockers = partnerVisibilityBlockers({
    channel: "naver_design",
    format: "portfolio",
    status: "approved",
    metadata: { generated: { bodyHtml: "<p>짧은 본문입니다.</p>", faq: [] } },
  });
  assert.ok(blockers.length > 0, "막혔다면 사유가 있어야 합니다.");
  assert.ok(blockers.every((blocker) => blocker.message.trim().length > 0));
  assert.ok(blockers.some((blocker) => blocker.code === "editorial"));
});

test("승인 전 작업은 상태 사유 하나만 알려 준다", () => {
  const blockers = partnerVisibilityBlockers({
    channel: "naver_design",
    format: "portfolio",
    status: "review_required",
    metadata: null,
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, "status");
});

test("발행 완료 작업은 언제나 외주 작업실에 남는다", () => {
  // 실제로 보고된 현상: 발행한 글이 목록에서 사라져 기록을 확인할 수 없었습니다.
  assert.deepEqual(partnerVisibilityBlockers({
    channel: "naver_design",
    format: "portfolio",
    status: "published",
    metadata: { generated: { bodyHtml: "<p>짧은 본문.</p>", faq: [] } },
  }), []);
});

test("관리자가 그대로 보내기로 한 작업은 더 막지 않는다", () => {
  assert.deepEqual(partnerVisibilityBlockers({
    channel: "naver_design",
    format: "portfolio",
    status: "approved",
    metadata: {
      generated: { bodyHtml: "<p>짧은 본문.</p>", faq: [] },
      partnerReleaseOverride: { approvedAt: "2026-08-10T00:00:00.000Z" },
    },
  }), []);
});

test("네이버 채널이 아닌 작업은 외주 대상이 아니다", () => {
  const blockers = partnerVisibilityBlockers({
    channel: "homepage",
    format: "authority",
    status: "approved",
    metadata: null,
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, "channel");
});

test("일반 원고는 중복·구조 검사 사유도 함께 알려 준다", () => {
  const blockers = partnerVisibilityBlockers({
    channel: "naver_consulting",
    format: "informational",
    status: "approved",
    metadata: { generated: { bodyHtml: cleanBody, faq: cleanFaq } },
  });
  assert.ok(blockers.some((blocker) => blocker.code === "novelty"));
  assert.ok(blockers.some((blocker) => blocker.code === "validation"));
});

test("검사를 통과한 일반 원고는 그대로 보인다", () => {
  assert.deepEqual(partnerVisibilityBlockers({
    channel: "naver_consulting",
    format: "informational",
    status: "approved",
    metadata: {
      generated: {
        bodyHtml: cleanBody,
        faq: cleanFaq,
        sourceUrls: ["https://www.bizinfo.go.kr/", "https://www.smes.go.kr/"],
      },
      novelty: { duplicate: false },
      validation: { issues: [] },
    },
  }), []);
});
