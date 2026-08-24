import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CARDS_PER_FILE,
  importableKind,
  knowledgeImportPrompt,
  parseKnowledgeCards,
} from "./knowledge-import.ts";

const card = (extra = {}) => ({
  topic: "사업계획서 심사에서 실제로 보는 것",
  source_type: "interview",
  expertise_area: "business_plan",
  raw_text: "심사위원은 매출 계획보다 근거를 먼저 본다.",
  ...extra,
});

test("정상 응답을 카드로 읽는다", () => {
  const cards = parseKnowledgeCards(JSON.stringify({ cards: [card()] }));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].topic, "사업계획서 심사에서 실제로 보는 것");
  assert.equal(cards[0].expertise_area, "business_plan");
});

test("코드 울타리가 붙어 와도 읽는다", () => {
  const raw = "```json\n" + JSON.stringify({ cards: [card()] }) + "\n```";
  assert.equal(parseKnowledgeCards(raw).length, 1);
});

test("모르는 분류는 안전한 기본값으로 낮춘다", () => {
  /*
   * 목록에 없는 값을 그대로 저장하면 표의 제약에 걸려, 파일을 다 읽고 요금까지
   * 쓴 뒤 마지막 저장에서 통째로 거절당합니다. 칼럼 쪽에서 실제로 그렇게 죽었습니다.
   */
  const cards = parseKnowledgeCards(JSON.stringify({
    cards: [card({ source_type: "녹취", expertise_area: "마케팅" })],
  }));
  assert.equal(cards[0].source_type, "note");
  assert.equal(cards[0].expertise_area, "general");
});

test("주제나 내용이 빈 카드는 버린다", () => {
  const cards = parseKnowledgeCards(JSON.stringify({
    cards: [card({ topic: "  " }), card({ raw_text: "" }), card()],
  }));
  assert.equal(cards.length, 1);
});

test("선택 항목이 비면 null 로 둔다", () => {
  // 빈 문자열로 저장하면 화면에서 '내용이 있는데 비어 보이는' 칸이 됩니다.
  const cards = parseKnowledgeCards(JSON.stringify({
    cards: [card({ perspective: "   ", case_evidence: "실제로 3건 있었다" })],
  }));
  assert.equal(cards[0].perspective, null);
  assert.equal(cards[0].case_evidence, "실제로 3건 있었다");
  assert.equal(cards[0].differentiator, null);
});

test("카드가 아무리 많아도 상한을 넘지 않는다", () => {
  const many = Array.from({ length: 100 }, (_, index) => card({ topic: `주제 ${index}` }));
  assert.equal(parseKnowledgeCards(JSON.stringify({ cards: many })).length, MAX_CARDS_PER_FILE);
});

test("읽을 수 없는 응답은 조용히 넘어가지 않는다", () => {
  assert.throws(() => parseKnowledgeCards("분류하지 못했습니다"));
  assert.throws(() => parseKnowledgeCards(""));
  assert.throws(() => parseKnowledgeCards(JSON.stringify({ cards: "없음" })));
});

test("카드가 하나도 안 나오면 빈 배열", () => {
  // 여기서 터뜨리지 않습니다. 부르는 쪽이 '0장'이라고 알려 주는 편이 낫습니다.
  assert.deepEqual(parseKnowledgeCards(JSON.stringify({ cards: [] })), []);
});

test("화면이 받는 파일만 읽는다", () => {
  assert.equal(importableKind("인터뷰.txt"), "text");
  assert.equal(importableKind("상담기록.docx"), "docx");
  assert.equal(importableKind("메모.MD"), "text");
  assert.equal(importableKind("자료.pdf"), null);
  assert.equal(importableKind("사진.png", "image/png"), null);
  assert.equal(importableKind("이름없음", "text/plain"), "text");
});

test("지시문이 지어내지 말라고 분명히 말한다", () => {
  const prompt = knowledgeImportPrompt("대표 인터뷰 내용");
  assert.match(prompt, /지어내지 않는다/);
  assert.match(prompt, /대표 인터뷰 내용/);
});

test("긴 파일은 잘라서 넘긴다", () => {
  // 안 자르면 요금만 오르고 뒷부분은 어차피 모델이 못 읽습니다.
  const prompt = knowledgeImportPrompt("가".repeat(100_000));
  assert.ok(prompt.length < 60_000, `지시문이 너무 김: ${prompt.length}`);
});
