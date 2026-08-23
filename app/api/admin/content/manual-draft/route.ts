import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { editorialPublicationIssues } from "@/lib/content-ops/editorial-policy";
import { stripFaqDisplayFormatting } from "@/lib/content-ops/editorial-style";
import { insertSentenceBreaks } from "@/lib/content-ops/sentence-breaks-html";
import { createStyleRevisionStamp } from "@/lib/content-ops/style-revision-rules";
import { publicSourceUrls } from "@/lib/content-ops/source-section";
import type { GeneratedContent } from "@/lib/content-ops/generated-content";
import { sanitizeGeneratedHtml, sanitizeInlineHtml } from "@/lib/security/html";

export const maxDuration = 60;

/**
 * 이미 손으로 써 둔 원고를 작업 큐에 그대로 넣습니다.
 *
 * 지금까지 컨설팅·디자인 블로그에 글을 넣는 길은 "AI로 초안 만들기" 하나뿐이었습니다.
 * 쓸 내용이 이미 있는데도 주제부터 AI에게 맡겨 아무 글이나 만들게 한 다음,
 * 검토 화면에서 본문을 통째로 지우고 붙여넣어야 했습니다. 그 한 번에 Gemini 호출
 * 6회가 예약되고, 하루 상한도 그만큼 깎였습니다.
 *
 * 여기서는 AI를 부르지 않습니다. 붙여넣은 내용을 그대로 저장하고, 자동 생성과
 * 똑같은 검수 규칙만 돌려 결과를 알려 줍니다.
 */

const CHANNELS = new Set(["naver_consulting", "naver_design"]);
const FORMATS: Record<string, Set<string>> = {
  naver_consulting: new Set(["informational", "authority"]),
  naver_design: new Set(["design_insight", "portfolio"]),
};

const LABELS: Record<string, string> = {
  informational: "컨설팅 정보형",
  authority: "컨설팅 울림 콘텐츠형",
  design_insight: "디자인 인사이트",
  portfolio: "포트폴리오",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, limit);
}

function normalizedFaq(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const entry = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return {
        question: sanitizeInlineHtml(stripFaqDisplayFormatting(text(entry.question))).trim(),
        answer: sanitizeInlineHtml(stripFaqDisplayFormatting(text(entry.answer))).trim(),
      };
    })
    .filter((entry) => entry.question && entry.answer)
    .slice(0, 4);
}

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const channel = text(body.channel);
  const format = text(body.format);
  if (!CHANNELS.has(channel)) {
    return NextResponse.json({ error: "채널이 올바르지 않습니다." }, { status: 400 });
  }
  if (!FORMATS[channel].has(format)) {
    return NextResponse.json({ error: "글 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const title = text(body.title);
  if (!title) return NextResponse.json({ error: "제목을 입력해 주세요." }, { status: 400 });
  const rawBody = text(body.bodyHtml);
  if (!rawBody) return NextResponse.json({ error: "본문을 입력해 주세요." }, { status: 400 });

  // 저장 시점에 한 번 정리합니다. 자동 생성과 같은 순서입니다.
  // 허용하지 않은 태그는 여기서 빠지므로, 화면에 보이는 것이 곧 저장된 내용입니다.
  const bodyHtml = insertSentenceBreaks(sanitizeGeneratedHtml(rawBody));
  const faq = normalizedFaq(body.faq);
  const sourceUrls = publicSourceUrls(stringList(body.sourceUrls, 8));

  const generated: GeneratedContent = {
    title,
    summary: text(body.summary),
    bodyHtml,
    faq,
    tags: stringList(body.tags, 10),
    sourceUrls,
    usedKnowledgeIds: [],
  };

  // 자동 생성과 같은 검수를 돌립니다. 걸리는 항목이 있으면 보류로 넣고
  // 무엇이 걸렸는지 적어 둡니다. 사람이 판단해 그대로 승인할 수도 있습니다.
  const issues = editorialPublicationIssues(format, generated);
  const status = issues.length ? "on_hold" : "review_required";
  const now = new Date().toISOString();
  const scheduleKey = `manual-written-${crypto.randomUUID()}`;

  const { data, error } = await contentAdmin().from("content_work_items").insert({
    channel,
    format,
    title,
    summary: generated.summary,
    status,
    schedule_key: scheduleKey,
    created_by: user.email,
    review_note: issues.length ? `직접 작성 원고 검수: ${issues.join(", ")}` : null,
    source_label: "직접 작성",
    source_reference: JSON.stringify(sourceUrls),
    metadata: {
      manual: true,
      manualWritten: true,
      writtenBy: user.email,
      writtenAt: now,
      generated,
      validation: {
        plainLength: bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s/g, "").length,
        h2Count: (bodyHtml.match(/<h2[\s>]/gi) || []).length,
        faqCount: faq.length,
        issues,
      },
      // 사람이 쓴 문장은 문체 일괄 교정 대상에서 빼 둡니다.
      // 보류로 들어간 원고도 마찬가지입니다. 검수에서 걸린 항목을 고치는 것은
      // 사람의 일이고, 그 사이에 자동 교정이 문장을 바꿔 놓으면 안 됩니다.
      styleRevision: createStyleRevisionStamp(generated, {
        appliedAt: now,
        appliedBy: user.email || "admin",
        method: "manual-written",
      }),
    },
  })
    .select("id,title,status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data?.id || null,
    title,
    status,
    issues,
    label: LABELS[format] || format,
  });
}
