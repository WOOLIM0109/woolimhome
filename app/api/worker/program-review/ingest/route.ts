import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import {
  IngestError,
  ingestPrograms,
  parseIngestBody,
} from "@/lib/program-review/worker-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 대표 PC 수집기가 공고를 올리는 통로입니다.
 *
 * 포트폴리오 목업과 같은 워커 인증을 씁니다 (`x-woolim-worker-id` + Bearer).
 * 하는 일과 지키는 선은 `lib/program-review/worker-ingest.ts` 주석에 적혀 있습니다.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;

  try {
    const payload = parseIngestBody(body);
    const result = await ingestPrograms(payload, { admin: createAdminClient() });
    return NextResponse.json(
      { worker: authentication.worker.id, ...result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof IngestError) {
      // 어디가 틀렸는지 알려 줍니다. 조용히 깨지면 수집기가 계속 틀린 것을 보냅니다.
      return NextResponse.json(
        { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
        { status: error.status, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    // 흔적을 남깁니다. 로그가 없으면 운영에서 원인을 알 수 없습니다.
    // 응답에는 내보내지 않습니다 (안쪽 사정이 밖으로 나가면 안 됩니다).
    console.error("[program-ingest] 실패:",
      error instanceof Error ? error.message.slice(0, 300) : "알 수 없는 오류");
    return NextResponse.json({ error: "INGEST_FAILED" }, { status: 500 });
  }
}
