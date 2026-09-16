import { sendAdminPush } from "@/lib/notify/web-push";
import type { OpenchatCronTask } from "./types";

const NOTIFICATIONS: Record<OpenchatCronTask, { title: string; body: (summary: Record<string, unknown>) => string }> = {
  "morning-repair": {
    title: "지원사업 누락정보 복구 완료",
    body: (summary) => `누락 공고 ${Number(summary.repaired || 0)}건을 복구했습니다.`,
  },
  "morning-collect": {
    title: "지원사업 수집 완료",
    body: (summary) => `신규 검토 대상 ${Number(summary.newPrograms || 0)}건이 수집되었습니다.`,
  },
  "morning-draft-notify": {
    title: "오전 공고 초안 준비",
    body: (summary) => `검토가 필요한 공고 ${Number(summary.reviewRequired || 0)}건이 있습니다.`,
  },
  "morning-approval-reminder": {
    title: "오전 공고 승인 마감 15분 전",
    body: (summary) => Number(summary.reviewRequired || 0)
      ? `미승인 공고 ${Number(summary.reviewRequired || 0)}건이 있습니다. 오전 10시 15분까지 승인하지 않으면 다음 영업일로 이월됩니다.`
      : "승인 대기 중인 오전 공고가 없습니다.",
  },
  "morning-cutoff": {
    title: "오전 공고 승인 마감",
    body: (summary) => `미승인 ${Number(summary.deferred || 0)}건을 다음 영업일로 이월했습니다.`,
  },
  "morning-ready": {
    title: "오전 게시문 준비 완료",
    body: (summary) => `승인된 공고 ${Number(summary.ready || 0)}건을 복사해 게시할 수 있습니다.`,
  },
  "afternoon-draft": {
    title: "오후 콘텐츠 초안 준비",
    body: (summary) => summary.created === false ? "오늘 초안이 이미 준비되어 있습니다." : "오후 콘텐츠 초안을 검토해 주세요.",
  },
  "afternoon-cutoff": {
    title: "오후 콘텐츠 승인 마감",
    body: (summary) => Number(summary.deferred || 0) ? "미승인 초안을 오늘 게시 대상에서 제외했습니다." : "승인 마감 처리가 완료되었습니다.",
  },
  "afternoon-ready": {
    title: "오후 게시문 준비 완료",
    body: (summary) => Number(summary.ready || 0) ? "승인된 콘텐츠를 복사해 게시할 수 있습니다." : "오늘 승인된 오후 콘텐츠가 없습니다.",
  },
};

export async function sendOpenchatNotification(task: OpenchatCronTask, summary: Record<string, unknown>) {
  if (task === "morning-collect" || task === "morning-repair") return { sent: 0, skipped: "관리자 수동 작업" };
  // 보내는 일 자체는 lib/notify/web-push.ts 가 합니다.
  // 포트폴리오 쪽에서도 같은 기기로 알려야 해서 전송부를 한곳으로 모았습니다.
  const notification = NOTIFICATIONS[task];
  const result = await sendAdminPush({
    title: notification.title,
    body: notification.body(summary),
    url: "/admin/openchat",
  });
  return result.skipped ? { sent: result.sent, skipped: result.skipped } : { sent: result.sent };
}
