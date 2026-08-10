import { contentAdmin } from "@/lib/content-ops/data";
import { AI_BATCH_LIMITS, AI_OUTPUT_LIMITS } from "@/lib/ai-budget";
import {
  FRIENDLY_EDITORIAL_STYLE_RULES,
  stripFaqPrefix,
} from "@/lib/content-ops/editorial-style";
import { editorialPublicationIssues } from "@/lib/content-ops/editorial-policy";
import type { GeneratedContent } from "@/lib/content-ops/generated-content";
import {
  assertSameNumericFacts,
  lockValue,
  markerLetters,
  restoreLocked,
} from "@/lib/content-ops/protected-markers";
import type { ContentChannel } from "@/lib/content-ops/types";
import { generateGeminiJson } from "@/lib/portfolio/gemini";
import { sanitizeGeneratedHtml, sanitizeInlineHtml } from "@/lib/security/html";
import {
  createStyleRevisionStamp,
  minimumStyleRevisionBodyLength,
  shouldRewritePendingStyleItem,
  STYLE_REVISION_PENDING_STATUSES,
  styleRevisionFingerprint,
} from "./style-revision-rules";

export {
  createStyleRevisionStamp,
  FRIENDLY_STYLE_VERSION,
  styleRevisionFingerprint,
} from "./style-revision-rules";

type PendingItem = {
  id: string;
  channel: ContentChannel;
  format: string;
  title: string;
  summary: string | null;
  status: string;
  published_at: string | null;
  published_url: string | null;
  published_url_normalized: string | null;
  published_account: string | null;
  updated_at: string;
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
  const body = lockValue(generated.bodyHtml, "BODY", true, true);
  const summary = lockValue(originalSummary, "SUMMARY", false, true);
  const faqLocks = (generated.faq || []).map((faq, index) => ({
    question: lockValue(stripFaqPrefix(faq.question), `FAQ${markerLetters(index)}QUESTION`, false, true),
    answer: lockValue(stripFaqPrefix(faq.answer), `FAQ${markerLetters(index)}ANSWER`, false, true),
  }));
  const input = {
    summary: summary.value,
    bodyHtml: body.value,
    faq: faqLocks.map((faq) => ({ question: faq.question.value, answer: faq.answer.value })),
  };
  // Each item gets exactly one bounded, fact-preserving Gemini pass. Failures
  // stay untouched and are reported so the batch can continue safely.
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
- 숫자와 단위도 보호 마커로 잠겨 있습니다. 마커를 원래 위치와 순서 그대로 유지합니다.
- 보호 마커 밖에는 아라비아 숫자, 퍼센트, 금액, 기간, 인원, 개수, 단계 번호를 새로 쓰지 않습니다.
- 순서를 정리할 때 1·2·3 또는 첫째·둘째 같은 번호를 만들지 말고, "먼저", "다음", "마지막"처럼 숫자 없는 연결어를 사용합니다.
- summary에는 HTML을 넣지 않습니다.
- bodyHtml에는 h2,h3,p,ul,ol,li,strong,blockquote만 새로 사용합니다.
- FAQ question에는 HTML과 Q. 접두어를 넣지 않습니다.
- FAQ answer에는 핵심어를 위한 <strong>만 사용할 수 있고 A. 접두어는 넣지 않습니다.

반드시 다음 형태의 JSON 객체만 반환하세요:
{"summary":"","bodyHtml":"","faq":[{"question":"","answer":""}]}

승인 원고:
${JSON.stringify(input)}
` }], {
    maxOutputTokens: AI_OUTPUT_LIMITS.styleRevision,
    timeoutMs: 60_000,
    attempts: 1,
    jsonAttempts: 1,
  });
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
  if (nextLength < minimumStyleRevisionBodyLength(item.format, originalLength)) {
    throw new Error("본문이 원문보다 지나치게 짧아졌습니다.");
  }
  if (nextLength > Math.ceil(originalLength * 1.25)) {
    throw new Error("본문이 원문보다 지나치게 길어졌습니다.");
  }
  const result = {
    ...generated,
    summary: restoredSummary,
    bodyHtml: restoredBody,
    faq: restoredFaq,
  };
  const issues = editorialPublicationIssues(item.format, result);
  if (issues.length) throw new Error(issues.join(" "));
  return result;
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
    .select("id,channel,format,title,summary,status,published_at,published_url,published_url_normalized,published_account,updated_at,metadata")
    .eq("channel", channel)
    .in("status", [...STYLE_REVISION_PENDING_STATUSES])
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  // 문체 규칙을 한 번 바꾸면 밀린 원고 전체가 대상이 됩니다.
  // 한 번의 실행이 물량 전체를 소진하지 않도록 상한을 두고, 나머지는 다음 실행으로 넘깁니다.
  const allCandidates = ((data || []) as PendingItem[]).filter(shouldRewritePendingStyleItem);
  const candidates = allCandidates.slice(0, AI_BATCH_LIMITS.styleRevisionPerRun);
  const skippedForLimit = allCandidates.length - candidates.length;
  const results = await mapWithConcurrency(candidates, 2, async (item) => {
    try {
      const metadata = item.metadata || {};
      const previousGenerated = metadata.generated as GeneratedContent;
      const inputFingerprint = styleRevisionFingerprint(previousGenerated);
      const existingIssues = editorialPublicationIssues(item.format, previousGenerated);
      const generated = existingIssues.length
        ? await rewriteGenerated(item, previousGenerated)
        : previousGenerated;
      const appliedAt = new Date().toISOString();
      const validation = (metadata.validation || {}) as Record<string, unknown>;
      const { data: updated, error: updateError } = await admin.from("content_work_items").update({
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
          styleRevision: createStyleRevisionStamp(generated, {
            appliedAt,
            appliedBy: approvedBy,
            inputFingerprint,
            previousGenerated,
          }),
        },
        updated_at: appliedAt,
      })
        .eq("id", item.id)
        .eq("status", item.status)
        .eq("updated_at", item.updated_at)
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!updated) {
        throw new Error("원고가 정리되는 동안 다른 변경이 저장되어 현재 작업을 적용하지 않았습니다.");
      }
      return {
        id: item.id,
        title: item.title,
        success: true as const,
        rewritten: existingIssues.length > 0,
      };
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
    /** 이번 실행 상한에 걸려 다음 실행으로 미뤄진 건수 */
    deferred: skippedForLimit,
    updated: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results,
  };
}
