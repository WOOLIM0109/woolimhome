import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { isAdmin } from "@/lib/auth";
import { serializeVerificationMarkers, type VerificationImportItem } from "@/lib/columns/verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateGeminiText } from "@/lib/gemini/client";

export const runtime = "nodejs";

type ImportedCard = {
  topic: string;
  rawText: string;
  expertiseArea?: "planning" | "design" | "government_support" | "business_plan" | "ir_ppt" | "management" | "general";
  perspective?: string;
  caseEvidence?: string;
  differentiator?: string;
  verificationItems?: VerificationImportItem[];
};

function stripFence(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function normalizedTerms(value: string) {
  return value.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || [];
}

function sourceOverlap(candidate: string, source: string) {
  const sourceTerms = new Set(normalizedTerms(source));
  const candidateTerms = [...new Set(normalizedTerms(candidate))];
  if (candidateTerms.length === 0) return 0;
  return candidateTerms.filter((term) => sourceTerms.has(term)).length / candidateTerms.length;
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

[가장 중요한 원칙: 대표 목소리 보존]
- 이 작업은 전문적인 글을 새로 쓰는 작업이 아니라, 대표가 실제로 말한 판단과 사례를 원문에 가깝게 보존하는 분류 작업이다.
- rawText는 해당 주제와 관련된 원문 발화를 1인칭으로 정리한다. 타임스탬프·발화자 표시·"어", "음" 같은 군더더기와 명백한 음성 인식 오류만 제거한다.
- 대표가 쓰지 않은 전문용어, 영어 표현, 경영학 개념, 일반적인 조언을 새로 넣지 않는다.
- 원문의 솔직한 어휘와 특징적인 표현을 지나치게 점잖은 기업 홍보 문체로 바꾸지 않는다.
- 원문에 없는 인과관계, 성공 이유, 숫자, 경험, 성과를 만들지 않는다. 애매하면 해석하지 말고 생략한다.
- perspective, caseEvidence, differentiator도 반드시 원문에서 직접 확인되는 내용만 짧게 추출한다.

[분류 방식]
- 서로 독립적으로 글 한 편의 근거가 될 수 있는 주제 6~12개로 나눈다.
- rawText는 카드마다 250~900자를 권장한다. 한두 문장의 일반론으로 축약하지 않는다.
- 파일명과 원천자료 제목이 특정 전문 분야를 명확히 가리키면 그 분야를 주된 expertiseArea로 사용한다.
- 기획 인터뷰의 경우 PPT·IR·사업계획서 사례도 '기획자의 판단 방식'을 설명하는 내용이면 planning으로 분류한다.
- rawText에는 확인 필요·익명화 필요 같은 관리 문구를 넣지 않는다.
- 금액·기간·지원조건·통계·제도명·성과처럼 발행 시 공식 확인이 필요한 사실은 verificationItems에 type "official"로 넣고, 무엇을 확인해야 하는지 구체적으로 쓴다.
- 고객사·개인을 식별할 수 있는 이름·계약·사례·성과는 verificationItems에 type "privacy"로 넣고, 무엇을 익명화하거나 공개 동의를 확인해야 하는지 구체적으로 쓴다.
- 확인할 내용이 없는 카드는 verificationItems를 빈 배열로 둔다.
각 카드의 expertiseArea는 planning, design, government_support, business_plan, ir_ppt, management, general 중 하나다.
기획은 독립 전문 분야이며 전략·서비스·콘텐츠·문서·시각화 기획을 포함한다.
JSON 배열만 반환한다:
[{"topic":"","expertiseArea":"planning","rawText":"","perspective":"","caseEvidence":"","differentiator":"","verificationItems":[{"type":"official","detail":"확인할 사실"}]}]

[파일명]
${file.name}

원천자료:
${text}`;

  const { text: output } = await generateGeminiText({
    parts: [{ text: prompt }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 32768 },
    timeoutMs: 120_000,
  });
  const cards = JSON.parse(stripFence(output || "[]")) as ImportedCard[];
  const groundedCards = cards.slice(0, 15)
    .filter((card) => card.topic && card.rawText)
    .map((card) => ({
      ...card,
      topic: card.topic.trim(),
      rawText: card.rawText.trim(),
      overlap: sourceOverlap(card.rawText, text),
    }))
    .filter((card) => card.rawText.length >= 180 && card.overlap >= 0.6);

  if (groundedCards.length < 5) {
    return NextResponse.json({
      error: "대표님의 실제 표현을 충분히 보존한 카드가 5개 미만이라 저장하지 않았습니다. 원문을 다시 분석해 주세요.",
    }, { status: 422 });
  }

  const rows = groundedCards.map((card) => {
    const verificationMarkers = serializeVerificationMarkers(card.verificationItems);
    return {
      topic: card.topic,
      source_type: "interview",
      expertise_area: card.expertiseArea || "general",
      raw_text: `${card.rawText}${verificationMarkers ? `\n\n${verificationMarkers}` : ""}`,
      perspective: card.perspective || null,
      case_evidence: card.caseEvidence || null,
      differentiator: card.differentiator || null,
      approved: false,
      created_by: user.email,
    };
  });

  const { data, error } = await createAdminClient().from("column_expert_knowledge").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: data.length, items: data }, { status: 201 });
}
