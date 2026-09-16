import assert from "node:assert/strict";
import test from "node:test";

import {
  REVISION_MAX_GROWTH_RATIO,
  acceptRevisedSection,
  describeRevisionOutcome,
  joinRevisionSections,
  lockRevisionSection,
  normalizeRevisionNote,
  revisionSectionPrompt,
  revisionSections,
} from "./draft-revision.ts";

/*
 * 담당자가 겪은 일은 이렇습니다.
 *
 *   검토 화면에서 '수정 요청'을 눌렀더니 목업부터 다시 만들라고 한다.
 *
 * 포트폴리오는 그 버튼이 서버에서 막혀 있었기 때문입니다. 남은 길은 손으로
 * HTML 을 고치는 것뿐이었는데, 담당자가 원한 것은 "이 문단을 중간중간 넣어줘"
 * 라고 적으면 인공지능이 알아서 반영해 주는 것이었습니다.
 *
 * 그래서 이미 쓴 글을 살려 둔 채 요청받은 것만 고치는 길을 냅니다.
 * 아래 시험이 지키는 것은 하나입니다. 요청을 반영하다가 원문의 그림·링크·수치가
 * 사라지거나 자리를 옮기면, 그 구간은 버리고 원문을 쓴다.
 */

/** 마커를 그대로 둔 채 문단만 덧붙인, '착한 모델'의 답을 흉내 냅니다. */
function appendParagraph(lockedHtml, extra) {
  return `${lockedHtml}<p>${extra}</p>`;
}

test("소제목을 경계로 본문을 나눈다", () => {
  const body = [
    "<p>도입입니다.</p>",
    `<h2>첫 번째</h2><p>${"가".repeat(800)}</p>`,
    `<h2>두 번째</h2><p>${"나".repeat(800)}</p>`,
  ].join("");
  const sections = revisionSections(body);
  assert.ok(sections.length >= 2, "소제목마다 나뉘어야 합니다.");
  assert.equal(joinRevisionSections(sections), body, "되붙이면 원문과 같아야 합니다.");
});

test("빈 요청은 받지 않는다", () => {
  assert.equal(normalizeRevisionNote(""), null);
  assert.equal(normalizeRevisionNote("   "), null);
  assert.equal(normalizeRevisionNote("ㅇ"), null, "한 글자로는 무엇을 하라는지 알 수 없습니다.");
  assert.equal(normalizeRevisionNote(null), null);
  assert.equal(normalizeRevisionNote("  문단을 넣어줘  "), "문단을 넣어줘");
});

test("요청사항과 구간 위치가 부탁하는 글에 들어간다", () => {
  const prompt = revisionSectionPrompt({
    note: "이 문단을 중간중간 반복해서 넣어주세요",
    lockedHtml: "<p>본문</p>",
    position: 2,
    total: 4,
  });
  assert.ok(prompt.includes("중간중간 반복해서"), "요청사항이 빠졌습니다.");
  // 위치를 안 알려 주면 모든 구간이 자기가 첫 구간인 줄 알고 도입부만 만들어 냅니다.
  assert.ok(prompt.includes("4개 구간 가운데 2번째"), "구간 위치가 빠졌습니다.");
  assert.ok(prompt.includes("한 글자도 바꾸지 마세요"), "무관한 문장을 지키는 규칙이 빠졌습니다.");
});

test("요청받은 문단을 덧붙인 답은 받아들인다", () => {
  // 담당자가 실제로 넣고 싶어 한 문구입니다. '1억 원'이라는 새 수치가 들어 있습니다.
  const original = `<h2>제안 배경</h2><p>${"본문입니다. ".repeat(40)}</p>`;
  const locked = lockRevisionSection(original);
  const answer = appendParagraph(
    locked.value,
    "부산 모 아파트 실제 1억 원 수주로 이어진 건입니다.",
  );
  const accepted = acceptRevisedSection(original, answer, locked.locks);
  assert.ok(accepted.includes("1억 원"), "요청에서 온 새 수치가 들어가야 합니다.");
  assert.ok(accepted.includes("<h2>제안 배경</h2>"), "소제목이 그대로 있어야 합니다.");
  assert.ok(accepted.startsWith(original), "원문이 앞에 그대로 남아야 합니다.");
});

test("원문의 수치를 지우면 그 구간을 버린다", () => {
  // 말투 다듬기와 달리 수치가 '늘어나는' 것은 허용합니다. 요청에서 오기 때문입니다.
  // 하지만 원문에 있던 것이 사라지는 것은 언제나 실패입니다.
  const original = "<h2>성과</h2><p>계약 기간은 12개월이고 참여 인원은 8명입니다.</p>";
  const locked = lockRevisionSection(original);
  // 모델이 마커 하나를 빠뜨린 답
  const broken = locked.value.replace(/WOOLIMLOCKBODY[A-Z]+END/, "");
  assert.throws(
    () => acceptRevisedSection(original, broken, locked.locks),
    /누락되거나 중복/,
  );
});

test("그림과 링크의 순서를 바꾸면 그 구간을 버린다", () => {
  const original = [
    "<h2>화면</h2>",
    "<figure><img src=\"https://example.com/a.png\" /></figure>",
    "<p>설명입니다.</p>",
    "<figure><img src=\"https://example.com/b.png\" /></figure>",
  ].join("");
  const locked = lockRevisionSection(original);
  const markers = locked.value.match(/WOOLIMLOCKBODY[A-Z]+END/g) || [];
  assert.ok(markers.length >= 2, "그림이 잠기지 않았습니다.");
  // 첫 그림과 마지막 그림의 자리를 맞바꾼 답
  const swapped = locked.value
    .replace(markers[0], "__FIRST__")
    .replace(markers[markers.length - 1], markers[0])
    .replace("__FIRST__", markers[markers.length - 1]);
  assert.throws(() => acceptRevisedSection(original, swapped, locked.locks), /순서가 달라졌습니다/);
});

test("모델이 없던 그림이나 링크를 지어내면 걷어낸다", () => {
  const original = `<h2>안내</h2><p>${"설명입니다. ".repeat(40)}</p>`;
  const locked = lockRevisionSection(original);
  const answer = appendParagraph(
    locked.value,
    "자세한 내용은 <a href=\"https://evil.example.com\">여기</a>를 보세요.",
  );
  const accepted = acceptRevisedSection(original, answer, locked.locks);
  assert.ok(!accepted.includes("evil.example.com"), "지어낸 링크가 남았습니다.");
  assert.ok(accepted.includes("여기"), "링크 안의 글자는 남아야 합니다.");
});

test("본문 그림이 사라지면 그 구간을 버린다", () => {
  /*
   * figure 없이 놓인 <img> 는 주소가 상대 경로면 잠글 것이 없습니다.
   * 정리기가 <img> 태그를 걷어내는 순간 아무 소리 없이 사라지고,
   * 승인 단계에서야 "본문 이미지 URL이 목업 자산과 일치하지 않습니다" 로 막힙니다.
   */
  const original = `<h2>화면</h2><img src="/mockups/board-1.png" /><p>${"설명입니다. ".repeat(40)}</p>`;
  const locked = lockRevisionSection(original);
  assert.ok(!locked.value.includes("<img"), "그림이 잠기지 않았습니다.");
  // 그림은 마커로 잠기므로, 모델이 빠뜨리면 되돌리는 단계에서 걸립니다.
  const dropped = locked.value.replace(/WOOLIMLOCKBODY[A-Z]+END/, "");
  assert.throws(() => acceptRevisedSection(original, dropped, locked.locks), /누락되거나 중복/);
});

test("그림을 그대로 둔 답은 받아들인다", () => {
  const original = `<h2>화면</h2><img src="/mockups/board-1.png" /><p>${"설명입니다. ".repeat(40)}</p>`;
  const locked = lockRevisionSection(original);
  const accepted = acceptRevisedSection(
    original,
    `${locked.value}<p>덧붙인 문단입니다.</p>`,
    locked.locks,
  );
  assert.ok(accepted.includes('src="/mockups/board-1.png"'), "그림이 사라졌습니다.");
});

test("소제목을 새로 만들면 그 구간을 버린다", () => {
  const original = `<h2>기존 소제목</h2><p>${"본문입니다. ".repeat(40)}</p>`;
  const locked = lockRevisionSection(original);
  const answer = `${locked.value}<h2>새로 만든 소제목</h2><p>덧붙입니다.</p>`;
  assert.throws(() => acceptRevisedSection(original, answer, locked.locks), /소제목 개수가/);
});

test("구간이 통째로 날아가면 버린다", () => {
  const original = `<h2>본문</h2><p>${"지켜야 할 내용입니다. ".repeat(40)}</p>`;
  const locked = lockRevisionSection(original);
  // 소제목만 남기고 본문을 버린 답. 마커가 없는 구간이라 길이로만 걸러집니다.
  assert.throws(
    () => acceptRevisedSection(original, "<h2>본문</h2><p>짧게</p>", locked.locks),
    /지나치게 짧아졌습니다/,
  );
});

test("한 구간이 몇 배로 불어나면 버린다", () => {
  const original = `<h2>본문</h2><p>${"내용입니다. ".repeat(20)}</p>`;
  const locked = lockRevisionSection(original);
  const flood = appendParagraph(locked.value, "덧붙임입니다. ".repeat(400));
  assert.throws(
    () => acceptRevisedSection(original, flood, locked.locks),
    /지나치게 길어졌습니다/,
  );
  // 문단 하나를 넣는 정도는 허용해야 합니다. 그게 이 기능의 목적입니다.
  assert.ok(REVISION_MAX_GROWTH_RATIO > 1.3, "말투 다듬기보다는 넉넉해야 합니다.");
});

test("빈 답은 받지 않는다", () => {
  const original = "<h2>본문</h2><p>내용입니다.</p>";
  const locked = lockRevisionSection(original);
  assert.throws(() => acceptRevisedSection(original, "", locked.locks), /비어 있습니다/);
  assert.throws(() => acceptRevisedSection(original, null, locked.locks), /비어 있습니다/);
});

test("결과를 사람이 읽을 한 줄로 적는다", () => {
  assert.equal(
    describeRevisionOutcome({ changed: 3, kept: 0, failures: [] }),
    "3개 구간에 요청을 반영했습니다.",
  );
  assert.equal(
    describeRevisionOutcome({ changed: 2, kept: 1, failures: [] }),
    "2개 구간에 요청을 반영했고, 1개 구간은 원문 그대로 두었습니다.",
  );
  assert.equal(
    describeRevisionOutcome({ changed: 0, kept: 3, failures: [] }),
    "요청을 반영한 구간이 없습니다.",
  );
});
