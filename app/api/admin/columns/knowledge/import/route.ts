import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ImportedCard = {
  topic: string;
  rawText: string;
  expertiseArea?: "planning" | "design" | "government_support" | "business_plan" | "ir_ppt" | "management" | "general";
  perspective?: string;
  caseEvidence?: string;
  differentiator?: string;
};

function stripFence(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "파일을 선택해 주세요." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "파일은 8MB 이하만 가능합니다." }, { status: 400 });

  const extension = file.name.toLowerCase().split(".").pop();
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  if (extension === "txt") text = buffer.toString("utf8");
  else if (extension === "docx") text = (await mammoth.extractRawText({ buffer })).value;
  else return NextResponse.json({ error: "TXT 또는 DOCX 파일만 올릴 수 있습니다." }, { status: 400 });

  text = text.replace(/\u0000/g, "").trim().slice(0, 120_000);
  if (text.length < 100) return NextResponse.json({ error: "분류할 내용이 충분하지 않습니다." }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI 연결이 설정되지 않았습니다." }, { status: 500 });
  const prompt = `울림컴퍼니 대표의 인터뷰·강의 원천자료를 재사용 가능한 노하우 카드로 분류한다.
원문에 없는 사실은 절대 만들지 않는다. 서로 독립적으로 글 한 편의 근거가 될 수 있는 주제 6~15개로 나눈다.
금액·기간·지원조건처럼 발행 시 공식 확인이 필요한 내용은 rawText 끝에 "[발행 전 공식 확인 필요]"라고 표시한다.
고객사·개인을 식별할 수 있는 내용은 익명화 필요 여부를 rawText 끝에 표시한다.
각 카드의 expertiseArea는 planning, design, government_support, business_plan, ir_ppt, management, general 중 하나다.
기획은 독립 전문 분야이며 전략·서비스·콘텐츠·문서·시각화 기획을 포함한다.
JSON 배열만 반환한다:
[{"topic":"","expertiseArea":"planning","rawText":"","perspective":"","caseEvidence":"","differentiator":""}]

원천자료:
${text}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 32768 },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) return NextResponse.json({ error: `자료 분류에 실패했습니다(${response.status}).` }, { status: 502 });
  const payload = await response.json();
  const output = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("");
  const cards = JSON.parse(stripFence(output || "[]")) as ImportedCard[];
  const rows = cards.slice(0, 15).filter((card) => card.topic && card.rawText).map((card) => ({
    topic: card.topic,
    source_type: "interview",
    expertise_area: card.expertiseArea || "general",
    raw_text: card.rawText,
    perspective: card.perspective || null,
    case_evidence: card.caseEvidence || null,
    differentiator: card.differentiator || null,
    approved: false,
    created_by: user.email,
  }));
  if (rows.length === 0) return NextResponse.json({ error: "분류된 노하우 카드가 없습니다." }, { status: 422 });

  const { data, error } = await createAdminClient().from("column_expert_knowledge").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: data.length, items: data }, { status: 201 });
}
