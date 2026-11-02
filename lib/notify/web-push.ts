import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 관리자 기기로 알림을 보냅니다.
 *
 * 구독 목록은 오픈채팅 알림이 쓰던 것을 그대로 씁니다. 받는 사람이 같고
 * 기기도 같아서, 따로 구독을 받게 하면 사람만 번거로워집니다.
 *
 * 원래 이 전송 부분은 lib/openchat/push.ts 안에만 있었습니다. 그래서
 * 포트폴리오 쪽에서 무슨 일이 생겨도 알릴 방법이 없었습니다. 실제로 변환이
 * 폰트 때문에 멈춰도 데이터베이스에만 적히고 아무도 몰랐습니다.
 */

export type PushMessage = {
  title: string;
  body: string;
  /** 알림을 눌렀을 때 열 주소. */
  url: string;
};

function configure() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:woolim@woolimcompany.kr";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/**
 * 구독된 모든 관리자 기기에 보냅니다.
 *
 * 알림은 곁다리라, 실패해도 부르는 쪽 일을 막지 않습니다.
 * 끊어진 구독은 그때그때 지웁니다.
 */
export async function sendAdminPush(message: PushMessage, options: { deadlineAt?: number } = {}) {
  if (!configure()) return { sent: 0, skipped: "VAPID 키 미설정" as const };
  const admin = createAdminClient();
  const query = admin.from("openchat_push_subscriptions")
    .select("id,endpoint,p256dh,auth");
  if (options.deadlineAt !== undefined) {
    query.abortSignal(AbortSignal.timeout(Math.max(1, options.deadlineAt - Date.now())));
  }
  const { data, error } = await query;
  if (error) return { sent: 0, skipped: error.message };
  let sent = 0;
  for (const subscription of data || []) {
    const remainingMs = options.deadlineAt === undefined ? undefined : options.deadlineAt - Date.now();
    if (remainingMs !== undefined && remainingMs <= 0) return { sent, skipped: "알림 전송 시간 부족" };
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(message), remainingMs === undefined ? undefined : { timeout: remainingMs });
      sent += 1;
    } catch (pushError) {
      const statusCode = (pushError as { statusCode?: number }).statusCode;
      // 기기가 사라졌거나 구독이 만료된 경우입니다. 지워야 다음에 안 걸립니다.
      if (statusCode === 404 || statusCode === 410) {
        const cleanup = admin.from("openchat_push_subscriptions").delete().eq("id", subscription.id);
        if (options.deadlineAt !== undefined) {
          cleanup.abortSignal(AbortSignal.timeout(Math.max(1, options.deadlineAt - Date.now())));
        }
        await cleanup;
      }
    }
  }
  return { sent, skipped: null };
}
