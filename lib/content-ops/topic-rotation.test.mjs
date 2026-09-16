import assert from "node:assert/strict";
import test from "node:test";
import { CONSULTING_TOPIC_FAMILIES } from "./config.ts";
import {
  DESIGN_TOPIC_FAMILIES,
  familiesForChannel,
  topicRotationRules,
  underusedFamilies,
} from "./topic-rotation.ts";

test("디자인 채널은 디자인 주제군을 받는다", () => {
  /*
   * 컨설팅 목록을 그대로 주면 정책자금·기업인증이 디자인 블로그 후보로 올라옵니다.
   * 채널이 다르면 주제군도 달라야 합니다.
   */
  const design = familiesForChannel("naver_design");
  assert.equal(design, DESIGN_TOPIC_FAMILIES);
  assert.ok(design.includes("제안서·기획서"));
  assert.ok(!design.some((family) => family.includes("정책자금")));
  assert.ok(!design.some((family) => family.includes("인증")));
});

test("주제군이 검색되는 말로 되어 있다", () => {
  /*
   * 처음에는 등록된 출처가 다루는 범위에 맞춰 뽑아서 「정보 구조·도식화」
   * 「접근성·전달력」 같은 이름이었습니다. 아무도 그렇게 검색하지 않습니다.
   * 결과물 종류로 다시 짰습니다.
   */
  assert.ok(DESIGN_TOPIC_FAMILIES.includes("리플렛·전단·팸플릿"));
  assert.ok(DESIGN_TOPIC_FAMILIES.includes("인쇄 규격·재질"));
  assert.ok(DESIGN_TOPIC_FAMILIES.includes("폰트·이미지 저작권"));
});

test("울림이 하지 않는 일은 주제군에 없다", () => {
  // 글을 읽고 문의해도 받을 수 없으면 서로 시간만 씁니다.
  for (const word of ["로고", "CI", "BI", "패키지", "브랜딩"]) {
    assert.ok(
      !DESIGN_TOPIC_FAMILIES.some((family) => family.includes(word)),
      `주제군에 ${word} 가 남아 있습니다.`,
    );
  }
});

test("컨설팅과 홈페이지는 같은 주제군을 받는다", () => {
  assert.equal(familiesForChannel("naver_consulting"), CONSULTING_TOPIC_FAMILIES);
  assert.equal(familiesForChannel("homepage"), CONSULTING_TOPIC_FAMILIES);
});

test("많이 쓴 주제군은 뒤로 밀린다", () => {
  const recent = Array.from({ length: 8 }, () => "정부지원사업·R&D");
  const families = underusedFamilies(recent, CONSULTING_TOPIC_FAMILIES, 6);
  assert.ok(!families.includes("정부지원사업·R&D"));
  assert.equal(families.length, 6);
});

test("한 번도 안 쓴 주제군이 앞에 온다", () => {
  const families = underusedFamilies(["마케팅·영업", "마케팅·영업"], CONSULTING_TOPIC_FAMILIES, 3);
  assert.ok(!families.includes("마케팅·영업"));
});

test("같은 횟수면 오래전에 쓴 쪽이 앞에 온다", () => {
  // recent 는 최신순입니다. 뒤에 있을수록 오래된 글입니다.
  const recent = ["마케팅·영업", ...Array(5).fill(null), "재무·수익구조"];
  const families = underusedFamilies(recent, CONSULTING_TOPIC_FAMILIES, 20);
  assert.ok(
    families.indexOf("재무·수익구조") < families.indexOf("마케팅·영업"),
    "오래전에 쓴 재무가 최근에 쓴 마케팅보다 앞에 와야 함",
  );
});

test("목록에 없는 이름은 세지 않는다", () => {
  /*
   * 옛 글에는 "종합 경영컨설팅" 처럼 목록 밖 이름이 들어 있습니다.
   * 그것까지 세면 실제로 안 쓴 주제군이 쓴 것으로 잘못 잡힙니다.
   */
  const families = underusedFamilies(
    ["종합 경영컨설팅", "기획·디자인", null, undefined],
    CONSULTING_TOPIC_FAMILIES,
    15,
  );
  assert.equal(families.length, CONSULTING_TOPIC_FAMILIES.length);
});

test("글이 하나도 없으면 그냥 목록을 준다", () => {
  const families = underusedFamilies([], DESIGN_TOPIC_FAMILIES, 5);
  assert.equal(families.length, 5);
  families.forEach((family) => assert.ok(DESIGN_TOPIC_FAMILIES.includes(family)));
});

test("지시문이 권고가 아니라 지시로 적힌다", () => {
  // "고르면 좋겠다" 로 적으면 공식 자료가 몰린 쪽으로 다시 쏠립니다.
  const rules = topicRotationRules(["마케팅·영업", "재무·수익구조"]);
  assert.match(rules, /위 목록에서 고른다/);
  assert.match(rules, /서로 달라야 한다/);
  assert.match(rules, /1\. 마케팅·영업/);
});

test("주제군이 없으면 빈 문자열 — 지시문에 빈 칸이 생기지 않게", () => {
  assert.equal(topicRotationRules([]), "");
});
