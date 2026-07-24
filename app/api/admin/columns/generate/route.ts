import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { generateColumn } from "@/lib/columns/generate";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 180;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await generateColumn({
      topicHint: typeof body.topicHint === "string" ? body.topicHint.trim() : undefined,
      sourceUrls: Array.isArray(body.sourceUrls) ? body.sourceUrls : [],
      createdBy: user.email!,
    });
    return NextResponse.json(result, { status: result.blocked ? 422 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "초안 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}
