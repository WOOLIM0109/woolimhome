import { contentAdmin } from "@/lib/content-ops/data";
import { generateGeminiJson } from "@/lib/portfolio/gemini";
import { fetchExistingDesignBlogTitles } from "@/lib/portfolio/naver-blog";
import { sensitivePortfolioDocument } from "./client";

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

type AiRankedCandidate = {
  id: string;
  confidence: number;
  reasons: string[];
};

const STRONG_PROJECT_SIGNAL =
  /크몽|포트폴리오|ppt\s*디자인|회사\s*소개서|기업\s*소개서|제품\s*소개서|사업\s*제안서|입찰\s*제안서|투자\s*제안서|ir|브랜딩|리플렛|카탈로그|발표자료/i;
const NON_PROJECT_SIGNAL =
  /양식|공고|신청서|모집|제출\s*서류|추가\s*서류|필요\s*서류|보유\s*시|서류\s*pdf|별첨|붙임|증빙|증명서|완납|납세|국세|지방세|등본|사업자\s*등록|4대\s*보험|건강\s*보험|재무\s*제표|원천\s*징수|등록증|결정서|특허|신분증|도장|통장|매뉴얼|가이드|보고서\s*양식|통합\s*파일|압축/i;
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
  if (sensitivePortfolioDocument({ fileName: file.file_name, filePath: file.file_path })) score -= 1000;
  return score;
}

function metadataEligible(candidate: CandidateRow) {
  const file = driveFile(candidate);
  if (!file) return false;
  const label = `${file.file_path || ""}/${file.file_name}`;
  return !NON_PROJECT_SIGNAL.test(label)
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

async function aiShortlist(candidates: CandidateRow[]) {
  if (!candidates.length) return [] as AiRankedCandidate[];
  const existingBlogTitles = await fetchExistingDesignBlogTitles();
  const input = candidates.slice(0, 80).map((candidate) => {
    const file = driveFile(candidate)!;
    return {
      id: candidate.id,
      projectKey: candidate.project_key,
      name: file.file_name,
      path: file.file_path,
      extension: file.file_extension,
      sizeMb: Math.round((Number(file.file_size || 0) / 1024 / 1024) * 10) / 10,
      baseScore: Math.round(projectScore(candidate)),
    };
  });
  const result = await generateGeminiJson<{ candidates: AiRankedCandidate[] }>([
    {
      text: `당신은 디자인 에이전시의 프로젝트 자료 선별자입니다.
다음 목록은 NAVER WORKS Drive에서 찾은 PPT·PPTX·PDF입니다. 파일을 열기 전에 이름·경로·용량만 보고, 실제로 완성된 비즈니스 문서 디자인 프로젝트일 가능성이 높은 항목 5~10개를 순서대로 고르세요.

우선순위:
- 회사소개서, 제품소개서, 제안서, IR, 사업계획서, 발표자료처럼 디자인과 기획 구조를 보여줄 수 있는 완성 문서
- 같은 프로젝트라면 PDF를 우선해 원본 폰트와 레이아웃을 보존
- 5페이지 이상일 가능성이 높고, 포트폴리오에서 설명할 서로 다른 장면이 예상되는 자료

제외:
- 신청서, 공고, 양식, 증빙, 별첨, 제출서류, 통합 압축, 업무용 내부문서
- 세로형 웹 상세페이지·카드뉴스·배너를 PPT에 단순히 담은 파일
- 파일명과 경로만으로 프로젝트일 가능성이 낮은 자료
- 아래 기존 디자인 블로그 제목과 같은 프로젝트로 보이는 자료

기존 디자인 블로그 최근 제목:
${JSON.stringify(existingBlogTitles)}

여기서는 최종 승인하지 않습니다. 선택된 파일은 다음 단계에서 실제 페이지를 보고 다시 엄격히 판정합니다.
목록이 비어 있지 않다면 확신이 낮더라도 상대적으로 가능성이 높은 탐색 후보를 최소 5개는 반환하세요. 빈 배열을 반환하지 마세요.
반드시 JSON만 반환하세요:
{"candidates":[{"id":"목록의 id","confidence":0.0,"reasons":["선정 이유"]}]}

목록:
${JSON.stringify(input)}`,
    },
  ], { maxOutputTokens: 4000 });
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  return (result.candidates || [])
    .filter((candidate) => allowed.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence || 0))),
      reasons: (candidate.reasons || []).map(String).slice(0, 4),
    }))
    .filter((candidate) => candidate.confidence >= 0.55)
    .slice(0, 10);
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
  let shortlist: AiRankedCandidate[] = [];
  try {
    shortlist = await aiShortlist(candidates);
  } catch {
    shortlist = candidates
      .filter((candidate) => projectScore(candidate) >= 55)
      .slice(0, 10)
      .map((candidate) => ({
        id: candidate.id,
        confidence: Math.min(0.9, projectScore(candidate) / 100),
        reasons: ["파일명·경로·형식을 기준으로 실제 디자인 프로젝트 가능성이 높음"],
      }));
  }
  if (!shortlist.length) {
    shortlist = candidates
      .sort((a, b) => explorationScore(b) - explorationScore(a))
      .slice(0, 10)
      .map((candidate, index) => ({
        id: candidate.id,
        confidence: Math.max(0.56, 0.65 - index * 0.01),
        reasons: [
          "파일명만으로 확정하지 않고 실제 페이지를 열어 판정할 탐색 후보",
          "명백한 신청서·양식·세로형 홍보물 제외 기준 통과",
        ],
      }));
  }

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
