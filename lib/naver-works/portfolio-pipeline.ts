import { contentAdmin } from "@/lib/content-ops/data";
import { sensitivePortfolioDocument } from "./client";

type CandidateRow = {
  id: string;
  project_name: string;
  quality_score: number;
  status: string;
  naver_works_drive_files:
    | {
        id: string;
        file_name: string;
        file_path: string;
        file_extension: string | null;
        file_size: number;
        root_id: string;
      }
    | {
        id: string;
        file_name: string;
        file_path: string;
        file_extension: string | null;
        file_size: number;
        root_id: string;
      }[];
};

const STRONG_PROJECT_SIGNAL =
  /크몽|포트폴리오|ppt\s*디자인|회사\s*소개서|기업\s*소개서|제품\s*소개서|사업\s*제안서|입찰\s*제안서|투자\s*제안서|ir|브랜딩|리플렛|카탈로그/i;
const NON_PROJECT_SIGNAL =
  /양식|공고|신청서|모집|제출\s*서류|추가\s*서류|별첨|붙임|증빙|매뉴얼|가이드|보고서\s*양식|통합\s*파일|압축/i;
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

export async function prepareNextPortfolioCandidate() {
  const admin = contentAdmin();
  const { data, error } = await admin.from("portfolio_candidates")
    .select(`
      id,project_name,quality_score,status,
      naver_works_drive_files!inner(id,file_name,file_path,file_extension,file_size,root_id)
    `)
    .eq("status", "candidate")
    .limit(500);
  if (error) throw new Error(error.message);

  const ranked = ((data || []) as CandidateRow[])
    .map((candidate) => ({ candidate, score: projectScore(candidate) }))
    .filter(({ score }) => score >= 70)
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  if (!selected) return null;

  const candidate = selected.candidate;
  const file = driveFile(candidate);
  if (!file) return null;
  const scheduleKey = `naver-works-portfolio-${candidate.id}`;

  const { data: workItem, error: workError } = await admin.from("content_work_items").upsert({
    channel: "naver_design",
    format: "portfolio",
    title: candidate.project_name,
    summary: "NAVER WORKS에서 자동 선별한 디자인 프로젝트입니다. 원본 변환과 개인정보 검사 후 이미지가 배치된 비공개 초안으로 이동합니다.",
    status: "researching",
    source_label: "NAVER WORKS 공용 폴더",
    source_reference: file.file_path || file.file_name,
    schedule_key: scheduleKey,
    created_by: "automation@woolimcompany.kr",
    metadata: {
      candidateId: candidate.id,
      driveFileId: file.id,
      sourceFileName: file.file_name,
      sourcePath: file.file_path,
      pipeline: ["download", "convert", "font_check", "privacy_check", "mockup", "draft"],
      selectionScore: selected.score,
      automated: true,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "schedule_key" }).select("id").single();
  if (workError) throw new Error(workError.message);

  const { error: candidateError } = await admin.from("portfolio_candidates").update({
    status: "selected",
    quality_score: Math.min(99, selected.score),
    selection_reasons: [
      "디자인 프로젝트를 나타내는 파일명·폴더 신호 확인",
      "PPT·PPTX·PDF 원본 파일 확인",
      "민감 서류명 자동 제외 기준 통과",
    ],
    metadata: {
      workItemId: workItem.id,
      selectedAt: new Date().toISOString(),
      selectionScore: selected.score,
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
  };
}
