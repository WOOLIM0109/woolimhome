import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateGeminiText } from "@/lib/gemini/client";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import {
  KNOWLEDGE_CARD_SCHEMA,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CHARS,
  importableKind,
  knowledgeImportPrompt,
  parseKnowledgeCards,
} from "@/lib/columns/knowledge-import";

export const runtime = "nodejs";
// 긴 파일은 나누는 데 시간이 걸립니다. 기본값으로는 중간에 끊깁니다.
export const maxDuration = 300;

/**
 * 파일을 노하우 카드로 나눕니다.
 *
 * 예전에는 이 자리에 "비용 보호 모드에서 차단됩니다"라는 말만 있었습니다.
 * 무엇을 확인해서 막은 것이 아니라, 조건 없이 늘 그 말만 돌려주는 껍데기였습니다.
 * 그래서 화면에서 아무리 눌러도 같은 경고창만 떴습니다.
 *
 * 예산 관문(runBudgetedGeminiAutomation)은 다른 기능이 이미 다 쓰고 있습니다.
 * 상한을 넘었으면 그 관문이 막고, 여유가 있으면 통과합니다. 여기서 따로
 * 막을 이유가 없습니다.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let text: string;
  let fileName: string;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일을 선택해 주세요." }, { status: 400 });
    }
    fileName = file.name || "이름 없는 파일";
    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({
        error: `파일이 너무 큽니다(${Math.round(file.size / 1024 / 1024)}MB). ${MAX_IMPORT_BYTES / 1024 / 1024}MB 이하로 나눠서 올려 주세요.`,
      }, { status: 400 });
    }
    const kind = importableKind(fileName, file.type);
    if (!kind) {
      return NextResponse.json({
        error: "txt 또는 docx 파일만 읽을 수 있습니다.",
      }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (kind === "docx") {
      // mammoth 는 docx 에서 글자만 꺼냅니다. 표와 서식은 버려집니다.
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer })).value;
    } else {
      text = buffer.toString("utf8");
    }
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? `파일을 읽지 못했습니다: ${error.message}` : "파일을 읽지 못했습니다.",
    }, { status: 400 });
  }

  if (text.trim().length < 100) {
    return NextResponse.json({
      error: "글이 너무 짧아 나눌 것이 없습니다. 100자 이상인 파일을 올려 주세요.",
    }, { status: 400 });
  }

  try {
    const cards = await runBudgetedGeminiAutomation({
      operation: "knowledge-import",
      actor: user.email || "admin",
      // 분류 1회. 형식이 깨지면 한 번 더.
      plannedCalls: 2,
      estimatedInputTokens: Math.ceil(Math.min(text.length, MAX_IMPORT_CHARS) / 2),
    }, async () => {
      const attempt = async (retry: boolean) => {
        const { text: raw } = await generateGeminiText({
          parts: [{
            text: retry
              ? `${knowledgeImportPrompt(text)}\n\n앞선 응답은 JSON 문법 오류로 읽지 못했습니다. JSON 객체 외에는 아무 글자도 반환하지 마세요.`
              : knowledgeImportPrompt(text),
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: KNOWLEDGE_CARD_SCHEMA,
            maxOutputTokens: 16_000,
          },
          timeoutMs: 120_000,
        });
        return parseKnowledgeCards(raw || "");
      };
      try {
        return await attempt(false);
      } catch {
        return await attempt(true);
      }
    });

    if (!cards.length) {
      return NextResponse.json({
        error: "이 파일에서는 노하우 카드를 만들지 못했습니다. 상담 사례나 인터뷰 기록처럼 대표님의 판단이 담긴 글이어야 합니다.",
      }, { status: 422 });
    }

    /*
     * 승인은 사람이 합니다.
     *
     * approved 로 넣으면 다음 칼럼이 바로 이 내용을 사실처럼 인용합니다.
     * AI 가 나눈 것을 대표님이 아직 보지 않았으므로 미승인으로 둡니다.
     */
    const { data, error } = await createAdminClient()
      .from("column_expert_knowledge")
      .insert(cards.map((card) => ({
        ...card,
        approved: false,
        created_by: user.email,
      })))
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      count: data?.length || 0,
      fileName,
      approved: false,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof GeminiAutomationBlocked) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "파일 분류에 실패했습니다.",
    }, { status: 500 });
  }
}
