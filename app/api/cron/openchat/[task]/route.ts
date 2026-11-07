import { NextResponse } from "next/server";
import { executeOpenchatTask } from "@/lib/openchat/operations";
import type { OpenchatCronTask } from "@/lib/openchat/types";
import { authorizeCron } from "@/lib/cron-auth";

export const maxDuration = 300;

// ★ "morning-collect" · "morning-repair" 를 뺐습니다 (2026-11-08).
// 홈페이지가 직접 게시판을 훑는 작업입니다. 공고 수집은 PC 수집기 하나로
// 모았습니다. 주소가 살아 있으면 크론에 다시 넣기만 해도 낡은 행이 쌓입니다.
// 까닭은 app/api/admin/openchat/run/route.ts 에 적어 두었습니다.
const TASKS: OpenchatCronTask[] = [
  "attachments",
  "morning-queue", "morning-draft-notify", "morning-approval-reminder", "morning-cutoff", "morning-ready",
  "afternoon-draft", "afternoon-cutoff", "afternoon-ready",
];

export async function GET(request: Request, context: { params: Promise<{ task: string }> }) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;
  const { task } = await context.params;
  if (!TASKS.includes(task as OpenchatCronTask)) {
    return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  }
  try {
    return NextResponse.json(await executeOpenchatTask(task as OpenchatCronTask));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "작업 실패" }, { status: 500 });
  }
}
