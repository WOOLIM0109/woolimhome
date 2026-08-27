import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * 가림 판정의 첫 관문인 worker.ps1 의 식별자 정규식을 검사합니다.
 *
 * 이 정규식에 걸린 줄은 글씨 크기나 위치와 상관없이 무조건 가려집니다.
 * 그런데 워커는 PowerShell 이라 이 저장소의 시험이 한 번도 닿지 못했고,
 * 그 사이 '제안사'가 '제안사항'을, '수행사'가 '수행사업'을, '고객사'가
 * '고객사례'를 물어 제안서 본문이 통째로 뿌옇게 나갔습니다.
 *
 * 그래서 워커 파일에서 정규식을 그대로 꺼내 여기서 돌립니다.
 * 워커를 고치면 이 시험도 같이 움직입니다.
 */

const WORKER = readFileSync(
  new URL("../../tools/woolim-pc-worker/worker.ps1", import.meta.url),
  "utf8",
);

/** worker.ps1 의 작은따옴표 문자열에서 정규식 본문만 꺼냅니다. */
function powershellPattern(variableName) {
  const line = WORKER.split("\n").find((candidate) => (
    candidate.trimStart().startsWith(`$${variableName} = '`)
  ));
  assert.ok(line, `worker.ps1 에서 $${variableName} 를 찾지 못했습니다.`);
  const start = line.indexOf("'") + 1;
  const end = line.lastIndexOf("'");
  return line.slice(start, end);
}

/**
 * .NET 정규식을 자바스크립트에서 같은 뜻으로 돌립니다.
 *
 * .NET 의 \b 는 한글도 낱말 문자로 보지만 자바스크립트의 \b 는 ASCII 만 봅니다.
 * 그대로 두면 '갑1234' 같은 자리에서 결과가 갈리므로 유니코드 경계로 바꿉니다.
 */
function toJsRegExp(pattern) {
  const body = pattern.replace(/^\(\?i\)/, "");
  let converted = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "\\" && body[index + 1] === "b") {
      // 여는 경계인지 닫는 경계인지는 바로 뒤 문자로 판단합니다.
      const next = body[index + 2];
      converted += next === "|" || next === ")" || next === undefined
        ? "(?![\\p{L}\\p{N}_])"
        : "(?<![\\p{L}\\p{N}_])";
      index += 1;
      continue;
    }
    if (body[index] === "\\") {
      converted += body[index] + (body[index + 1] ?? "");
      index += 1;
      continue;
    }
    converted += body[index];
  }
  return new RegExp(converted, "iu");
}

const identifierSignal = toJsRegExp(powershellPattern("identifierSignal"));
const numberSignal = toJsRegExp(powershellPattern("numberSignal"));

function looksLikeIdentifier(text) {
  return identifierSignal.test(text) || numberSignal.test(text);
}

test("제안서 본문에 흔한 낱말을 식별자로 오인하지 않는다", () => {
  // 아래 넷은 실제로 가려졌던 문장 모양입니다.
  // '제안사항'·'수행사업'·'고객사례'는 제안서에서 가장 자주 쓰는 낱말입니다.
  const bodyLines = [
    "제안사항 요약",
    "주요 제안사항 및 기대효과",
    "수행사업 실적 (최근 3년)",
    "고객사례 중심의 성과 정리",
    "디자인 시안 3종 @ 2주 일정",
    "폐기물 수거 차량 15대 상시 운영",
    "방수 및 재도장 면적 3,200㎡",
    "청년 참여 확대를 위한 3대 전략",
    "브랜드 컬러 팔레트 및 적용 예시",
    "전화 상담 운영 안내",
  ];
  for (const line of bodyLines) {
    assert.equal(looksLikeIdentifier(line), false, `본문이 가려집니다: ${line}`);
  }
});

test("진짜 식별자는 그대로 가린다", () => {
  const sensitiveLines = [
    "제안사 개요",
    "고객사 현황",
    "수행사 목록",
    "담당자 홍길동",
    "연락처 010-1234-5678",
    "전화번호 02-555-1234",
    "사업명: 전라남도 청년의 날 행사 대행",
    "기관명 한국농업기술진흥원",
    "주식회사 울림컴퍼니",
    "(주)열정거북",
    "www.woolimcompany.kr",
    "hello@woolimcompany.kr",
    "사업자 등록번호 123-45-67890",
    "부산광역시 금정구",
  ];
  for (const line of sensitiveLines) {
    assert.equal(looksLikeIdentifier(line), true, `식별자를 놓칩니다: ${line}`);
  }
});

test("전화번호와 사업자등록번호 모양은 숫자만으로도 잡는다", () => {
  assert.equal(numberSignal.test("010-1234-5678"), true);
  assert.equal(numberSignal.test("02 555 1234"), true);
  assert.equal(numberSignal.test("123-45-67890"), true);
});

test("금액과 수량은 연락처로 보지 않는다", () => {
  const amounts = [
    "총 사업비 250,000,000원",
    "행사 참여 인원 12,000명 규모",
    "2023. 12. 18 제안서 제출",
    "생산 증가 30% 이상 달성",
  ];
  for (const line of amounts) {
    assert.equal(numberSignal.test(line), false, `숫자가 연락처로 잡힙니다: ${line}`);
  }
});
