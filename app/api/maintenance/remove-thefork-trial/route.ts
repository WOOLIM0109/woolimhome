import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_ID = "c92341fc-27be-4339-ac38-7d949f4b62a9";
const TARGET_SCHEDULE_KEY = "portfolio-pipeline-review-20260728-v2";
const ONE_TIME_DELETE_KEY = "tf-delete-2f7e10cc-34e5-4e2e-90b4-303328c5833e";

function storageReference(value: string) {
  const url = new URL(value, "https://woolim-site.vercel.app");
  const bucket = url.searchParams.get("bucket");
  const path = url.searchParams.get("path");
  return bucket && path ? { bucket, path } : null;
}

export async function POST(request: Request) {
  if (request.headers.get("x-one-time-delete-key") !== ONE_TIME_DELETE_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: workItem, error: workItemError } = await admin.from("content_work_items")
    .select("id,title,status,schedule_key")
    .eq("id", TARGET_ID)
    .eq("schedule_key", TARGET_SCHEDULE_KEY)
    .maybeSingle();
  if (workItemError) {
    return NextResponse.json({ error: workItemError.message }, { status: 500 });
  }
  if (!workItem) {
    return NextResponse.json({ success: true, alreadyRemoved: true });
  }

  const { data: assets, error: assetsError } = await admin.from("content_review_assets")
    .select("public_url")
    .eq("work_item_id", TARGET_ID);
  if (assetsError) {
    return NextResponse.json({ error: assetsError.message }, { status: 500 });
  }

  const pathsByBucket = new Map<string, Set<string>>();
  for (const asset of assets || []) {
    const reference = storageReference(asset.public_url);
    if (!reference) continue;
    const paths = pathsByBucket.get(reference.bucket) || new Set<string>();
    paths.add(reference.path);
    pathsByBucket.set(reference.bucket, paths);
  }
  for (const [bucket, paths] of pathsByBucket) {
    const { error } = await admin.storage.from(bucket).remove([...paths]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { count: deletedJobs, error: jobsError } = await admin.from("content_jobs")
    .delete({ count: "exact" })
    .eq("work_item_id", TARGET_ID);
  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  const { error: deleteError } = await admin.from("content_work_items")
    .delete()
    .eq("id", TARGET_ID)
    .eq("schedule_key", TARGET_SCHEDULE_KEY);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    removed: {
      id: workItem.id,
      title: workItem.title,
      status: workItem.status,
      assetCount: assets?.length || 0,
      jobCount: deletedJobs || 0,
    },
  });
}
