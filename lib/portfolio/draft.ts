import { contentAdmin } from "@/lib/content-ops/data";
import { FRIENDLY_EDITORIAL_STYLE_RULES } from "@/lib/content-ops/editorial-style";
import { validatePortfolioBodyHtml } from "@/lib/content-ops/portfolio-rules";
import { generateGeminiJson } from "./gemini";
import type { GeneratedPortfolioAsset } from "./mockup";
import type { PortfolioVisualReview } from "./visual-review";
import { fetchExistingDesignBlogTitles } from "./naver-blog";
import { sanitizeGeneratedHtml, sanitizeInlineHtml } from "@/lib/security/html";

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
  return sanitizeGeneratedHtml(value);
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
    const remainingAssets = assets.length - index - 1;
    const idealPoint = Math.round(((index + 1) * paragraphCount) / (assets.length + 1));
    const previousPoint = [...insertionPoints.keys()].at(-1) || 0;
    const latestAllowedPoint = Math.max(1, paragraphCount - remainingAssets);
    const point = Math.max(previousPoint + 1, Math.min(idealPoint, latestAllowedPoint));
    insertionPoints.set(point, [figureHtml(asset, captions[index] || asset.caption)]);
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
- 원본 파일명, 내부 페이지·슬라이드 번호, 검수용 인덱스, 자동 판정 과정은 절대 노출하지 않습니다.
- 완성작을 깎아내리는 비평, 보완점, 아쉬운 점을 별도 문단으로 만들지 않습니다. 확인된 강점과 울림의 기획 의도를 중심으로 설명합니다.
- "모범적", "완벽한", "압도적", "훌륭한" 같은 근거 없는 자화자찬을 줄이고, 화면에서 확인되는 구체적인 구성으로 전문성을 보여줍니다.
- 본문은 공백 제외 2,800~3,500자를 목표로 하며, 절대 2,500자 아래로 쓰지 않습니다.
- H2는 5개 이상 사용하고, 각 H2 아래에 서로 다른 관점의 설명 문단을 최소 2개씩 작성해 전체 문단을 12개 이상으로 구성합니다.
- 다량 문서의 강점은 한 장의 화려함보다 수십 페이지에 걸친 정보 구조, 반복 원칙, 구간별 변주와 읽는 흐름에 있습니다. 이 점을 구체적으로 해설합니다.
- 이미지 태그는 넣지 않습니다. 시스템이 문단 사이에 완성 목업을 자동 배치합니다.
- FAQ는 실제 의뢰 고객이 물을 법한 질문과 현실적인 답변 4개로 작성합니다.
- 제목에 "포트폴리오", 내부 채널명, 파일명을 기계적으로 붙이지 말고 프로젝트의 기획적 차별점을 드러냅니다.
${FRIENDLY_EDITORIAL_STYLE_RULES}
${input.previousIssues?.length ? `이전 결과의 문제를 반드시 고치세요: ${input.previousIssues.join(", ")}
이번에는 같은 내용을 반복하지 말고 각 구간의 정보 우선순위·그리드·색상·도표·페이지 흐름을 더 구체적으로 설명하여 공백 제외 2,800자 이상인지 확인한 뒤 반환하세요.` : ""}

반드시 JSON만 반환하세요:
{
  "title": "",
  "summary": "",
  "bodyHtml": "<h2>...</h2><p>...</p>",
  "faq": [{"question": "", "answer": ""}],
  "tags": [""],
  "imageCaptions": ["도입부 다중 페이지 설명", "초반부 다중 페이지 설명", "중반부 다중 페이지 설명", "전략 구간 다중 페이지 설명", "후반부 다중 페이지 설명"]
}`;
}

function draftIssues(draft: PortfolioDraft) {
  const bodyHtml = safeDraftHtml(draft.bodyHtml || "");
  const plainLength = clean(bodyHtml).replace(/\s/g, "").length;
  const h2Count = (bodyHtml.match(/<h2[\s>]/gi) || []).length;
  const paragraphCount = (bodyHtml.match(/<p[\s>]/gi) || []).length;
  const faqCount = Array.isArray(draft.faq) ? draft.faq.length : 0;
  const internalReferenceCount = (
    clean(bodyHtml).match(/(?:slide|슬라이드|page|페이지)\s*(?:no\.?\s*)?\d+/gi) || []
  ).length;
  return {
    bodyHtml,
    plainLength,
    h2Count,
    paragraphCount,
    faqCount,
    issues: [
      ...(plainLength < 2500 ? [`본문이 ${plainLength}자로 짧음`] : []),
      ...(plainLength > 3500 ? [`본문이 ${plainLength}자로 김`] : []),
      ...(h2Count < 5 ? [`H2가 ${h2Count}개뿐임`] : []),
      ...(paragraphCount < 12 ? [`설명 문단이 ${paragraphCount}개뿐임`] : []),
      ...(faqCount < 4 ? [`FAQ가 ${faqCount}개뿐임`] : []),
      ...(internalReferenceCount ? [`내부 슬라이드·페이지 번호가 ${internalReferenceCount}곳 노출됨`] : []),
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

  let generated: PortfolioDraft | null = null;
  let validation: ReturnType<typeof draftIssues> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    generated = await generateGeminiJson<PortfolioDraft>([
      {
        text: writingPrompt({
          sourceFileName: input.sourceFileName,
          review: input.review,
          existingTitles,
          previousIssues: validation?.issues,
        }),
      },
    ], { maxOutputTokens: attempt ? 20000 : 18000, timeoutMs: 150_000 });
    validation = draftIssues(generated);
    if (!validation.issues.length) break;
  }
  if (!generated || !validation) throw new Error("포트폴리오 본문 생성 결과가 비어 있습니다.");

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
      faq: (generated.faq || []).slice(0, 6).map((faq) => ({
        question: sanitizeInlineHtml(faq.question || ""),
        answer: sanitizeInlineHtml(faq.answer || ""),
      })),
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
