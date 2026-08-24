import assert from "node:assert/strict";
import test from "node:test";
import { splitPublicationIssues } from "./editorial-style.ts";

const STYLE = ["100자를 넘는 긴 문장이 1개 있습니다.", "본문 핵심어 볼드가 부족합니다."];
const SOURCE = "독립된 공식 출처가 2개 미만입니다.";

test("모든 지적은 정확히 한 곳에만 들어간다", () => {
  /*
   * 화면이 상자 두 개로 나눠 그립니다. 양쪽에 다 들어가면 같은 문장이 두 번
   * 보이고, 어느 쪽에도 없으면 사람이 못 보고 지나갑니다.
   */
  const issues = [...STYLE, SOURCE];
  const { styleWarnings, blockingIssues } = splitPublicationIssues(issues, STYLE);
  assert.deepEqual([...blockingIssues, ...styleWarnings].sort(), [...issues].sort());
  assert.equal(styleWarnings.filter((issue) => blockingIssues.includes(issue)).length, 0);
});

test("문체만 걸리면 발행을 막지 않는다", () => {
  // FAQ 한 줄이 길다는 이유로 3,500자를 버리지 않습니다.
  const { blocked, blockingIssues, styleWarnings } = splitPublicationIssues(STYLE, STYLE);
  assert.equal(blocked, false);
  assert.deepEqual(blockingIssues, []);
  assert.equal(styleWarnings.length, 2);
});

test("출처가 섞이면 그것만 막는 쪽에 들어간다", () => {
  const { blocked, blockingIssues, styleWarnings } = splitPublicationIssues([...STYLE, SOURCE], STYLE);
  assert.equal(blocked, true);
  assert.deepEqual(blockingIssues, [SOURCE]);
  assert.equal(styleWarnings.length, 2);
});

test("지적이 없으면 막지 않는다", () => {
  const { blocked, blockingIssues, styleWarnings } = splitPublicationIssues([], STYLE);
  assert.equal(blocked, false);
  assert.deepEqual(blockingIssues, []);
  assert.deepEqual(styleWarnings, []);
});

test("같은 문장이 두 번 와도 양쪽에 흩어지지 않는다", () => {
  const { blockingIssues, styleWarnings } = splitPublicationIssues([STYLE[0], STYLE[0]], STYLE);
  assert.deepEqual(blockingIssues, []);
  assert.equal(styleWarnings.length, 2);
});
