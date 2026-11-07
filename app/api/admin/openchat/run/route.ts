import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { executeOpenchatTask } from "@/lib/openchat/operations";
import type { OpenchatCronTask } from "@/lib/openchat/types";

export const maxDuration = 300;

// ★ "morning-collect" · "morning-repair" 를 뺐습니다 (2026-11-08).
// 그 둘은 홈페이지가 **직접 게시판을 훑어** 공고·상세를 넣는 작업입니다.
// 공고 수집은 PC 수집기 하나로 모았습니다 — 해외 서버에서는 부산테크노파크 ·
// 부산경제진흥원 · IP지역지식재산센터에 연결조차 되지 않습니다.
//
// 돌릴 수 있게 두면 한 번만 눌러도 낡은 행이 다시 쌓이고, 그 행들이 수집기가
// 보낸 정확한 마감일을 막습니다 (실측: 소담상회가 마감 09-11 로 남아 아직
// 20일 남은 공고가 화면에서 제외로 보였습니다).
const TASKS: OpenchatCronTask[] = [
  "morning-queue", "morning-draft-notify", "morning-approval-reminder", "morning-cutoff", "morning-ready",
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
