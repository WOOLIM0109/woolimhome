import assert from "node:assert/strict";
import test from "node:test";

/**
 * 무엇이 발행을 막고 무엇이 경고로만 남는지 고정합니다.
 *
 * 실제 판정은 lib/columns/generate.ts 안에서 이 한 줄로 이뤄집니다.
 *
 *   const styleWarnings = issues.filter((issue) => styleIssues.includes(issue));
 *   const blocked = issues.length > styleWarnings.length;
 *
 * 즉 styleIssues 에 들어 있지 않은 지적이 하나라도 있으면 막힙니다.
 * 출처 부족은 styleOnlyFindings 를 거쳐 styleIssues 에 들어가므로 경고입니다.
 * 이 규칙이 조용히 뒤집히면 예전처럼 출처 때문에 계속 보류됩니다.
 */
function decide(issues, styleIssues) {
  const styleWarnings = issues.filter((issue) => styleIssues.includes(issue));
  return { blocked: issues.length > styleWarnings.length, styleWarnings };
}

const SOURCE_WARNING = "공식 출처가 1개입니다. 인정되지 않은 주소: https://example.com";
const STYLE = "100자를 넘는 긴 문장이 2개 있습니다.";
const HARD = "본문이 짧습니다(900자).";

test("출처가 모자라도 발행을 막지 않는다", () => {
  const { blocked } = decide([SOURCE_WARNING], [SOURCE_WARNING]);
  assert.equal(blocked, false);
});

test("출처 부족과 문체 지적만 있으면 저장하고 넘어간다", () => {
  const { blocked, styleWarnings } = decide(
    [STYLE, SOURCE_WARNING],
    [STYLE, SOURCE_WARNING],
  );
  assert.equal(blocked, false);
  assert.equal(styleWarnings.length, 2);
});

test("분량 미달은 여전히 막는다", () => {
  // 이건 사람이 편집기에서 고칠 수 있는 종류가 아닙니다.
  const { blocked } = decide([HARD, SOURCE_WARNING], [SOURCE_WARNING]);
  assert.equal(blocked, true);
});

test("지적이 하나도 없으면 통과", () => {
  assert.equal(decide([], []).blocked, false);
});

test("경고 목록에 없는 지적이 섞이면 막는다", () => {
  const { blocked } = decide(
    [STYLE, "허용되지 않은 HTML이 있습니다."],
    [STYLE],
  );
  assert.equal(blocked, true);
});
