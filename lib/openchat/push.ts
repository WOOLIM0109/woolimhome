import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
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

function configure() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:woolim@woolimcompany.kr";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function sendOpenchatNotification(task: OpenchatCronTask, summary: Record<string, unknown>) {
  if (task === "morning-collect" || task === "morning-repair") return { sent: 0, skipped: "관리자 수동 작업" };
  if (!configure()) return { sent: 0, skipped: "VAPID 키 미설정" };
  const admin = createAdminClient();
  const { data, error } = await admin.from("openchat_push_subscriptions")
    .select("id,endpoint,p256dh,auth");
  if (error) throw new Error(error.message);
  const notification = NOTIFICATIONS[task];
  let sent = 0;
  for (const subscription of data || []) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({
        title: notification.title,
        body: notification.body(summary),
        url: "/admin/openchat",
      }));
      sent += 1;
    } catch (pushError) {
      const statusCode = (pushError as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("openchat_push_subscriptions").delete().eq("id", subscription.id);
      }
    }
  }
  return { sent };
}
