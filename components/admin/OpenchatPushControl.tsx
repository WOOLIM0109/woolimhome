"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";

function base64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function OpenchatPushControl() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const available = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      setSupported(available);
      if (!available) return;
      void navigator.serviceWorker.getRegistration("/openchat-sw.js").then(async (registration) => {
        const subscription = await registration?.pushManager.getSubscription();
        setEnabled(Boolean(subscription));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function toggle() {
    setBusy(true);
    setMessage("");
    try {
      let registration = await navigator.serviceWorker.getRegistration("/openchat-sw.js");
      if (!registration) registration = await navigator.serviceWorker.register("/openchat-sw.js", { scope: "/" });
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await fetch("/api/admin/openchat/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: current.endpoint }),
        });
        await current.unsubscribe();
        setEnabled(false);
        setMessage("브라우저 알림을 해제했습니다.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("브라우저 알림 권한이 허용되지 않았습니다.");
      const response = await fetch("/api/admin/openchat/push-subscriptions", { cache: "no-store" });
      const config = await response.json();
      if (!response.ok) throw new Error(config.error || "알림 설정을 불러오지 못했습니다.");
      if (!config.publicKey) throw new Error("VAPID 공개키를 Vercel 환경변수에 설정해 주세요.");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(config.publicKey),
      });
      const save = await fetch("/api/admin/openchat/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const result = await save.json();
      if (!save.ok) throw new Error(result.error || "알림 구독을 저장하지 못했습니다.");
      setEnabled(true);
      setMessage("오전·오후 준비 알림을 이 브라우저에서 받습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "알림 설정에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return <p className="text-sm text-amber-800">이 브라우저는 웹 푸시 알림을 지원하지 않습니다.</p>;
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold ${
          enabled ? "border border-emerald-200 bg-emerald-50 text-emerald-900" : "border border-[var(--line)] bg-white"
        } disabled:opacity-60`}
      >
        {enabled ? <Bell size={17} /> : <BellOff size={17} />}
        {busy ? "설정 중…" : enabled ? "브라우저 알림 사용 중" : "브라우저 알림 켜기"}
      </button>
      {message && <p className="mt-2 text-xs text-[var(--muted)]">{message}</p>}
    </div>
  );
}
