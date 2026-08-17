import assert from "node:assert/strict";
import test from "node:test";

import {
  bodySectionsForRewrite,
  joinBodySections,
  mergeSmallSections,
  plainTextLength,
  splitBodySections,
} from "./body-sections.ts";

/** 글자 수를 채우기 위한 긴 문단 */
function paragraph(mark, times = 80) {
  return `<p>${`${mark}번 문단의 설명입니다. `.repeat(times)}</p>`;
}

test("소제목마다 나눈다", () => {
  const body = `${paragraph("도입")}<h2>첫째</h2>${paragraph("첫째")}<h2>둘째</h2>${paragraph("둘째")}`;
  const sections = splitBodySections(body);
  assert.equal(sections.length, 3);
  assert.ok(sections[0].startsWith("<p>도입"));
  assert.ok(sections[1].startsWith("<h2>첫째"));
  assert.ok(sections[2].startsWith("<h2>둘째"));
});

test("나눈 것을 되붙이면 원문과 같다", () => {
  const body = `${paragraph("도입")}<h2>첫째</h2>${paragraph("첫째")}<h2>둘째</h2>${paragraph("둘째")}`;
  assert.equal(joinBodySections(splitBodySections(body)), body);
});

test("소제목이 없으면 통째로 한 덩이다", () => {
  const body = paragraph("혼자");
  assert.deepEqual(splitBodySections(body), [body]);
});

test("빈 본문은 덩이가 없다", () => {
  assert.deepEqual(splitBodySections(""), []);
  assert.deepEqual(splitBodySections("   "), []);
});

test("짧은 덩이는 옆에 붙는다", () => {
  // 소제목만 있고 내용이 거의 없는 구간이 홀로 요청되지 않게 합니다.
  const body = "<h2>가</h2><p>짧다.</p><h2>나</h2><p>이것도 짧다.</p>";
  const merged = bodySectionsForRewrite(body);
  assert.equal(merged.length, 1);
  assert.equal(joinBodySections(merged), body);
});

test("긴 덩이는 나뉜 채로 남는다", () => {
  const body = `<h2>가</h2>${paragraph("가")}<h2>나</h2>${paragraph("나")}`;
  const merged = bodySectionsForRewrite(body);
  assert.equal(merged.length, 2);
  assert.equal(joinBodySections(merged), body);
});

test("덩이 수 상한을 넘지 않는다", () => {
  // 요청 횟수가 원고 길이에 따라 무한정 늘지 않게 막습니다.
  const body = Array.from({ length: 20 }, (_, index) =>
    `<h2>${index}</h2>${paragraph(index)}`).join("");
  const merged = mergeSmallSections(splitBodySections(body), 700, 8);
  assert.ok(merged.length <= 8, `덩이 수: ${merged.length}`);
  assert.equal(joinBodySections(merged), body);
});

test("마지막 짧은 덩이도 앞에 붙는다", () => {
  const body = `<h2>가</h2>${paragraph("가")}<h2>마무리</h2><p>끝.</p>`;
  const merged = bodySectionsForRewrite(body);
  assert.equal(merged.length, 1);
  assert.equal(joinBodySections(merged), body);
});

test("태그를 뺀 글자 수를 센다", () => {
  assert.equal(plainTextLength("<p>가나다</p>"), 3);
  assert.equal(plainTextLength("<p>가 나 다</p>"), 3);
  assert.equal(plainTextLength(""), 0);
});
