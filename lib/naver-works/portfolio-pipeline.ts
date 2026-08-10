import { contentAdmin } from "@/lib/content-ops/data";
import { sensitivePortfolioDocument, supportedPortfolioFile } from "./client";

type CandidateRow = {
  id: string;
  project_key: string;
  project_name: string;
  quality_score: number;
  status: string;
  metadata?: Record<string, unknown>;
  naver_works_drive_files:
    | {
        id: string;
        file_name: string;
        file_path: string;
        file_extension: string | null;
        file_size: number;
        root_id: string;
        modified_at?: string | null;
      }
    | {
        id: string;
        file_name: string;
        file_path: string;
        file_extension: string | null;
        file_size: number;
        root_id: string;
        modified_at?: string | null;
      }[];
};

type RankedCandidate = {
  id: string;
  confidence: number;
  reasons: string[];
};

const STRONG_PROJECT_SIGNAL =
  /크몽|포트폴리오|ppt\s*디자인|회사\s*소개서|기업\s*소개서|제품\s*소개서|사업\s*제안서|입찰\s*제안서|투자\s*제안서|ir|브랜딩|리플렛|카탈로그|발표자료/i;
const NON_PROJECT_SIGNAL =
  /양식|공고|신청서|모집|제출\s*서류|추가\s*서류|필요\s*서류|보유\s*시|서류\s*pdf|별첨|붙임|증빙|증명서|완납|납세|국세|지방세|등본|사업자\s*등록|4대\s*보험|건강\s*보험|재무\s*제표|제무\s*재표|원천\s*징수|등록증|결정서|특허|신분증|도장|통장|매뉴얼|가이드|보고서\s*양식|통합\s*파일|압축/i;
const NON_PRESENTATION_FORMAT_SIGNAL =
  /세로|상세\s*페이지|웹\s*홍보|카드\s*뉴스|인스타|sns|배너|스마트\s*스토어/i;

function driveFile(candidate: CandidateRow) {
  return Array.isArray(candidate.naver_works_drive_files)
    ? candidate.naver_works_drive_files[0]
    : candidate.naver_works_drive_files;
}

function projectScore(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return -1000;
  const label = `${file.file_path || ""}/${file.file_name}`;
  let score = Number(candidate.quality_score || 0);
  const strongProjectSignal = STRONG_PROJECT_SIGNAL.test(label);
  if (strongProjectSignal) score += 35;
  else score -= 40;
  if (/\.pdf$/i.test(file.file_name) && strongProjectSignal) score += 30;
  if (/\.(ppt|pptx)$/i.test(file.file_name)) score += 15;
  if (NON_PROJECT_SIGNAL.test(label)) score -= 60;
  if (NON_PRESENTATION_FORMAT_SIGNAL.test(label)) score -= 1000;
  if (!supportedPortfolioFile({ fileName: file.file_name, filePath: file.file_path })) score -= 1000;
  return score;
}

function metadataEligible(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return false;
  const label = `${file.file_path || ""}/${file.file_name}`;
  return supportedPortfolioFile({ fileName: file.file_name, filePath: file.file_path })
    && !NON_PROJECT_SIGNAL.test(label)
    && !NON_PRESENTATION_FORMAT_SIGNAL.test(label)
    && !sensitivePortfolioDocument({ fileName: file.file_name, filePath: file.file_path });
}

function sourcePreference(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return -1000;
  const extension = file.file_name.split(".").pop()?.toLowerCase();
  const format = extension === "pdf" ? 40 : extension === "pptx" ? 25 : 10;
  return format + Math.min(20, Number(file.file_size || 0) / 1024 / 1024);
}

function explorationScore(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return -1000;
  const label = `${file.file_path || ""}/${file.file_name}`;
  const extension = file.file_name.split(".").pop()?.toLowerCase();
  let score = Number(candidate.quality_score || 0);
  if (extension === "pptx") score += 35;
  else if (extension === "ppt") score += 20;
  score += Math.min(20, Number(file.file_size || 0) / 1024 / 1024);
  if (/발표|제안|소개|사업\s*계획|ir|브랜딩|전략|pitch|proposal/i.test(label)) score += 30;
  if (/초안|draft|참고|백업|old|사본/i.test(label)) score -= 25;
  return score;
}

function deterministicShortlist(candidates: CandidateRow[]): RankedCandidate[] {
  const projectRanked = [...candidates].sort((a, b) => (
    projectScore(b) - projectScore(a)
    || explorationScore(b) - explorationScore(a)
    || a.id.localeCompare(b.id)
  ));
  const qualified = projectRanked.filter((candidate) => projectScore(candidate) >= 55);
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

export async function prepareNextPortfolioCandidate(options: {
  scheduleKey?: string;
  scheduledAt?: string;
} = {}) {
  const admin = contentAdmin();
  const { data, error } = await admin.from("portfolio_candidates")
    .select(`
      id,project_key,project_name,quality_score,status,metadata,
      naver_works_drive_files!inner(id,file_name,file_path,file_extension,file_size,root_id,modified_at)
    `)
    .eq("status", "candidate")
    .limit(500);
  if (error) throw new Error(error.message);

  const candidates = ((data || []) as CandidateRow[])
    .filter(metadataEligible)
    .sort((a, b) => projectScore(b) - projectScore(a));
  const shortlist = deterministicShortlist(candidates);

  const first = shortlist[0];
  const originallySelected = first
    ? candidates.find((candidate) => candidate.id === first.id)
    : null;
  const preferredSource = originallySelected
    ? candidates
      .filter((candidate) => candidate.project_key === originallySelected.project_key)
      .sort((a, b) => sourcePreference(b) - sourcePreference(a))[0]
    : null;
  const selected = preferredSource
    ? {
      candidate: preferredSource,
      score: Math.round(first.confidence * 100),
      reasons: first.reasons,
    }
    : null;
  if (!selected) return null;

  const candidate = selected.candidate;
  const file = driveFile(candidate);
  if (!file) return null;
  const scheduleKey = options.scheduleKey || `naver-works-portfolio-${candidate.id}`;

  const { data: workItem, error: workError } = await admin.from("content_work_items").upsert({
    channel: "naver_design",
    format: "portfolio",
    title: candidate.project_name,
    summary: "NAVER WORKS에서 1차 선별한 디자인 프로젝트입니다. 실제 페이지 판정, 민감정보 처리, 목업 합성, 본문 작성을 순서대로 진행합니다.",
    status: "researching",
    source_label: "NAVER WORKS 공용 폴더",
    source_reference: file.file_path || file.file_name,
    scheduled_at: options.scheduledAt || null,
    schedule_key: scheduleKey,
    created_by: "automation@woolimcompany.kr",
    metadata: {
      candidateId: candidate.id,
      driveFileId: file.id,
      sourceFileName: file.file_name,
      sourcePath: file.file_path,
      pipeline: ["download", "convert", "font_check", "privacy_check", "mockup", "draft"],
      selectionScore: selected.score,
      selectionReasons: selected.reasons,
      shortlist: shortlist.map((item) => ({
        candidateId: item.id,
        confidence: item.confidence,
        reasons: item.reasons,
      })),
      automated: true,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "schedule_key" }).select("id").single();
  if (workError) throw new Error(workError.message);

  const { error: candidateError } = await admin.from("portfolio_candidates").update({
    status: "selected",
    quality_score: Math.min(99, selected.score),
    selection_reasons: selected.reasons.length
      ? selected.reasons
      : ["파일명·경로 기준 1차 후보 선별", "실제 페이지 시각 판정 대기"],
    metadata: {
      ...(candidate.metadata || {}),
      workItemId: workItem.id,
      selectedAt: new Date().toISOString(),
      selectionScore: selected.score,
      shortlist,
    },
    updated_at: new Date().toISOString(),
  }).eq("id", candidate.id);
  if (candidateError) throw new Error(candidateError.message);

  const steps = ["download", "convert", "font_check", "privacy_check", "mockup", "draft"] as const;
  const { data: existingJobs, error: existingError } = await admin.from("content_jobs")
    .select("job_type")
    .eq("candidate_id", candidate.id);
  if (existingError) throw new Error(existingError.message);
  const existing = new Set((existingJobs || []).map((job) => job.job_type));
  const jobs = steps.filter((step) => !existing.has(step)).map((step, index) => ({
    candidate_id: candidate.id,
    work_item_id: workItem.id,
    job_type: step,
    status: index === 0 ? "queued" : "on_hold",
    payload: {
      stepOrder: index + 1,
      waitsFor: index ? steps[index - 1] : null,
      driveFileId: file.id,
    },
  }));
  if (jobs.length) {
    const { error: jobsError } = await admin.from("content_jobs").insert(jobs);
    if (jobsError) throw new Error(jobsError.message);
  }

  return {
    candidateId: candidate.id,
    workItemId: workItem.id,
    projectName: candidate.project_name,
    score: selected.score,
    shortlistCount: shortlist.length,
  };
}
