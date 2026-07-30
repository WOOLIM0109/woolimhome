import { createAdminClient } from "@/lib/supabase/admin";
import { PORTFOLIO_WRITING_RULES } from "./portfolio-rules";
import type { EditorialSlot } from "./types";
import {
  generationCancellationRequested,
  removeCancelledGeneration,
} from "./cancellation";
import {
  editorialRevisionNote,
  GENERATED_CONTENT_SCHEMA,
  parseGeneratedContent,
  type GeneratedContent,
} from "./generated-content";

type Source = {
  name: string;
  base_url: string;
  source_grade: number;
  topic_families: string[];
  channels: string[];
};

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safeHtml(value: string) {
  return value.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

async function sourceSnapshot(source: Source) {
  try {
    const response = await fetch(source.base_url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    return { ...source, snapshot: clean(await response.text()).slice(0, 5000) };
  } catch {
    return null;
  }
}

function promptFor(
  slot: EditorialSlot,
  sources: unknown[],
  revision?: { note: string; previous?: GeneratedContent },
) {
  const designRules = slot.channel === "naver_design" ? `
이 글은 디자인 블로그 전용이다. 주제는 PPT·PDF·비즈니스 문서 기획, 정보 구조, 레이아웃, 가독성, 시각화, 디자인 시스템 중에서만 고른다.
정부지원사업·정책자금·기업인증·대출·지원금은 제목과 중심 주제로 사용할 수 없다.
울림이 실제로 수행하지 않은 프로젝트·성과·고객 반응을 만들지 않는다.
포트폴리오 사례처럼 쓰지 말고, 공식 디자인 자료를 실무자가 적용할 수 있도록 해설하는 기획·디자인 인사이트로 작성한다.
제목에 채널명이나 [naver_design] 같은 내부 표기를 넣지 않는다.` : "";
  const channel = slot.channel === "naver_design" ? "PPT·PDF·디자인·비즈니스 문서" : "종합 경영컨설팅";
  const revisionRules = revision ? `
이 작업은 기존 초안의 수정 요청을 반영하는 재작성이다.
수정 요청: ${revision.note}
${revision.previous ? `기존 초안:\n${JSON.stringify(revision.previous)}` : ""}
수정 요청을 빠짐없이 반영하되, 출처에 없는 사실이나 성과를 새로 만들지 말고 전체 JSON 초안을 완성해서 반환한다.` : "";
  return `당신은 울림컴퍼니의 ${channel} 콘텐츠 편집자입니다.

채널: ${slot.channel}
형식: ${slot.format}
${designRules}
${slot.format === "portfolio" ? PORTFOLIO_WRITING_RULES : ""}
${revisionRules}

아래 공식 출처만 근거로 한국 기업 담당자가 이해하기 쉬운 초안을 작성하세요. 출처에 없는 숫자·요건·사례를 만들지 마세요. 전문 용어는 처음 나올 때 쉬운 설명을 붙이세요.

반드시 JSON만 반환하세요:
{"title":"","summary":"","bodyHtml":"<h2>...</h2><p>...</p>","faq":[{"question":"","answer":""}],"tags":[""],"sourceUrls":[""]}

조건: 본문 2,000~3,500자, H2 3개 이상, FAQ 3개. HTML은 h2,h3,p,ul,ol,li,strong,blockquote,a만 사용하세요. FAQ 질문은 실제 고객의 말투로 작성하세요.

출처:
${JSON.stringify(sources)}`;
}

async function requestGeneratedContent({
  apiKey,
  prompt,
  scheduleKey,
}: {
  apiKey: string;
  prompt: string;
  scheduleKey: string;
}) {
  let lastParseError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      throw new Error("GENERATION_CANCELLED");
    }
    const retryInstruction = attempt
      ? "\n\n이전 응답은 JSON 문법 오류로 읽지 못했습니다. 내용을 처음부터 다시 생성하고, JSON 객체 외에는 아무 글자도 반환하지 마세요."
      : "";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${prompt}${retryInstruction}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: GENERATED_CONTENT_SCHEMA,
            maxOutputTokens: 12000,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) throw new Error(`AI 생성 요청 실패: ${response.status}`);
    const payload = await response.json();
    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "").join("")?.trim();
    if (!raw) throw new Error("AI 응답이 비어 있습니다.");
    try {
      return parseGeneratedContent(raw);
    } catch (error) {
      lastParseError = error;
    }
  }
  const detail = lastParseError instanceof Error ? lastParseError.message : "알 수 없는 JSON 형식 오류";
  throw new Error(`AI 응답 형식을 두 번 복구하지 못했습니다: ${detail}`);
}

export async function generateContentWorkItem(
  slot: EditorialSlot,
  scheduleKey: string,
  options: { revisionNote?: string | null } = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  if (slot.channel === "naver_design" && slot.format === "portfolio") {
    throw new Error("포트폴리오형은 실제 프로젝트 원본과 완성 이미지가 연결된 뒤에만 생성합니다.");
  }

  const admin = createAdminClient();
  const { data: currentWorkItem, error: workItemError } = await admin
    .from("content_work_items")
    .select("review_note,metadata")
    .eq("schedule_key", scheduleKey)
    .maybeSingle();
  if (workItemError) throw new Error(workItemError.message);
  const storedMetadata = (currentWorkItem?.metadata || {}) as Record<string, unknown> & {
    generated?: GeneratedContent;
  };
  const revisionNote = editorialRevisionNote(
    options.revisionNote === undefined ? currentWorkItem?.review_note : options.revisionNote,
  );
  const { data: registered, error: sourceError } = await admin.from("content_source_registry")
    .select("name,base_url,source_grade,topic_families,channels")
    .eq("enabled", true).contains("channels", [slot.channel]).order("source_grade").limit(8);
  if (sourceError) throw new Error(sourceError.message);
  const sources = (await Promise.all((registered || []).map(sourceSnapshot)))
    .filter((source): source is Source & { snapshot: string } => Boolean(source));
  if (sources.length < 2) throw new Error("읽을 수 있는 채널 전용 공식 출처가 2개 미만입니다.");

  const generated = await requestGeneratedContent({
    apiKey,
    prompt: promptFor(
      slot,
      sources,
      revisionNote ? { note: revisionNote, previous: storedMetadata.generated } : undefined,
    ),
    scheduleKey,
  });
  generated.bodyHtml = safeHtml(generated.bodyHtml || "");
  const plainLength = clean(generated.bodyHtml).replace(/\s/g, "").length;
  const h2Count = (generated.bodyHtml.match(/<h2[\s>]/gi) || []).length;
  const faqCount = generated.faq?.length || 0;
  const designForbidden = slot.channel === "naver_design"
    && /정부지원사업|정책자금|지원금|융자|기업인증/.test(`${generated.title} ${generated.summary}`);
  const internalLabel = /\[naver_design\]|naver_design/i.test(generated.title || "");
  const issues = [
    ...(plainLength < 2000 ? [`본문 ${plainLength}자`] : []),
    ...(h2Count < 3 ? [`H2 ${h2Count}개`] : []),
    ...(faqCount < 3 ? [`FAQ ${faqCount}개`] : []),
    ...(designForbidden ? ["디자인 채널에서 금지된 컨설팅 주제"] : []),
    ...(internalLabel ? ["제목에 내부 채널 표기"] : []),
  ];
  if (await generationCancellationRequested(scheduleKey)) {
    await removeCancelledGeneration(scheduleKey);
    throw new Error("GENERATION_CANCELLED");
  }
  const status = issues.length ? "on_hold" : "review_required";
  const { data, error } = await admin.from("content_work_items").update({
    title: generated.title,
    summary: generated.summary || "",
    status,
    review_note: status === "on_hold" ? `자동 검증 보류: ${issues.join(", ")}` : null,
    source_label: sources.map((source) => source.name).join(", "),
    source_reference: JSON.stringify(generated.sourceUrls || []),
    metadata: {
      ...storedMetadata,
      generated,
      sourceChannel: slot.channel,
      validation: { plainLength, h2Count, faqCount, issues },
      generatedAt: new Date().toISOString(),
      ...(revisionNote ? {
        lastRevision: {
          note: revisionNote,
          appliedAt: new Date().toISOString(),
        },
      } : {}),
    },
    updated_at: new Date().toISOString(),
  }).eq("schedule_key", scheduleKey).select().single();
  if (error) throw new Error(error.message);
  return data;
}
