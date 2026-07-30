import assert from "node:assert/strict";
import test from "node:test";
import {
  assessNovelty,
  contentPlanForRevision,
  fingerprintFromGenerated,
} from "./novelty.ts";

const sources = [
  "https://www.bizinfo.go.kr",
  "https://www.mss.go.kr",
  "https://www.kosmes.or.kr",
  "https://www.k-startup.go.kr",
];

function generated(title, summary, headings, body, tags = []) {
  return {
    title,
    summary,
    bodyHtml: `${headings.map((heading) => `<h2>${heading}</h2>`).join("")}<p>${body}</p>`,
    faq: [
      { question: "무엇을 확인하나요?", answer: "공식 공고를 확인합니다." },
      { question: "언제 준비하나요?", answer: "미리 준비합니다." },
      { question: "도움을 받을 수 있나요?", answer: "상담할 수 있습니다." },
    ],
    tags,
    sourceUrls: sources,
    usedKnowledgeIds: [],
  };
}

test("수정 재생성은 과거 보류 문구 대신 최신 사용자 요청을 주제 계획에 기록한다", () => {
  const plan = {
    topicFamily: "종합 경영컨설팅",
    primaryTopic: "공공조달 시장 진입",
    angle: "중복 검사 보류: 과거 시스템 메시지",
    audience: "중소기업 대표",
    keyEntities: ["공공조달"],
    workingTitle: "공공조달 진입 전략",
    rationale: "과거 기록",
    knowledgeIds: ["knowledge-a"],
  };
  const note = "공공조달 채널을 더 넓게 조사하고 제목을 고쳐 주세요.";
  const revised = contentPlanForRevision(plan, note);
  assert.equal(revised.angle, note);
  assert.match(revised.rationale, /최신 수정 요청/);
  assert.deepEqual(revised.knowledgeIds, ["knowledge-a"]);
});

const july28 = generated(
  "울림컴퍼니가 제안하는 2026년 중소기업 경영 돌파구: 금융·기술·스타트업 원스톱 지원사업 완벽 가이드",
  "금융지원과 이차보전, 스타트업 원스톱 컨설팅, 기술 보호와 수출 판로를 연계합니다.",
  [
    "중소벤처기업부와 기업마당을 활용한 정부지원사업 탐색",
    "기술 탈취 방지와 규제 혁신 소통 창구",
    "스타트업 원스톱 지원센터와 해외 진출 및 판로 연계",
  ],
  "이차보전 정책자금과 1357 상담, 기술탈취 보호, 규제 해소, 수출 판로 지원을 설명합니다.",
);

const july29 = generated(
  "2026년 중소기업 정책자금·이차보전 및 신산업 스타트업 규제 해소 종합 안내",
  "정책자금 이차보전과 신산업 규제 해소, 모두의 창업, 스타트업 원스톱 지원을 안내합니다.",
  [
    "분야별 맞춤형 지원사업",
    "신산업 스타트업 규제 해소와 모두의 창업",
    "스타트업 원스톱 지원센터와 소상공인 안전망",
  ],
  "정책자금과 이차보전, 1357 상담, 규제 해소, 스타트업 원스톱 지원, 수출 판로를 확인합니다.",
);

const july30 = generated(
  "2026년도 우리 기업이 꼭 챙겨야 할 중소벤처기업 정부 지원 사업 핵심 가이드",
  "자금 이차보전, DX와 AX, 글로벌 판로 및 기술탈취 보호와 1357 상담 정보를 정리합니다.",
  [
    "중소기업 지원 정책 흐름과 금융 활용",
    "DX AX 기반 기술 혁신",
    "내수 마케팅과 글로벌 수출 시장 개척",
    "스타트업 원스톱 지원과 기술 보호",
  ],
  "이차보전 정책자금, DX AX, 수출 판로, 규제 해소, 기술탈취 보호와 1357 상담을 설명합니다.",
);

const existing = [july28, july29].map((item, index) => ({
  id: `existing-${index}`,
  title: item.title,
  format: index ? "informational" : "authority",
  fingerprint: fingerprintFromGenerated({ generated: item }),
}));

test("7월 30일 종합 지원사업 초안은 기존 두 글과 중복으로 차단한다", () => {
  const result = assessNovelty({
    candidate: fingerprintFromGenerated({ generated: july30 }),
    existing,
  });
  assert.equal(result.duplicate, true);
  assert.ok(result.matches[0].reasons.includes("같은 제도·사업·핵심어를 반복함"));
});

test("전혀 다른 기업부설연구소 주제는 통과시킨다", () => {
  const distinct = generated(
    "기업부설연구소 설립 전 연구전담요원과 독립공간 확인법",
    "기업부설연구소 인정 요건 중 인적·물적 요건을 점검합니다.",
    ["연구전담요원 자격", "독립 연구공간 기준", "신고 전 서류 점검"],
    "기업부설연구소와 연구개발전담부서의 인력, 공간, 신고 서류를 확인합니다.",
    ["기업부설연구소"],
  );
  const result = assessNovelty({
    candidate: fingerprintFromGenerated({ generated: distinct }),
    existing,
  });
  assert.equal(result.duplicate, false);
});
