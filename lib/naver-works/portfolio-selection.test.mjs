import assert from "node:assert/strict";
import test from "node:test";

import {
  metadataEligible,
  projectScore,
  selectPortfolioCandidate,
  sourcePreference,
} from "./portfolio-selection.ts";
import { supportedPortfolioFile } from "./source-file.ts";

/*
 * 2026-08-05 부터 8-26 까지 22 일 동안 포트폴리오가 한 편도 안 나왔습니다.
 * 크론은 매시간 정상으로 돌았고 오류도 0 건이었습니다. 후보도 데이터베이스에
 * 남아 있었습니다. 그런데 아래 네 건이 전부 금지어에 걸려 영구 배제되는 바람에
 * 고를 수 있는 후보가 0 이 됐고, 그 사실을 아무도 기록하지 않았습니다.
 *
 * 아래 경로는 그때 실제로 묶여 있던 파일들입니다.
 */
const STUCK_CANDIDATES = [
  {
    name: "전남청년날_발표자료_편집가능.pptx",
    folder: "완성본_외부공유금지/PPT/입찰 제안서/열정거북_전라남도 청년의 날_입찰제안서_초록,파랑,빨강, 현수막, 카드뉴스, 포스터, 무대디자인",
    size: 80_046_876,
    caught: "카드뉴스 (납품 목록에 적어 둔 말)",
  },
  {
    name: "전남 청년의 날_제안요약서.pptx",
    folder: "완성본_외부공유금지/PPT/입찰 제안서/열정거북_전라남도 청년의 날_입찰제안서_초록,파랑,빨강, 현수막, 카드뉴스, 포스터, 무대디자인",
    size: 19_197_510,
    caught: "카드뉴스 (같은 폴더)",
  },
  {
    name: "커네팅 입찰제안서.pptx",
    folder: "완성본_외부공유금지/PPT/입찰 제안서/커네팅(이승민님)_입찰제안서_초록, 세로형, 연락두절로 초안 바로 넘김",
    size: 13_239_297,
    caught: "세로 (시안 방향 메모)",
  },
  {
    name: "우리페인트_회사소개서_입찰제안용.pptx",
    folder: "완성본_외부공유금지/PPT/입찰 제안서/1억_우리페인트_문현apt 방수 및 재도장 코킹 용역 입찰 선정, 베이지+브라운",
    size: 70_654_579,
    caught: "도장 (재도장 = 페인트를 다시 칠함)",
  },
];

function candidate(input, index = 0) {
  const path = `${input.folder}/${input.name}`;
  return {
    id: `candidate-${index}`,
    project_key: path.toLowerCase(),
    project_name: input.name.replace(/\.(ppt|pptx)$/i, ""),
    quality_score: Math.round(Math.min(95, 45 + Math.min(35, (input.size / 1024 / 1024) * 2)) * 100) / 100,
    status: "candidate",
    naver_works_drive_files: {
      id: `file-${index}`,
      file_name: input.name,
      file_path: path,
      file_extension: input.name.split(".").pop(),
      file_size: input.size,
      root_id: "root",
    },
  };
}

const stuck = STUCK_CANDIDATES.map(candidate);

test("22일 동안 묶여 있던 네 건이 다시 후보로 잡힌다", () => {
  for (const [index, row] of stuck.entries()) {
    assert.equal(
      metadataEligible(row),
      true,
      `${STUCK_CANDIDATES[index].name} 이 후보에서 빠집니다 (걸린 말: ${STUCK_CANDIDATES[index].caught})`,
    );
  }
});

test("금지어에 걸려도 배제하지 않고 순위만 미룬다", () => {
  // 1억짜리 수주 건입니다. 예전에는 -1000 이라 영원히 뽑히지 않았습니다.
  const paint = stuck[3];
  assert.ok(projectScore(paint) > 0, "금지어에 걸린 후보가 여전히 배제됩니다.");

  // 걸리지 않은 같은 급의 파일이 있으면 그쪽이 먼저 뽑혀야 합니다.
  const clean = candidate({
    name: "현대실업_제안서 ppt발표용_포트폴리오용.pptx",
    folder: "완성본_외부공유금지/PPT/입찰 제안서/현대실업_쓰레기,폐기물 입찰제안_부산 금정구, 초록",
    size: 72_564_324,
  }, 99);
  assert.ok(
    projectScore(clean) > projectScore(paint),
    "금지어에 걸린 후보가 깨끗한 후보보다 앞섭니다.",
  );
});

test("후보가 하나라도 있으면 반드시 하나를 고른다", () => {
  const decision = selectPortfolioCandidate(stuck);
  assert.ok(decision.selected, "후보가 넷인데 아무것도 고르지 못했습니다.");
  assert.equal(decision.eligible, 4);
  assert.equal(decision.inspected, 4);
});

test("고르지 못하면 왜 못 골랐는지 남긴다", () => {
  const empty = selectPortfolioCandidate([]);
  assert.equal(empty.selected, null);
  assert.match(empty.reason, /동기화/);

  const wrongFolder = selectPortfolioCandidate([candidate({
    name: "참고자료.pptx",
    folder: "완성본_외부공유금지/레퍼런스/참고자료.pptx",
    size: 1_000_000,
  })]);
  assert.equal(wrongFolder.selected, null);
  assert.equal(wrongFolder.inspected, 1);
  assert.equal(wrongFolder.eligible, 0);
  assert.match(wrongFolder.reason, /승인된 폴더/);
});

test("PDF 는 후보로 잡지 않는다", () => {
  // PDF 는 가림 영역을 만들 수 없어 변환에 성공해도 반드시 되돌아옵니다.
  // 그런데 예전에는 선정 점수가 오히려 PDF 를 우대해서, 한 회차를 통째로
  // 날리고 결과는 0 이 되는 조합이었습니다.
  const pdf = {
    fileName: "회사소개서.pdf",
    filePath: "완성본_외부공유금지/PPT/입찰 제안서/회사소개서.pdf",
  };
  assert.equal(supportedPortfolioFile(pdf), false);

  const pptx = { ...pdf, fileName: "회사소개서.pptx", filePath: pdf.filePath.replace(".pdf", ".pptx") };
  assert.equal(supportedPortfolioFile(pptx), true);
});

test("같은 프로젝트 안에서는 PPTX 를 먼저 쓴다", () => {
  // sourcePreference 와 explorationScore 가 서로 반대로 움직이던 것을 맞췄습니다.
  const pptx = candidate({ name: "제안서.pptx", folder: "완성본_외부공유금지/PPT/A", size: 10_000_000 }, 1);
  const ppt = candidate({ name: "제안서.ppt", folder: "완성본_외부공유금지/PPT/A", size: 10_000_000 }, 2);
  assert.ok(sourcePreference(pptx) > sourcePreference(ppt));
});

test("승인 폴더 밖과 민감 서류는 여전히 뺀다", () => {
  assert.equal(supportedPortfolioFile({
    fileName: "제안서.pptx",
    filePath: "작업중/제안서.pptx",
  }), false);
  assert.equal(supportedPortfolioFile({
    fileName: "인감증명 사본.pptx",
    filePath: "완성본_외부공유금지/PPT/인감증명 사본.pptx",
  }), false);
});
