import { contentAdmin } from "@/lib/content-ops/data";
import { validatePortfolioBodyHtml } from "@/lib/content-ops/portfolio-rules";
import { generateGeminiJson } from "./gemini";
import type { GeneratedPortfolioAsset } from "./mockup";
import type { PortfolioVisualReview } from "./visual-review";
import { fetchExistingDesignBlogTitles } from "./naver-blog";

export type PortfolioDraft = {
  title: string;
  summary: string;
  bodyHtml: string;
  faq: { question: string; answer: string }[];
  tags: string[];
  imageCaptions: string[];
};

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDraftHtml(value: string) {
  return value
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(style|class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<(?!\/?(?:h2|h3|p|ul|ol|li|strong|blockquote|a)\b)[^>]+>/gi, "");
}

function figureHtml(asset: GeneratedPortfolioAsset, caption: string) {
  const safeCaption = (caption || asset.caption).replace(/[<>]/g, "");
  return `<figure><img src="${asset.url}" alt="${safeCaption}" /><figcaption>${safeCaption}</figcaption></figure>`;
}

function interleaveFigures(
  bodyHtml: string,
  assets: GeneratedPortfolioAsset[],
  captions: string[],
) {
  if (!assets.length) return bodyHtml;
  const paragraphCount = (bodyHtml.match(/<\/p>/gi) || []).length;
  if (!paragraphCount) {
    return `${bodyHtml}${assets.map((asset, index) => figureHtml(asset, captions[index] || asset.caption)).join("")}`;
  }
  const insertionPoints = new Map<number, string[]>();
  assets.forEach((asset, index) => {
    const point = Math.max(1, Math.min(
      paragraphCount,
      Math.round(((index + 1) * paragraphCount) / (assets.length + 1)),
    ));
    insertionPoints.set(point, [
      ...(insertionPoints.get(point) || []),
      figureHtml(asset, captions[index] || asset.caption),
    ]);
  });
  let seen = 0;
  return bodyHtml.replace(/<\/p>/gi, (close) => {
    seen += 1;
    return `${close}${(insertionPoints.get(seen) || []).join("")}`;
  });
}

function writingPrompt(input: {
  sourceFileName: string;
  review: PortfolioVisualReview;
  existingTitles: string[];
  previousIssues?: string[];
}) {
  return `당신은 기획 전문가가 이끄는 울림컴퍼니의 디자인 포트폴리오 편집자입니다.
실제 완성 문서의 시각 판정만 근거로 네이버 디자인 블로그에 올릴 비공개 검토 초안을 작성하세요.

원본 파일명은 독자에게 노출하지 마세요: ${input.sourceFileName}
문서 유형: ${input.review.documentType}
업종: ${input.review.industry}
프로젝트명 후보: ${input.review.projectTitle}
디자인 해설: ${input.review.designSummary}
확인된 장면:
${JSON.stringify(input.review.slideAssessments)}

기존 초안 제목과 겹치지 않아야 합니다:
${JSON.stringify(input.existingTitles.slice(0, 30))}

작성 원칙:
- 울림의 전문성이 보이되, 전문 용어를 나열하지 말고 고객이 이해하기 쉬운 말로 설명합니다.
- 단순히 "예쁘게 디자인했다"가 아니라 정보의 우선순위, 독자의 읽는 순서, 페이지 간 일관성, 설득 구조를 구체적으로 해설합니다.
- 화면에서 확인할 수 없는 매출·성과·고객 반응·제작 기간·의뢰인의 요구를 만들지 않습니다.
- 공개하기 곤란한 고객명이나 개인정보를 본문에서 반복하지 않습니다.
- 본문은 공백 제외 2,000~3,500자, H2 4개 이상, 필요한 곳에 H3·목록을 사용합니다.
- 이미지 태그는 넣지 않습니다. 시스템이 문단 사이에 완성 목업을 자동 배치합니다.
- FAQ는 실제 의뢰 고객이 물을 법한 질문과 현실적인 답변 4개로 작성합니다.
- 제목에 "포트폴리오", 내부 채널명, 파일명을 기계적으로 붙이지 말고 프로젝트의 기획적 차별점을 드러냅니다.
${input.previousIssues?.length ? `이전 결과의 문제를 반드시 고치세요: ${input.previousIssues.join(", ")}` : ""}

반드시 JSON만 반환하세요:
{
  "title": "",
  "summary": "",
  "bodyHtml": "<h2>...</h2><p>...</p>",
  "faq": [{"question": "", "answer": ""}],
  "tags": [""],
  "imageCaptions": ["메인 콜라주 설명", "목업 2 설명", "목업 3 설명", "목업 4 설명"]
}`;
}

function draftIssues(draft: PortfolioDraft) {
  const bodyHtml = safeDraftHtml(draft.bodyHtml || "");
  const plainLength = clean(bodyHtml).replace(/\s/g, "").length;
  const h2Count = (bodyHtml.match(/<h2[\s>]/gi) || []).length;
  const faqCount = Array.isArray(draft.faq) ? draft.faq.length : 0;
  return {
    bodyHtml,
    plainLength,
    h2Count,
    faqCount,
    issues: [
      ...(plainLength < 2000 ? [`본문이 ${plainLength}자로 짧음`] : []),
      ...(plainLength > 3500 ? [`본문이 ${plainLength}자로 김`] : []),
      ...(h2Count < 4 ? [`H2가 ${h2Count}개뿐임`] : []),
      ...(faqCount < 4 ? [`FAQ가 ${faqCount}개뿐임`] : []),
      ...(!draft.title?.trim() ? ["제목 누락"] : []),
      ...(!draft.summary?.trim() ? ["요약 누락"] : []),
    ],
  };
}

export async function createPortfolioDraft(input: {
  sourceFileName: string;
  review: PortfolioVisualReview;
  assets: GeneratedPortfolioAsset[];
}) {
  const admin = contentAdmin();
  const { data: existing } = await admin.from("content_work_items")
    .select("title")
    .eq("channel", "naver_design")
    .neq("status", "on_hold")
    .order("created_at", { ascending: false })
    .limit(50);
  const blogTitles = await fetchExistingDesignBlogTitles();
  const existingTitles = [...new Set([
    ...(existing || []).map((item) => item.title),
    ...blogTitles,
  ])];

  let generated = await generateGeminiJson<PortfolioDraft>([
    { text: writingPrompt({ sourceFileName: input.sourceFileName, review: input.review, existingTitles }) },
  ], { maxOutputTokens: 14000, timeoutMs: 150_000 });
  let validation = draftIssues(generated);
  if (validation.issues.length) {
    generated = await generateGeminiJson<PortfolioDraft>([
      {
        text: writingPrompt({
          sourceFileName: input.sourceFileName,
          review: input.review,
          existingTitles,
          previousIssues: validation.issues,
        }),
      },
    ], { maxOutputTokens: 16000, timeoutMs: 150_000 });
    validation = draftIssues(generated);
  }

  const bodyAssets = input.assets.filter((asset) => asset.kind === "body_image");
  const bodyHtml = interleaveFigures(
    validation.bodyHtml,
    bodyAssets,
    generated.imageCaptions || [],
  );
  const portfolioIssues = validatePortfolioBodyHtml(bodyHtml);
  const issues = [...validation.issues, ...portfolioIssues];
  return {
    draft: {
      ...generated,
      title: generated.title.trim(),
      summary: generated.summary.trim(),
      bodyHtml,
      faq: (generated.faq || []).slice(0, 6),
      tags: (generated.tags || []).map(String).slice(0, 12),
      imageCaptions: (generated.imageCaptions || []).map(String).slice(0, bodyAssets.length),
    },
    validation: {
      plainLength: validation.plainLength,
      h2Count: validation.h2Count,
      faqCount: validation.faqCount,
      figureCount: bodyAssets.length,
      issues,
    },
  };
}
