import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null });
}

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "올바른 푸시 구독 정보가 아닙니다." }, { status: 400 });
  const { data, error } = await contentAdmin().from("openchat_push_subscriptions").upsert({
    admin_email: user.email,
    endpoint,
    p256dh,
    auth,
    user_agent: request.headers.get("user-agent"),
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.endpoint) return NextResponse.json({ error: "endpoint가 필요합니다." }, { status: 400 });
  const { error } = await contentAdmin().from("openchat_push_subscriptions").delete().eq("endpoint", body.endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

