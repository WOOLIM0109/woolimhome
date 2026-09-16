/**
 * 어느 후보를 이번 회차에 쓸지 정하는 계산만 모았습니다.
 *
 * 이 판정이 22 일 동안 아무것도 고르지 못했는데, 원인을 찾는 데 오래 걸렸습니다.
 * 계산이 데이터베이스를 부르는 파일 안에 섞여 있어서 시험이 닿지 못했기 때문입니다.
 * 여기 있는 함수는 전부 입력만 보고 답을 내므로 시험으로 고정할 수 있습니다.
 * 데이터베이스를 다루는 일은 portfolio-pipeline.ts 가 맡습니다.
 */

import { supportedPortfolioFile } from "./source-file.ts";

export type CandidateRow = {
  id: string;
  project_key: string;
  project_name: string;
  quality_score: number;
  status: string;
  metadata?: Record<string, unknown>;
  naver_works_drive_files:
    | CandidateDriveFile
    | CandidateDriveFile[];
};

export type CandidateDriveFile = {
  id: string;
  file_name: string;
  file_path: string;
  file_extension: string | null;
  file_size: number;
  root_id: string;
  modified_at?: string | null;
};

export type RankedCandidate = {
  id: string;
  confidence: number;
  reasons: string[];
};

/** 실제 디자인 프로젝트일 가능성을 높이는 말. */
export const STRONG_PROJECT_SIGNAL =
  /크몽|포트폴리오|ppt\s*디자인|회사\s*소개서|기업\s*소개서|제품\s*소개서|사업\s*제안서|입찰\s*제안서|투자\s*제안서|ir|브랜딩|리플렛|카탈로그|발표자료/i;

/*
 * 아래 두 목록은 '떨어뜨리는 기준'이 아니라 '순위를 미루는 기준'입니다.
 *
 * 파일명과 폴더명에 그 글자가 들어 있기만 하면 걸리는데, 한국어에는 낱말 경계가
 * 없어서 엉뚱한 말을 뭅니다. 실제로 이런 일이 있었습니다.
 *
 *   · '방수 및 재도장 코킹 용역'  → 인감 '도장' 으로 읽힘
 *   · '현수막, 카드뉴스, 포스터'   → 납품 목록인데 카드뉴스 제작물로 읽힘
 *   · '초록, 세로형, 연락두절'     → 시안 메모인데 세로형 배너로 읽힘
 *
 * 이렇게 걸린 네 건이 전부 영구 배제되어 후보가 0 이 됐고, 그중에는 1 억짜리
 * 입찰을 따낸 회사소개서도 있었습니다. 폴더 이름에 성과를 자세히 적어 둘수록
 * 더 많이 걸리는 구조였습니다.
 */
export const NON_PROJECT_SIGNAL =
  /양식|공고|신청서|모집|제출\s*서류|추가\s*서류|필요\s*서류|보유\s*시|서류\s*pdf|별첨|붙임|증빙|증명서|완납|납세|국세|지방세|등본|사업자\s*등록|4대\s*보험|건강\s*보험|재무\s*제표|제무\s*재표|원천\s*징수|등록증|결정서|특허|신분증|도장|통장|매뉴얼|가이드|보고서\s*양식|통합\s*파일|압축/i;
export const NON_PRESENTATION_FORMAT_SIGNAL =
  /세로|상세\s*페이지|웹\s*홍보|카드\s*뉴스|인스타|sns|배너|스마트\s*스토어/i;

/** 금지어에 걸렸을 때 깎는 점수. 뒤로 미룰 뿐 배제하지는 않습니다. */
export const SIGNAL_PENALTY = 60;

/** 이 점수를 넘긴 후보가 하나라도 있으면 그중에서 고릅니다. */
export const QUALIFIED_SCORE = 55;

export function driveFile(candidate: CandidateRow): CandidateDriveFile | undefined {
  return Array.isArray(candidate.naver_works_drive_files)
    ? candidate.naver_works_drive_files[0]
    : candidate.naver_works_drive_files;
}

function candidateLabel(file: CandidateDriveFile) {
  return `${file.file_path || ""}/${file.file_name}`;
}

export function projectScore(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return -1000;
  const label = candidateLabel(file);
  let score = Number(candidate.quality_score || 0);
  const strongProjectSignal = STRONG_PROJECT_SIGNAL.test(label);
  if (strongProjectSignal) score += 35;
  else score -= 40;
  if (/\.(ppt|pptx)$/i.test(file.file_name)) score += 15;
  if (NON_PROJECT_SIGNAL.test(label)) score -= SIGNAL_PENALTY;
  if (NON_PRESENTATION_FORMAT_SIGNAL.test(label)) score -= SIGNAL_PENALTY;
  if (!supportedPortfolioFile({ fileName: file.file_name, filePath: file.file_path })) score -= 1000;
  return score;
}

/**
 * 후보로 쓸 수 있는 원본인지만 봅니다.
 *
 * 예전에는 여기서 금지어까지 봤습니다. 그런데 후보를 '만드는' 쪽
 * (app/api/admin/naver-works/sync/route.ts)은 금지어를 보지 않습니다.
 * 기준이 서로 달라서, 동기화는 넣어 두지만 이쪽은 영원히 거부하는 후보가
 * 계속 쌓였습니다. 실제로 남아 있던 네 건이 전부 그 상태였습니다.
 *
 * 이제 두 곳이 같은 것만 봅니다. supportedPortfolioFile 안에 민감 문서 검사가
 * 이미 들어 있고, 금지어는 projectScore 에서 순위로만 다룹니다.
 */
export function metadataEligible(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return false;
  return supportedPortfolioFile({ fileName: file.file_name, filePath: file.file_path });
}

/**
 * 같은 프로젝트에 여러 파일이 있을 때 어느 원본을 쓸지 고릅니다.
 *
 * 예전에는 PDF 40 · PPTX 25 로 PDF 를 우대했는데, explorationScore 는 PPTX 에
 * +35 를 줘서 두 함수가 반대로 움직였습니다. PDF 는 가림 영역을 만들 수 없어
 * 어차피 되돌아오므로, 이제 두 곳 모두 PPTX 를 우선합니다.
 */
export function sourcePreference(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return -1000;
  const extension = file.file_name.split(".").pop()?.toLowerCase();
  const format = extension === "pptx" ? 40 : extension === "ppt" ? 25 : 10;
  return format + Math.min(20, Number(file.file_size || 0) / 1024 / 1024);
}

export function explorationScore(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return -1000;
  const label = candidateLabel(file);
  const extension = file.file_name.split(".").pop()?.toLowerCase();
  let score = Number(candidate.quality_score || 0);
  if (extension === "pptx") score += 35;
  else if (extension === "ppt") score += 20;
  score += Math.min(20, Number(file.file_size || 0) / 1024 / 1024);
  if (/발표|제안|소개|사업\s*계획|ir|브랜딩|전략|pitch|proposal/i.test(label)) score += 30;
  if (/초안|draft|참고|백업|old|사본/i.test(label)) score -= 25;
  return score;
}

export function deterministicShortlist(candidates: CandidateRow[]): RankedCandidate[] {
  const projectRanked = [...candidates].sort((a, b) => (
    projectScore(b) - projectScore(a)
    || explorationScore(b) - explorationScore(a)
    || a.id.localeCompare(b.id)
  ));
  const qualified = projectRanked.filter((candidate) => projectScore(candidate) >= QUALIFIED_SCORE);
  const pool = qualified.length
    ? qualified
    : [...candidates].sort((a, b) => (
      explorationScore(b) - explorationScore(a)
      || projectScore(b) - projectScore(a)
      || a.id.localeCompare(b.id)
    ));

  return pool.slice(0, 10).map((candidate, index) => {
    const score = qualified.length ? projectScore(candidate) : explorationScore(candidate);
    return {
      id: candidate.id,
      confidence: Math.max(0.56, Math.min(0.99, score / 100)),
      reasons: qualified.length
        ? ["파일명·경로·형식을 기준으로 실제 디자인 프로젝트 가능성이 높음"]
        : [
          "파일명만으로 확정하지 않고 실제 페이지를 열어 판정할 탐색 후보",
          `결정론적 탐색 순위 ${index + 1}위`,
        ],
    };
  });
}

/**
 * 후보 목록에서 이번에 쓸 하나를 고릅니다. 쓸 수 있는 것이 없으면 null 입니다.
 *
 * 왜 못 골랐는지도 함께 돌려줍니다. 예전에는 그냥 null 만 돌아와서, 후보가 없는
 * 것인지 전부 걸러진 것인지 구분할 수가 없었습니다.
 */
export function selectPortfolioCandidate(rows: CandidateRow[]) {
  const eligible = rows.filter(metadataEligible);
  const shortlist = deterministicShortlist(eligible);
  const first = shortlist[0];
  const originallySelected = first
    ? eligible.find((candidate) => candidate.id === first.id)
    : null;
  const preferredSource = originallySelected
    ? eligible
      .filter((candidate) => candidate.project_key === originallySelected.project_key)
      .sort((a, b) => sourcePreference(b) - sourcePreference(a))[0]
    : null;
  if (!preferredSource || !first) {
    return {
      selected: null,
      shortlist,
      inspected: rows.length,
      eligible: eligible.length,
      reason: rows.length === 0
        ? "대기 중인 후보가 없습니다. 드라이브 동기화가 필요합니다."
        : "후보는 있지만 승인된 폴더의 PPT·PPTX 원본이 하나도 없습니다.",
    } as const;
  }
  return {
    selected: {
      candidate: preferredSource,
      score: Math.round(first.confidence * 100),
      reasons: first.reasons,
    },
    shortlist,
    inspected: rows.length,
    eligible: eligible.length,
    reason: null,
  } as const;
}

/**
 * 후보 준비 결과.
 *
 * 예전에는 성공하면 값을, 실패하면 null 을 돌려줬습니다. 그래서 부르는 쪽이
 * "못 골랐다"와 "왜 못 골랐다"를 구분할 방법이 없었고, 기록을 남길 재료도
 * 없었습니다. 이제 실패에도 이유와 숫자가 함께 옵니다.
 */
export type PortfolioPrepareResult =
  | {
    prepared: false;
    inspected: number;
    eligible: number;
    reason: string;
  }
  | {
    prepared: true;
    inspected: number;
    eligible: number;
    candidateId: string;
    workItemId: string;
    projectName: string;
    score: number;
    shortlistCount: number;
  };
