import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COLUMN_BODY_PATCH_SCHEMA, COLUMN_DRAFT_SCHEMA } from "./draft-schema.ts";
import { COLUMN_KINDS } from "./types.ts";

/**
 * 설계도와 실제로 쓰는 항목이 어긋나지 않게 붙잡습니다.
 *
 * 설계도에 없는 항목은 모델이 아예 돌려주지 않습니다. 타입에 항목을 하나
 * 더하고 여기를 안 고치면, 그 항목은 언제나 비어 옵니다. 오류도 안 납니다.
 * 조용히 빈 값이 되는 것이 제일 찾기 어렵습니다.
 */

/** generate.ts 의 Generated 타입에서 항목 이름만 뽑아냅니다. */
function generatedTypeKeys() {
  const source = readFileSync(new URL("./generate.ts", import.meta.url), "utf8");
  const start = source.indexOf("type Generated = {");
  assert.ok(start >= 0, "generate.ts 에서 Generated 타입을 찾지 못했습니다.");
  const end = source.indexOf("};", start);
  assert.ok(end > start, "Generated 타입의 끝을 찾지 못했습니다.");
  return source.slice(start, end)
    .split("\n")
    .map((line) => line.match(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/))
    .filter(Boolean)
    .map((matched) => matched[1]);
}

test("설계도의 항목과 Generated 타입의 항목이 같다", () => {
  const schemaKeys = Object.keys(COLUMN_DRAFT_SCHEMA.properties).sort();
  const typeKeys = generatedTypeKeys().sort();
  assert.ok(typeKeys.length >= 10, "타입에서 항목을 제대로 못 읽었습니다.");
  assert.deepEqual(schemaKeys, typeKeys);
});

test("contentKind 는 표가 받아 주는 값만 허용한다", () => {
  // 여기 없는 값을 저장하면 마지막 줄에서 통째로 거절당합니다(#129).
  assert.deepEqual([...COLUMN_DRAFT_SCHEMA.properties.contentKind.enum], [...COLUMN_KINDS]);
});

test("반드시 있어야 하는 것은 제목과 본문뿐이다", () => {
  /*
   * 넓게 요구하면 모델이 못 채웠을 때 응답 자체가 거절당하고, 그러면
   * 지금과 똑같이 그 회차를 잃습니다. 빈자리는 normalizeDraft 가 채웁니다.
   */
  assert.deepEqual([...COLUMN_DRAFT_SCHEMA.required], ["title", "bodyHtml"]);
});

test("목록 항목은 문자열 배열로 선언되어 있다", () => {
  for (const key of ["tags", "usedSourceUrls", "usedKnowledgeIds", "expertQuestions"]) {
    const property = COLUMN_DRAFT_SCHEMA.properties[key];
    assert.equal(property.type, "ARRAY", `${key} 가 배열이 아닙니다.`);
    assert.equal(property.items.type, "STRING", `${key} 의 항목이 문자열이 아닙니다.`);
  }
});

test("FAQ 는 질문과 답을 한 쌍으로 요구한다", () => {
  const faqs = COLUMN_DRAFT_SCHEMA.properties.faqs;
  assert.equal(faqs.type, "ARRAY");
  assert.deepEqual(Object.keys(faqs.items.properties).sort(), ["answer", "question"]);
  assert.deepEqual([...faqs.items.required].sort(), ["answer", "question"]);
});

test("조각 설계도는 본문과 FAQ 만 받는다", () => {
  // 글 전체를 다시 받으면 그만큼 응답이 길어지고 끊길 위험도 커집니다.
  assert.deepEqual(Object.keys(COLUMN_BODY_PATCH_SCHEMA.properties).sort(), ["bodyHtml", "faqs"]);
});

test("본문 호출과 조각 호출 모두 설계도를 넘긴다", () => {
  /*
   * 이 시험이 없던 동안 칼럼 본문만 설계도 없이 돌았고, 화·목·토마다
   * JSON 을 읽다가 죽었습니다. 블로그와 주제 기획에는 있었습니다.
   */
  const source = readFileSync(new URL("./generate.ts", import.meta.url), "utf8");
  assert.match(source, /responseSchema:\s*COLUMN_DRAFT_SCHEMA/);
  assert.match(source, /responseSchema:\s*COLUMN_BODY_PATCH_SCHEMA/);
});
