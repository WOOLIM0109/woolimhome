import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { cancellationMarker } from "@/lib/content-ops/cancellation";
import { parseStoredAssetUrl } from "@/lib/partner-portal";

export const dynamic = "force-dynamic";

type CancelKind = "portfolio" | "design_insight";

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value);
}

function storageLocations(value: unknown) {
  if (!value || typeof value !== "object") return [] as { bucket: string; path: string }[];
  const record = value as Record<string, unknown>;
  const bucket = typeof record.bucket === "string"
    ? record.bucket
    : typeof record.renderedBucket === "string"
      ? record.renderedBucket
      : typeof record.sourceBucket === "string"
        ? record.sourceBucket
        : "";
  const paths = [
    record.storagePath,
    record.renderedPath,
    record.sourcePath,
    ...(Array.isArray(record.slidePaths) ? record.slidePaths : []),
  ].filter((path): path is string => typeof path === "string" && Boolean(path));
  return bucket ? paths.map((path) => ({ bucket, path })) : [];
}

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const requestId = body.requestId;
  const kind: CancelKind = body.kind === "portfolio" ? "portfolio" : "design_insight";
  if (!validRequestId(requestId)) {
    return NextResponse.json({ error: "취소할 생성 요청 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const admin = contentAdmin();
  const scheduleKey = kind === "portfolio"
    ? `manual-portfolio-${requestId}`
    : `manual-design-${requestId}`;
  const marker = cancellationMarker(requestId);
  const { data: existing, error: readError } = await admin
    .from("content_work_items")
    .select("id, metadata")
    .eq("schedule_key", scheduleKey)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  let workItemId = existing?.id;
  if (existing) {
    const metadata = existing.metadata && typeof existing.metadata === "object"
      ? existing.metadata
      : {};
    const { error } = await admin
      .from("content_work_items")
      .update({
        status: "on_hold",
        review_note: marker,
        metadata: { ...metadata, cancelRequested: true, cancelledAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await admin
      .from("content_work_items")
      .insert({
        channel: "naver_design",
        format: kind,
        title: "취소된 초안 생성 요청",
        summary: "",
        status: "on_hold",
        schedule_key: scheduleKey,
        review_note: marker,
        metadata: {
          manual: true,
          manualRequestId: requestId,
          cancelRequested: true,
          cancelledAt: new Date().toISOString(),
        },
        created_by: user.email,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    workItemId = data.id;
  }

  const { data: jobs, error: jobsError } = await admin
    .from("content_jobs")
    .select("candidate_id, payload, result")
    .eq("work_item_id", workItemId);
  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 });

  const candidateIds = [...new Set(
    (jobs || []).map((job) => job.candidate_id).filter((value): value is string => Boolean(value)),
  )];
  if (candidateIds.length) {
    const { data: candidates, error: candidatesError } = await admin
      .from("portfolio_candidates")
      .select("id, metadata")
      .in("id", candidateIds);
    if (candidatesError) return NextResponse.json({ error: candidatesError.message }, { status: 500 });

    for (const candidate of candidates || []) {
      const metadata = candidate.metadata && typeof candidate.metadata === "object"
        ? { ...candidate.metadata }
        : {};
      delete metadata.workItemId;
      delete metadata.selectedAt;
      const { error } = await admin
        .from("portfolio_candidates")
        .update({
          status: "candidate",
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data: assets, error: assetsError } = await admin
    .from("content_review_assets")
    .select("public_url")
    .eq("work_item_id", workItemId);
  if (assetsError) return NextResponse.json({ error: assetsError.message }, { status: 500 });

  const locations = [
    ...(jobs || []).flatMap((job) => [
      ...storageLocations(job.payload),
      ...storageLocations(job.result),
    ]),
    ...(assets || [])
      .map((asset) => parseStoredAssetUrl(asset.public_url))
      .filter((asset): asset is { bucket: string; path: string } => Boolean(asset)),
  ];

  await admin.from("content_jobs").delete().eq("work_item_id", workItemId);
  await admin.from("content_review_assets").delete().eq("work_item_id", workItemId);

  for (const bucket of [...new Set(locations.map((location) => location.bucket))]) {
    const paths = [...new Set(
      locations.filter((location) => location.bucket === bucket).map((location) => location.path),
    )];
    if (paths.length) await admin.storage.from(bucket).remove(paths);
  }

  return NextResponse.json({
    cancelled: true,
    requestId,
    kind,
  });
}

