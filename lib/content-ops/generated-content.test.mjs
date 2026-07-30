import assert from "node:assert/strict";
import test from "node:test";
import {
  editorialRevisionNote,
  metadataAfterSuccessfulRevision,
  parseGeneratedContent,
  pendingRevisionNote,
  resolveRevisionNote,
  revisionKnowledgeIds,
} from "./generated-content.ts";

const valid = {
  title: "제목",
  summary: "요약",
  bodyHtml: "<h2>본문</h2><p>내용</p>",
  faq: [{ question: "질문?", answer: "답변" }],
  tags: ["기획"],
  sourceUrls: ["https://example.com"],
  usedKnowledgeIds: [],
};

test("코드 펜스와 앞뒤 설명이 있어도 JSON 객체를 읽는다", () => {
  const parsed = parseGeneratedContent(`설명\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n끝`);
  assert.deepEqual(parsed, valid);
});

test("문법이 깨진 JSON은 성공으로 처리하지 않는다", () => {
  assert.throws(
    () => parseGeneratedContent('{"title":"제목" "summary":"요약"}'),
    /JSON|Expected/,
  );
});

test("기술 오류 메시지는 수정 지시문으로 재사용하지 않는다", () => {
  assert.equal(
    editorialRevisionNote("Expected ',' or '}' after property value in JSON at position 4842"),
    null,
  );
  assert.equal(
    editorialRevisionNote("첫 문단을 더 친근하게 바꾸고 실제 사례를 강조해 주세요."),
    "첫 문단을 더 친근하게 바꾸고 실제 사례를 강조해 주세요.",
  );
  assert.equal(
    editorialRevisionNote("중복 검사 보류: 울림 원천자료를 중심으로 한 차별화 주제 후보가 없습니다."),
    null,
  );
  assert.equal(
    editorialRevisionNote("원천자료 확인 보류: 승인된 원천자료가 없습니다."),
    null,
  );
});

test("기술 오류가 현재 메모를 덮어도 보존된 수정 요청을 복구한다", () => {
  const metadata = {
    pendingRevision: {
      note: "첫 문단의 표현을 대표님 실제 말투에 가깝게 고쳐 주세요.",
      requestedAt: "2026-07-30T01:00:00.000Z",
    },
  };
  assert.equal(
    resolveRevisionNote(undefined, "자동 재생성 보류: 원천자료가 없습니다.", metadata),
    metadata.pendingRevision.note,
  );
  assert.equal(pendingRevisionNote(metadata), metadata.pendingRevision.note);
});

test("새로 입력한 수정 요청은 이전 보존 요청보다 우선한다", () => {
  assert.equal(
    resolveRevisionNote(
      "성과 수치를 본문에 반영해 주세요.",
      "기존 요청",
      { pendingRevision: { note: "더 오래된 요청" } },
    ),
    "성과 수치를 본문에 반영해 주세요.",
  );
});

test("기존 초안과 주제 계획이 사용한 원천자료를 중복 없이 고정한다", () => {
  assert.deepEqual(revisionKnowledgeIds({
    generated: { usedKnowledgeIds: ["knowledge-a", "knowledge-b"] },
    novelty: { plan: { knowledgeIds: ["knowledge-b", "knowledge-c"] } },
  }), ["knowledge-a", "knowledge-b", "knowledge-c"]);
});

test("수정에 성공한 뒤에만 보존 요청을 제거한다", () => {
  const metadata = {
    pendingRevision: { note: "요청" },
    generated: { title: "기존 글" },
  };
  assert.deepEqual(metadataAfterSuccessfulRevision(metadata), {
    generated: { title: "기존 글" },
  });
  assert.equal(metadata.pendingRevision.note, "요청");
});
