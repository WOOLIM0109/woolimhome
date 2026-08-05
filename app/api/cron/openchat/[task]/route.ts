import { NextResponse } from "next/server";
import { executeOpenchatTask } from "@/lib/openchat/operations";
import type { OpenchatCronTask } from "@/lib/openchat/types";

export const maxDuration = 300;

const TASKS: OpenchatCronTask[] = [
  "morning-collect", "morning-draft-notify", "morning-approval-reminder", "morning-cutoff", "morning-ready",
  "afternoon-draft", "afternoon-cutoff", "afternoon-ready",
];

export async function GET(request: Request, context: { params: Promise<{ task: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
