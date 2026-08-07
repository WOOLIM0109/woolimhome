import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { executeOpenchatTask } from "@/lib/openchat/operations";
import type { OpenchatCronTask } from "@/lib/openchat/types";

export const maxDuration = 300;

const TASKS: OpenchatCronTask[] = [
  "morning-collect", "morning-repair", "morning-draft-notify", "morning-approval-reminder", "morning-cutoff", "morning-ready",
  "afternoon-draft", "afternoon-cutoff", "afternoon-ready",
];

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!TASKS.includes(body.task)) return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  try {
    const result = await executeOpenchatTask(body.task, body.date);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "작업 실패" }, { status: 500 });
  }
}
