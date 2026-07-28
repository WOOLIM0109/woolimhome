import { contentAdmin } from "@/lib/content-ops/data";

const MAX_DOWNLOAD_ATTEMPTS = 5;
const SIZE_EXCLUSION_CODE = "source_too_large";

type CandidateMetadata = Record<string, unknown>;

export async function restorePcEligibleOversizedCandidates() {
  const admin = contentAdmin();
  const { data: candidates, error } = await admin.from("portfolio_candidates")
    .select("id,drive_file_id,metadata,exclusion_reasons")
    .eq("status", "excluded")
    .contains("metadata", { exclusionCode: SIZE_EXCLUSION_CODE })
    .limit(100);
  if (error) throw new Error(error.message);

  let restored = 0;
  for (const candidate of candidates || []) {
    const now = new Date().toISOString();
    const metadata = { ...((candidate.metadata || {}) as CandidateMetadata) };
    delete metadata.exclusionCode;
    delete metadata.excludedAt;
    delete metadata.sourceFileSizeLimit;

    const { data: jobs, error: jobsError } = await admin.from("content_jobs")
      .select("work_item_id,job_type")
      .eq("candidate_id", candidate.id);
    if (jobsError) throw new Error(jobsError.message);
    const workItemId = jobs?.find((job) => job.job_type === "download")?.work_item_id;

    const results = await Promise.all([
      admin.from("portfolio_candidates").update({
        status: "candidate",
        exclusion_reasons: (candidate.exclusion_reasons || [])
          .map(String)
          .filter((reason: string) => !/용량|size/i.test(reason)),
        metadata: {
          ...metadata,
          restoredForPcAt: now,
          sourceDelivery: "pc_direct",
        },
        updated_at: now,
      }).eq("id", candidate.id),
      admin.from("naver_works_drive_files").update({
        sync_status: "indexed",
        updated_at: now,
      }).eq("id", candidate.drive_file_id),
      admin.from("content_jobs").update({
        status: "queued",
        attempts: 0,
        started_at: null,
        completed_at: null,
        error_message: null,
        result: {},
        updated_at: now,
      }).eq("candidate_id", candidate.id).eq("job_type", "download"),
      admin.from("content_jobs").update({
        status: "on_hold",
        attempts: 0,
        started_at: null,
        completed_at: null,
        error_message: null,
        result: {},
        updated_at: now,
      }).eq("candidate_id", candidate.id)
        .neq("job_type", "download")
        .neq("status", "completed"),
      workItemId
        ? admin.from("content_work_items").update({
          status: "on_hold",
          summary: "용량과 관계없이 회사 PC가 NAVER WORKS 원본을 직접 내려받아 변환하도록 다시 등록했습니다.",
          review_note: null,
          updated_at: now,
        }).eq("id", workItemId)
        : Promise.resolve({ error: null }),
    ]);
    const failedUpdate = results.find((result) => result.error);
    if (failedUpdate?.error) throw new Error(failedUpdate.error.message);
    restored += 1;
  }
  return restored;
}

export async function processNextPortfolioDownload(candidateId?: string) {
  const admin = contentAdmin();
  let query = admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,attempts")
    .eq("job_type", "download")
    .in("status", ["queued", "failed"])
    .lt("attempts", MAX_DOWNLOAD_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(1);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  const { data: jobs, error: jobError } = await query;
  if (jobError) throw new Error(jobError.message);
  const job = jobs?.[0];
  if (!job) return null;

  const startedAt = new Date().toISOString();
  await admin.from("content_jobs").update({
    status: "running",
    attempts: Number(job.attempts || 0) + 1,
    started_at: startedAt,
    completed_at: null,
    error_message: null,
    updated_at: startedAt,
  }).eq("id", job.id);

  try {
    const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates")
      .select("drive_file_id")
      .eq("id", job.candidate_id)
      .single();
    if (candidateError) throw new Error(candidateError.message);
    const { data: file, error: fileError } = await admin.from("naver_works_drive_files")
      .select("id,root_id,file_name,file_size,file_extension")
      .eq("id", candidate.drive_file_id)
      .single();
    if (fileError) throw new Error(fileError.message);
    const extension = String(file.file_extension || file.file_name.split(".").pop() || "").toLowerCase();
    if (!["ppt", "pptx", "pptm", "pdf"].includes(extension)) {
      throw new Error("회사 PC에서 처리할 수 없는 문서 형식입니다.");
    }
    const { data: root, error: rootError } = await admin.from("naver_works_drive_roots")
      .select("drive_type,external_drive_id")
      .eq("id", file.root_id)
      .single();
    if (rootError) throw new Error(rootError.message);
    if (root.drive_type !== "shared_drive" || !root.external_drive_id) {
      throw new Error("현재 PC 직접 다운로드는 NAVER WORKS 공용 폴더 원본만 지원합니다.");
    }

    const completedAt = new Date().toISOString();
    const results = await Promise.all([
      admin.from("content_jobs").update({
        status: "completed",
        completed_at: completedAt,
        error_message: null,
        result: {
          delivery: "pc_direct",
          originalFileName: file.file_name,
          driveFileId: file.id,
          byteLength: Number(file.file_size || 0),
        },
        updated_at: completedAt,
      }).eq("id", job.id),
      admin.from("content_jobs").update({
        status: "pc_waiting",
        attempts: 0,
        started_at: null,
        completed_at: null,
        error_message: null,
        result: {},
        payload: {
          waitsFor: "download",
          sourceDelivery: "naver_works_proxy",
          driveFileId: file.id,
        },
        updated_at: completedAt,
      }).eq("candidate_id", job.candidate_id)
        .eq("job_type", "convert")
        .in("status", ["on_hold", "queued", "failed", "running", "pc_waiting"]),
      admin.from("portfolio_candidates").update({
        status: "on_hold",
        updated_at: completedAt,
      }).eq("id", job.candidate_id),
      admin.from("naver_works_drive_files").update({
        sync_status: "queued",
        updated_at: completedAt,
      }).eq("id", file.id),
      admin.from("content_work_items").update({
        status: "researching",
        summary: "회사 PC가 NAVER WORKS 원본을 직접 내려받아 글꼴과 페이지 구성을 유지한 이미지로 변환할 예정입니다.",
        review_note: null,
        updated_at: completedAt,
      }).eq("id", job.work_item_id),
    ]);
    const failedUpdate = results.find((result) => result.error);
    if (failedUpdate?.error) throw new Error(failedUpdate.error.message);

    return {
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      status: "pc_waiting" as const,
      originalFileName: file.file_name,
      byteLength: Number(file.file_size || 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PC 직접 처리 준비 실패";
    const failedAt = new Date().toISOString();
    await admin.from("content_jobs").update({
      status: "failed",
      error_message: message,
      completed_at: failedAt,
      updated_at: failedAt,
    }).eq("id", job.id);
    await admin.from("content_work_items").update({
      status: "on_hold",
      review_note: `PC 직접 처리 준비 보류: ${message}`,
      updated_at: failedAt,
    }).eq("id", job.work_item_id);
    throw error;
  }
}
