import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { editorialPublicationIssues } from "@/lib/content-ops/editorial-policy";
import type { GeneratedContent } from "@/lib/content-ops/generated-content";
import { stripFaqDisplayFormatting } from "@/lib/content-ops/editorial-style";
import { assertSameNumericFacts } from "@/lib/content-ops/protected-markers";
import {
  createStyleRevisionStamp,
  hasPublicationEvidence,
  styleRevisionFingerprint,
  STYLE_REVISION_PENDING_STATUSES,
} from "@/lib/content-ops/style-revision-rules";
import { sanitizeGeneratedHtml, sanitizeInlineHtml } from "@/lib/security/html";

export const maxDuration = 60;

type ManualRevision = {
  channel?: unknown;
  title?: unknown;
  bodyHtml?: unknown;
  faq?: unknown;
};

type PendingItem = {
  id: string;
  channel: string;
  format: string;
  title: string;
  status: string;
  summary: string | null;
  published_at: string | null;
  published_url: string | null;
  published_url_normalized: string | null;
  published_account: string | null;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
    apos: "'",
  };
  return value
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39|apos);/gi, (entity) => named[entity.slice(1, -1).toLowerCase()] || entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function plainText(value: string) {
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function plainLength(value: string) {
  return plainText(value).replace(/\s/g, "").length;
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return decodeHtmlEntities(match?.[2] || "");
}

function structuralParts(value: string) {
  const headings = [...value.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => `${match[1]}:${plainText(match[2])}`);
  const images = [...value.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => `${attribute(match[0], "src")}|${attribute(match[0], "alt")}`);
  const captions = [...value.matchAll(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi)]
    .map((match) => plainText(match[1]));
  const links = [...value.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => `${attribute(match[0], "href")}|${plainText(match[1])}`);
  return { headings, images, captions, links };
}

function structuralMismatch(original: string, revised: string) {
  const expected = structuralParts(original);
  const received = structuralParts(revised);
  for (const key of ["headings", "images", "captions", "links"] as const) {
    const count = Math.max(expected[key].length, received[key].length);
    for (let index = 0; index < count; index += 1) {
      if (expected[key][index] !== received[key][index]) {
        return {
          key,
          index,
          expected: expected[key][index] || "(없음)",
          received: received[key][index] || "(없음)",
        };
      }
    }
  }
  return null;
}

function removeDisplayBreaks(value: string) {
  return value.replace(/(?:\s*<br\s*\/?\s*>\s*)+/gi, " ");
}

function normalizedFaq(value: unknown) {
  if (!Array.isArray(value)) return null;
  const entries = value.map((raw) => {
    const entry = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (typeof entry.question !== "string" || typeof entry.answer !== "string") return null;
    return {
      question: sanitizeInlineHtml(stripFaqDisplayFormatting(entry.question)).trim(),
      answer: sanitizeInlineHtml(stripFaqDisplayFormatting(entry.answer)).trim(),
    };
  });
  return entries.every(Boolean) ? entries as { question: string; answer: string }[] : null;
}

async function applyRevision(raw: ManualRevision, approvedBy: string) {
  if (typeof raw.channel !== "string" || typeof raw.title !== "string" || typeof raw.bodyHtml !== "string") {
    throw new Error("채널, 제목, 본문이 필요합니다.");
  }
  const faq = normalizedFaq(raw.faq);
  if (!faq) throw new Error(`${raw.title}: FAQ 형식이 올바르지 않습니다.`);

  const admin = contentAdmin();
  const { data, error } = await admin.from("content_work_items")
    .select("id,channel,format,title,status,summary,published_at,published_url,published_url_normalized,published_account,updated_at,metadata")
    .eq("channel", raw.channel)
    .eq("title", raw.title)
    .in("status", [...STYLE_REVISION_PENDING_STATUSES])
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(`${raw.title}: 수정 가능한 미발행 원고를 찾지 못했습니다.`);
  if (data.length !== 1) throw new Error(`${raw.title}: 같은 제목의 미발행 원고가 여러 개입니다.`);

  const item = data[0] as PendingItem;
  if (hasPublicationEvidence(item)) throw new Error(`${raw.title}: 발행 증거가 있어 수정하지 않았습니다.`);
  const metadata = item.metadata || {};
  const original = metadata.generated as GeneratedContent | undefined;
  if (!original?.bodyHtml || !Array.isArray(original.faq)) {
    throw new Error(`${raw.title}: 기존 본문 또는 FAQ가 없습니다.`);
  }
  if (faq.length !== original.faq.length) {
    throw new Error(`${raw.title}: FAQ 개수를 바꿀 수 없습니다.`);
  }

  const bodyHtml = removeDisplayBreaks(sanitizeGeneratedHtml(raw.bodyHtml)).trim();
  const mismatch = structuralMismatch(sanitizeGeneratedHtml(original.bodyHtml), bodyHtml);
  if (mismatch) {
    throw new Error(
      `${raw.title}: 제목 구조, 이미지, 캡션 또는 링크가 원문과 달라졌습니다. `
      + `${mismatch.key}[${mismatch.index}] 원문=${JSON.stringify(mismatch.expected)} `
      + `수정=${JSON.stringify(mismatch.received)}`,
    );
  }
  const originalFacts = [
    item.summary || original.summary || "",
    original.bodyHtml,
    ...original.faq.flatMap((entry) => [entry.question, entry.answer]),
  ].join("\n");
  const revisedFacts = [
    item.summary || original.summary || "",
    bodyHtml,
    ...faq.flatMap((entry) => [entry.question, entry.answer]),
  ].join("\n");
  assertSameNumericFacts(originalFacts, revisedFacts);

  const originalLength = plainLength(original.bodyHtml);
  const revisedLength = plainLength(bodyHtml);
  if (revisedLength < Math.floor(originalLength * 0.8) || revisedLength > Math.ceil(originalLength * 1.1)) {
    throw new Error(`${raw.title}: 본문 변경 폭이 안전 범위를 벗어났습니다.`);
  }

  const generated: GeneratedContent = { ...original, bodyHtml, faq };
  const issues = editorialPublicationIssues(item.format, generated);
  if (issues.length) throw new Error(`${raw.title}: ${issues.join(" ")}`);

  const appliedAt = new Date().toISOString();
  const validation = metadata.validation && typeof metadata.validation === "object"
    ? metadata.validation as Record<string, unknown>
    : {};
  const { data: updated, error: updateError } = await admin.from("content_work_items").update({
    summary: generated.summary || item.summary || "",
    metadata: {
      ...metadata,
      generated,
      validation: {
        ...validation,
        plainLength: revisedLength,
        h2Count: (bodyHtml.match(/<h2[\s>]/gi) || []).length,
        faqCount: faq.length,
        issues: [],
      },
      styleRevision: createStyleRevisionStamp(generated, {
        appliedAt,
        appliedBy: approvedBy,
        method: "manual-editorial-maintenance",
        inputFingerprint: styleRevisionFingerprint(original),
      }),
    },
    updated_at: appliedAt,
  })
    .eq("id", item.id)
    .eq("status", item.status)
    .eq("updated_at", item.updated_at)
    .select("id,title")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!updated) throw new Error(`${raw.title}: 저장 직전 다른 변경이 있어 원문을 유지했습니다.`);
  return updated;
}

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const revisions = Array.isArray(body?.revisions) ? body.revisions as ManualRevision[] : [];
  if (!revisions.length || revisions.length > 12) {
    return NextResponse.json({ error: "수정 원고는 1~12건이어야 합니다." }, { status: 400 });
  }

  const results = [];
  for (const revision of revisions) {
    try {
      const updated = await applyRevision(revision, user.email || "admin");
      results.push({ title: updated.title, success: true });
    } catch (error) {
      results.push({
        title: typeof revision.title === "string" ? revision.title : "제목 없음",
        success: false,
        error: error instanceof Error ? error.message : "수동 교정 실패",
      });
    }
  }
  return NextResponse.json({
    updated: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results,
  });
}
