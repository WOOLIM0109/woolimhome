import { contentAdmin } from "@/lib/content-ops/data";
import {
  FRIENDLY_EDITORIAL_STYLE_RULES,
  friendlyStyleIssues,
  stripFaqPrefix,
} from "@/lib/content-ops/editorial-style";
import type { GeneratedContent } from "@/lib/content-ops/generated-content";
import {
  assertSameNumericFacts,
  lockValue,
  markerLetters,
  numericFacts,
  restoreLocked,
} from "@/lib/content-ops/protected-markers";
import type { ContentChannel } from "@/lib/content-ops/types";
import { isPartnerReleaseReady } from "@/lib/partner-portal";
import { generateGeminiJson } from "@/lib/portfolio/gemini";
import { sanitizeGeneratedHtml, sanitizeInlineHtml } from "@/lib/security/html";

export const FRIENDLY_STYLE_VERSION = "friendly-partner-v2-concise-sources";

type PendingItem = {
  id: string;
  channel: ContentChannel;
  format: string;
  title: string;
  summary: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type FriendlyRewrite = {
  summary: string;
  bodyHtml: string;
  faq: { question: string; answer: string }[];
};

function safeBodyHtml(value: string) {
  return sanitizeGeneratedHtml(value)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<\/?(?:figure|figcaption|img|span|section|br)\b[^>]*>/gi, "");
}

function plainLength(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s/g, "").length;
}

function channelDirection(channel: ContentChannel, format: string) {
  if (channel === "naver_consulting" && format === "authority") {
    return "울림이 실제 상담에서 무엇을 먼저 확인하고 왜 그렇게 판단하는지를 대표가 옆에서 설명하듯 쓴다.";
  }
  if (channel === "naver_consulting") {
    return "지원 조건과 확인 순서를 차분하게 설명하고, 독자가 다음 행동을 바로 고를 수 있게 쓴다.";
  }
  if (format === "portfolio") {
    return "실제 화면에서 확인되는 구성과 울림의 디자인 의도를 담담하고 친근하게 설명한다. 자화자찬은 하지 않는다.";
  }
  return "추상적인 디자인 칭찬보다 독자가 바로 적용할 편집 방법과 확인 기준을 친근하게 설명한다.";
}

async function rewriteGenerated(
  item: PendingItem,
  generated: GeneratedContent,
) {
  const originalSummary = generated.summary || item.summary || "";
  const numericChecklist = numericFacts([
    originalSummary,
    generated.bodyHtml,
    ...(generated.faq || []).flatMap((faq) => [faq.question, faq.answer]),
  ].join("\n"));
  const body = lockValue(generated.bodyHtml, "BODY", true, false);
  const summary = lockValue(originalSummary, "SUMMARY", false, false);
  const faqLocks = (generated.faq || []).map((faq, index) => ({
    question: lockValue(stripFaqPrefix(faq.question), `FAQ${markerLetters(index)}QUESTION`, false, false),
    answer: lockValue(stripFaqPrefix(faq.answer), `FAQ${markerLetters(index)}ANSWER`, false, false),
  }));
  const input = {
    summary: summary.value,
    bodyHtml: body.value,
    faq: faqLocks.map((faq) => ({ question: faq.question.value, answer: faq.answer.value })),
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retry = attempt && lastError instanceof Error
      ? `\n직전 결과의 안전검사 문제: ${lastError.message}\n보호 마커와 원문의 사실을 그대로 유지해 다시 작성하세요.`
      : "";
    const rewritten = await generateGeminiJson<FriendlyRewrite>([{ text: `
당신은 울림컴퍼니의 네이버 블로그 원고를 다듬는 한국어 편집자입니다.
새로운 사실을 조사하거나 추가하지 말고, 아래 승인 원고의 의미·사실·수치·링크·이미지·소제목 순서를 그대로 유지한 채 말투와 강조만 다듬으세요.

채널별 방향: ${channelDirection(item.channel, item.format)}
${FRIENDLY_EDITORIAL_STYLE_RULES}

추가 안전 규칙:
- 제목은 수정하지 않습니다. 출력에도 제목을 넣지 않습니다.
- WOOLIMLOCK으로 시작해 END로 끝나는 모든 보호 마커는 철자와 순서를 절대 바꾸거나 삭제하거나 복제하지 않습니다.
- 본문의 H2/H3 주제와 순서, 문단의 핵심 주장, 모든 사실과 조건을 유지합니다.
- figure와 링크는 보호 마커로 잠겨 있으며 위치를 이동하지 않습니다.
- 기존 FAQ 개수와 질문의 의미를 유지합니다.
- 수치 체크리스트의 각 항목은 단위까지 그대로, 같은 횟수로 결과 전체에 포함합니다. 요약·본문·FAQ 사이의 위치는 자연스럽게 조정할 수 있습니다.
- summary에는 HTML을 넣지 않습니다.
- bodyHtml에는 h2,h3,p,ul,ol,li,strong,blockquote만 새로 사용합니다.
- FAQ question에는 HTML과 Q. 접두어를 넣지 않습니다.
- FAQ answer에는 핵심어를 위한 <strong>만 사용할 수 있고 A. 접두어는 넣지 않습니다.

반드시 다음 형태의 JSON 객체만 반환하세요:
{"summary":"","bodyHtml":"","faq":[{"question":"","answer":""}]}

승인 원고:
${JSON.stringify(input)}

수치 체크리스트:
${JSON.stringify(numericChecklist)}${retry}
` }], { maxOutputTokens: 30000, timeoutMs: 150_000 });
    try {
      if (!rewritten || typeof rewritten.summary !== "string" || typeof rewritten.bodyHtml !== "string") {
        throw new Error("말투 수정 결과의 필수 필드가 없습니다.");
      }
      if (!Array.isArray(rewritten.faq) || rewritten.faq.length !== faqLocks.length) {
        throw new Error("FAQ 개수가 달라졌습니다.");
      }
      const restoredSummary = restoreLocked(rewritten.summary, summary.locks).trim();
      const restoredBody = restoreLocked(safeBodyHtml(rewritten.bodyHtml), body.locks);
      const restoredFaq = rewritten.faq.map((faq, index) => ({
        question: sanitizeInlineHtml(stripFaqPrefix(restoreLocked(faq.question, faqLocks[index].question.locks))),
        answer: sanitizeInlineHtml(stripFaqPrefix(restoreLocked(faq.answer, faqLocks[index].answer.locks))),
      }));
      const originalNumericText = [
        originalSummary,
        generated.bodyHtml,
        ...(generated.faq || []).flatMap((faq) => [
          stripFaqPrefix(faq.question),
          stripFaqPrefix(faq.answer),
        ]),
      ].join("\n");
      const revisedNumericText = [
        restoredSummary,
        restoredBody,
        ...restoredFaq.flatMap((faq) => [faq.question, faq.answer]),
      ].join("\n");
      assertSameNumericFacts(originalNumericText, revisedNumericText);
      const originalLength = plainLength(generated.bodyHtml);
      const nextLength = plainLength(restoredBody);
      // Friendly editing removes repetitive setup and recap from older drafts.
      // Keep a substantial floor without rejecting a fact-preserving tighter edit.
      if (nextLength < Math.max(900, Math.floor(originalLength * 0.65))) {
        throw new Error("본문이 원문보다 지나치게 짧아졌습니다.");
      }
      if (nextLength > Math.ceil(originalLength * 1.25)) {
        throw new Error("본문이 원문보다 지나치게 길어졌습니다.");
      }
      const issues = friendlyStyleIssues(restoredBody, restoredFaq);
      if (issues.length) throw new Error(issues.join(" "));
      return {
        ...generated,
        summary: restoredSummary,
        bodyHtml: restoredBody,
        faq: restoredFaq,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("원고 말투를 안전하게 다듬지 못했습니다.");
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

export async function rewritePendingPartnerStyle(channel: ContentChannel, approvedBy: string) {
  const admin = contentAdmin();
  const { data, error } = await admin.from("content_work_items")
    .select("id,channel,format,title,summary,status,metadata")
    .eq("channel", channel)
    .in("status", ["approved", "naver_ready", "scheduled"])
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  const candidates = ((data || []) as PendingItem[]).filter((item) => {
    const metadata = item.metadata || {};
    const generated = metadata.generated as GeneratedContent | undefined;
    const styleRevision = metadata.styleRevision as { version?: string } | undefined;
    return Boolean(generated?.bodyHtml)
      && isPartnerReleaseReady(item)
      && styleRevision?.version !== FRIENDLY_STYLE_VERSION;
  });
  const results = await mapWithConcurrency(candidates, 2, async (item) => {
    try {
      const metadata = item.metadata || {};
      const previousGenerated = metadata.generated as GeneratedContent;
      const generated = await rewriteGenerated(item, previousGenerated);
      const appliedAt = new Date().toISOString();
      const validation = (metadata.validation || {}) as Record<string, unknown>;
      const { error: updateError } = await admin.from("content_work_items").update({
        summary: generated.summary,
        metadata: {
          ...metadata,
          generated,
          validation: {
            ...validation,
            plainLength: plainLength(generated.bodyHtml),
            h2Count: (generated.bodyHtml.match(/<h2[\s>]/gi) || []).length,
            faqCount: generated.faq.length,
            issues: [],
          },
          styleRevision: {
            version: FRIENDLY_STYLE_VERSION,
            appliedAt,
            appliedBy: approvedBy,
            previousGenerated,
          },
        },
        updated_at: appliedAt,
      }).eq("id", item.id).eq("status", item.status);
      if (updateError) throw new Error(updateError.message);
      return { id: item.id, title: item.title, success: true as const };
    } catch (rewriteError) {
      return {
        id: item.id,
        title: item.title,
        success: false as const,
        error: rewriteError instanceof Error ? rewriteError.message : "알 수 없는 말투 수정 오류",
      };
    }
  });
  return {
    channel,
    found: candidates.length,
    updated: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results,
  };
}
