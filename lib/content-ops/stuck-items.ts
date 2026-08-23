import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 중간에 죽어서 굳어 버린 작업을 풀어 줍니다.
 *
 * 원고 생성은 '제작 중'으로 표시해 두고 시작합니다. 실행 도중 함수가 시간
 * 초과로 죽으면 뒷정리 코드도 같이 죽습니다. 그래서 아무도 손대지 않는
 * '제작 중' 항목이 남습니다. 화면에서는 지금도 돌아가는 것처럼 보이고,
 * 다음 날 그것부터 다시 돌리면 같은 자리에서 또 죽습니다.
 *
 * 여기서는 AI 를 부르지 않습니다. 오래된 '제작 중'을 보류로 내려놓고 무슨
 * 일이 있었는지 적어 둘 뿐입니다. 그래야 검토 목록에 보이고, 사람이
 * 판단해서 다시 돌리거나 지울 수 있습니다.
 */

/** 이 시간이 지나도록 '제작 중'이면 죽은 것으로 봅니다. 함수 상한이 5분입니다. */
const STUCK_AFTER_MINUTES = 20;

/** 한 번에 정리할 최대 건수. 크론 한 번이 오래 붙들리지 않게 합니다. */
const SWEEP_LIMIT = 25;

export type StuckSweepResult = {
  stage: "stuck_sweep";
  released: number;
  titles: string[];
};

export async function sweepStuckWorkItems(now = new Date()): Promise<StuckSweepResult | null> {
  const admin = createAdminClient();
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000).toISOString();

  const { data, error } = await admin
    .from("content_work_items")
    .select("id,title,updated_at")
    .eq("status", "creating")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(SWEEP_LIMIT);
  if (error) throw new Error(error.message);
  if (!data?.length) return null;

  const titles: string[] = [];
  for (const item of data) {
    // 잡아 둔 그 상태 그대로일 때만 내려놓습니다. 그 사이에 실제로 끝났다면
    // 건드리지 않아야 합니다. 다시 확인하지 않으면 멀쩡한 결과를 덮어씁니다.
    const { data: updated, error: updateError } = await admin
      .from("content_work_items")
      .update({
        status: "on_hold",
        review_note: `제작 중에 멈춰 있어 보류로 내렸습니다. `
          + `${STUCK_AFTER_MINUTES}분 넘게 진행이 없었습니다. 다시 만들거나 지워 주세요.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("status", "creating")
      .eq("updated_at", item.updated_at)
      .select("title")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (updated) titles.push(updated.title);
  }

  if (!titles.length) return null;
  return { stage: "stuck_sweep", released: titles.length, titles };
}
