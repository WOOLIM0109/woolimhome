import { NextResponse } from "next/server";
import { executeOpenchatTask } from "@/lib/openchat/operations";
import type { OpenchatCronTask } from "@/lib/openchat/types";
import { authorizeCron } from "@/lib/cron-auth";

export const maxDuration = 300;

const TASKS: OpenchatCronTask[] = [
  "morning-collect", "morning-repair", "morning-draft-notify", "morning-approval-reminder", "morning-cutoff", "morning-ready",
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
