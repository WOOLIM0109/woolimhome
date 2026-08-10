import test from "node:test";
import assert from "node:assert/strict";

import {
  coverTitleRecord,
  coverTitleSignature,
  hasRepeatedWord,
  mergeCoverTitleHistory,
  normalizeCoverTitle,
  parseCoverTitleHistory,
  suggestCoverTitles,
} from "./cover-title.ts";

test("같은 낱말이 반복되는 문구를 걸러낸다", () => {
  // 실제로 만들어졌던 문구입니다.
  assert.equal(hasRepeatedWord("비즈니스 비즈니스 문서 디자인"), true);
  assert.equal(hasRepeatedWord("대기업 비즈니스 제안서 디자인"), false);
});

test("너무 짧거나 긴 문구는 쓰지 않는다", () => {
  assert.equal(normalizeCoverTitle("가"), null);
  assert.equal(normalizeCoverTitle("가".repeat(41)), null);
  assert.equal(normalizeCoverTitle("  공공기관 관광마케팅 발표자료  "), "공공기관 관광마케팅 발표자료");
});

test("문서 조각으로 후보 세 개를 만든다", () => {
  const titles = suggestCoverTitles({
    parts: { clientPrefix: "공공기관", subject: "관광마케팅", documentType: "발표자료" },
  });
  assert.ok(titles.length >= 1 && titles.length <= 3);
  assert.equal(titles[0], "공공기관 관광마케팅 발표자료 디자인");
  assert.ok(titles.every((title) => !hasRepeatedWord(title)));
});

test("반복 문구만 나오는 경우에도 쓸 수 있는 후보를 준다", () => {
  const titles = suggestCoverTitles({
    base: "비즈니스 비즈니스 문서 디자인",
    parts: { subject: "비즈니스", documentType: "비즈니스 문서", projectName: "우림상사 하반기 소개" },
  });
  assert.ok(titles.length >= 1);
  assert.ok(titles.every((title) => !hasRepeatedWord(title)),
    `반복 문구가 후보에 남았습니다: ${JSON.stringify(titles)}`);
});

test("관리자가 고른 문구가 다음 추천의 맨 앞에 온다", () => {
  const signature = coverTitleSignature({
    clientCategory: "large_company", industry: "연구개발", documentType: "제안서",
  });
  const history = [coverTitleRecord("대기업 연구개발 제안서 디자인", "manual", signature, "2026-08-01T00:00:00Z")];
  const titles = suggestCoverTitles({
    parts: { clientPrefix: "대기업", subject: "연구개발", documentType: "제안서" },
    pastTitles: history,
    signature,
  });
  assert.equal(titles[0], "대기업 연구개발 제안서 디자인");
});

test("같은 문구를 다시 저장해도 기록이 늘어나지 않는다", () => {
  const signature = "a|b|c";
  let history = [];
  history = mergeCoverTitleHistory(history, coverTitleRecord("가나다 제안서", "manual", signature, "2026-08-01T00:00:00Z"));
  history = mergeCoverTitleHistory(history, coverTitleRecord("가나다 제안서", "manual", signature, "2026-08-02T00:00:00Z"));
  assert.equal(history.length, 1);
  assert.equal(history[0].savedAt, "2026-08-02T00:00:00Z");
});

test("저장된 기록에서 형식이 어긋난 항목은 무시한다", () => {
  const parsed = parseCoverTitleHistory([
    { title: "정상", source: "manual", signature: "x", savedAt: "2026-08-01T00:00:00Z" },
    { title: "출처 없음", signature: "x", savedAt: "2026-08-01T00:00:00Z" },
    "문자열",
    null,
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "정상");
});
