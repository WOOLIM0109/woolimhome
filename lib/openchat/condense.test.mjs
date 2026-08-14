import assert from "node:assert/strict";
import test from "node:test";

import { CONDENSED_MAX_LENGTH, condensePrompt, normalizeCondensed, tidyLine } from "./condense.ts";

test("앞머리 기호와 끝 마침표를 걷어낸다", () => {
  assert.equal(tidyLine("- ㅇ 설립 7년 이내 콘텐츠 스타트업."), "설립 7년 이내 콘텐츠 스타트업");
  assert.equal(tidyLine("※ 사업화자금 최대 3,000만 원"), "사업화자금 최대 3,000만 원");
});

test("너무 길면 자른다", () => {
  const value = tidyLine("가".repeat(300));
  assert.ok(value.length <= CONDENSED_MAX_LENGTH + 1, value.length);
  assert.ok(value.endsWith("…"));
});

test("글자가 아니면 빈 값으로 본다", () => {
  assert.equal(tidyLine(null), "");
  assert.equal(tidyLine(42), "");
  assert.equal(tidyLine(undefined), "");
});

test("보내지 않은 공고 id 는 받지 않는다", () => {
  // 모델이 없는 공고를 지어내면 엉뚱한 글이 붙습니다.
  const rows = normalizeCondensed(
    [{ id: "있는것", target: "대상", support: "지원" }, { id: "지어낸것", target: "대상", support: "지원" }],
    ["있는것"],
  );
  assert.deepEqual(rows.map((row) => row.id), ["있는것"]);
});

test("같은 공고가 두 번 오면 처음 것만 쓴다", () => {
  const rows = normalizeCondensed(
    [{ id: "가", target: "첫째", support: "" }, { id: "가", target: "둘째", support: "" }],
    ["가"],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "첫째");
});

test("두 줄이 모두 비면 버린다", () => {
  const rows = normalizeCondensed([{ id: "가", target: "  ", support: "" }], ["가"]);
  assert.deepEqual(rows, []);
});

test("배열이 아니면 아무것도 돌려주지 않는다", () => {
  assert.deepEqual(normalizeCondensed({ id: "가" }, ["가"]), []);
  assert.deepEqual(normalizeCondensed(null, ["가"]), []);
});

test("지시문에 원문만 쓰라는 조건이 들어간다", () => {
  const prompt = condensePrompt([{ id: "가", title: "제목", applicantSummary: "대상", supportSummary: "지원" }]);
  assert.match(prompt, /원문에 있는 말만 쓴다/);
  assert.match(prompt, /보장하는 표현은 쓰지 않는다/);
  assert.match(prompt, /"가"/);
});
