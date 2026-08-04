self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "울림컴퍼니 알림", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "울림컴퍼니 알림", {
    body: payload.body || "관리자 페이지를 확인해 주세요.",
    icon: "/icon.png",
    badge: "/icon.png",
    data: { url: payload.url || "/admin/openchat" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/admin/openchat", self.location.origin).toString();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});

