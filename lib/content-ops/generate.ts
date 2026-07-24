import { createAdminClient } from "@/lib/supabase/admin";
import type { EditorialSlot } from "./types";

type Source = { name: string; base_url: string; source_grade: number; topic_families: string[] };

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function sourceSnapshot(source: Source) {
  try {
    const response = await fetch(source.base_url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const text = clean(await response.text()).slice(0, 5000);
    return { ...source, snapshot: text };
  } catch { return null; }
}

function promptFor(slot: EditorialSlot, sources: unknown[]) {
  const channel = slot.channel === "naver_design" ? "PPT·PDF·디자인·비즈니스 문서" : "종합 경영컨설팅";
  return `당신은 울림컴퍼니의 ${channel} 콘텐츠 편집자입니다.\n\n채널: ${slot.channel}\n형식: ${slot.format}\n\n공식 출처 스냅샷을 근거로 한국 기업 담당자가 이해하기 쉬운 초안을 작성하세요. 출처에 없는 숫자·요건·사례를 만들지 마세요. 전문 용어는 처음 나올 때 쉬운 설명을 붙이세요.\n\n반드시 JSON만 반환하세요:\n{"title":"","summary":"","bodyHtml":"<h2>...</h2><p>...</p>","faq":[{"question":"","answer":""}],"tags":[""],"sourceUrls":[""]}\n\n조건: 본문 2,000~3,500자, H2 3개 이상, FAQ 3개, HTML은 h2,h3,p,ul,ol,li,strong,blockquote,a만 사용. FAQ 질문은 실제 고객의 말투로 작성하세요.\n\n출처:\n${JSON.stringify(sources)}`;
}

export async function generateContentWorkItem(slot: EditorialSlot, scheduleKey: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const admin = createAdminClient();
  const { data: registered, error: sourceError } = await admin.from("content_source_registry")
    .select("name,base_url,source_grade,topic_families").eq("enabled", true).order("source_grade").limit(6);
  if (sourceError) throw new Error(sourceError.message);
  const sources = (await Promise.all((registered || []).map(sourceSnapshot))).filter((source): source is Source & { snapshot: string } => Boolean(source));
  if (sources.length < 2) throw new Error("읽을 수 있는 공식 출처가 2개 미만입니다.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: promptFor(slot, sources) }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 12000 } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`AI 생성 요청 실패: ${response.status}`);
  const payload = await response.json();
  const raw = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("")?.trim();
  if (!raw) throw new Error("AI 응답이 비어 있습니다.");
  const generated = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "")) as { title: string; summary: string; bodyHtml: string; faq: unknown[]; tags: string[]; sourceUrls: string[] };
  const plainLength = clean(generated.bodyHtml || "").replace(/\s/g, "").length;
  const h2Count = (generated.bodyHtml?.match(/<h2[\s>]/gi) || []).length;
  const status = plainLength >= 2000 && h2Count >= 3 && generated.faq?.length >= 3 ? "review_required" : "on_hold";
  const { data, error } = await admin.from("content_work_items").update({
    title: generated.title, summary: generated.summary || "", status, review_note: status === "on_hold" ? `자동 검증 보류: 본문 ${plainLength}자, H2 ${h2Count}개` : null,
    source_label: sources.map((source) => source.name).join(", "), source_reference: JSON.stringify(generated.sourceUrls || []),
    metadata: { generated, validation: { plainLength, h2Count, faqCount: generated.faq?.length || 0 }, generatedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq("schedule_key", scheduleKey).select().single();
  if (error) throw new Error(error.message);
  return data;
}
