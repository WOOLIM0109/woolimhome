import sharp from "sharp";
import { contentAdmin } from "@/lib/content-ops/data";
import {
  fingerprintPortfolioImage,
  perceptualHashDistance,
} from "./image-fingerprint";
import { selectPortfolioSlides } from "./slide-selection";
import type { PortfolioVisualReview, SlideAssessment } from "./visual-review";
import {
  scoreLocalVisualMetrics,
  type LocalVisualMetrics,
} from "./local-visual-score";
import { classifyPortfolioClientCategoryFromSourceHint } from "./client-category";

type LocalSlideAnalysis = LocalVisualMetrics & {
  slideIndex: number;
  visualHash: string;
};

function clampScore(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function genericDocumentContext(sourceHint: string) {
  const source = sourceHint.normalize("NFKC").toLocaleLowerCase("ko-KR");
  const clientCategory: NonNullable<PortfolioVisualReview["clientCategory"]> =
    classifyPortfolioClientCategoryFromSourceHint(sourceHint);
  const industry = /관광|여행/.test(source)
    ? "관광마케팅"
    : /연구|r&d|바이오|기술개발|스마트팜/.test(source)
      ? "연구개발"
      : /인사|hr|노무|일터혁신/.test(source)
        ? "인사·HR"
        : /뷰티|화장품|미용/.test(source)
          ? "뷰티"
          : /반려|펫|동물/.test(source)
            ? "반려동물"
            : /무역|수출|해외/.test(source)
              ? "해외 무역"
              : /교육|학교/.test(source)
                ? "교육"
                : /경영|컨설팅/.test(source)
                  ? "경영컨설팅"
                  : "비즈니스";
  const documentType = /사업계획/.test(source)
    ? "사업계획서"
    : /회사소개|브랜드소개/.test(source)
      ? "회사소개서"
      : /제품소개/.test(source)
        ? "제품소개서"
        : /입찰/.test(source)
          ? "입찰제안서"
          : /제안/.test(source)
            ? "제안서"
            : /발표|프레젠테이션/.test(source)
              ? "발표자료"
              : /ir/.test(source)
                ? "IR 자료"
                : "비즈니스 문서";
  return { clientCategory, industry, documentType };
}

async function analyzeLocalSlide(
  bucket: string,
  path: string,
  slideIndex: number,
): Promise<LocalSlideAnalysis> {
  const { data, error } = await contentAdmin().storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message || `슬라이드 ${slideIndex + 1}을 읽지 못했습니다.`);
  const source = Buffer.from(await data.arrayBuffer());
  const [fingerprint, normalized] = await Promise.all([
    fingerprintPortfolioImage(source),
    sharp(source)
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: 320, height: 240, fit: "contain", background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  const { width, height, channels } = normalized.info;
  const pixels = normalized.data;
  const luminance = new Float32Array(width * height);
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let colored = 0;
  let occupied = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    const red = pixels[offset];
    const green = pixels[offset + Math.min(1, channels - 1)];
    const blue = pixels[offset + Math.min(2, channels - 1)];
    const value = red * 0.299 + green * 0.587 + blue * 0.114;
    luminance[index] = value;
    luminanceSum += value;
    luminanceSquaredSum += value * value;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 18 && value < 248) colored += 1;
    if (value < 246) occupied += 1;
  }
  let edgeSum = 0;
  let edgePairs = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (column + 1 < width) {
        edgeSum += Math.abs(luminance[index] - luminance[index + 1]);
        edgePairs += 1;
      }
      if (row + 1 < height) {
        edgeSum += Math.abs(luminance[index] - luminance[index + width]);
        edgePairs += 1;
      }
    }
  }
  const count = Math.max(1, width * height);
  const average = luminanceSum / count;
  return {
    slideIndex,
    visualHash: fingerprint.visualHash,
    edgeDensity: edgePairs ? edgeSum / edgePairs / 255 : 0,
    colorRatio: colored / count,
    occupiedRatio: occupied / count,
    contrast: Math.sqrt(Math.max(0, luminanceSquaredSum / count - average * average)),
  };
}

function localRarity(slide: LocalSlideAnalysis, slides: LocalSlideAnalysis[]) {
  const distances = slides
    .filter((candidate) => candidate.slideIndex !== slide.slideIndex)
    .map((candidate) => perceptualHashDistance(slide.visualHash, candidate.visualHash))
    .sort((left, right) => left - right);
  const neighborhood = distances.slice(0, Math.min(4, distances.length));
  const averageDistance = neighborhood.length
    ? neighborhood.reduce((sum, value) => sum + value, 0) / neighborhood.length
    : 16;
  return clampScore((averageDistance / 24) * 100);
}

function localAssessment(slide: LocalSlideAnalysis, slides: LocalSlideAnalysis[]): SlideAssessment {
  const rarity = localRarity(slide, slides);
  const scores = scoreLocalVisualMetrics(slide, rarity);
  const total = scores.diagramRichness * 0.4
    + scores.visualQuality * 0.3
    + scores.rarity * 0.2
    + 5;
  const recommended = slide.slideIndex > 0 && total >= 43;
  return {
    slideIndex: slide.slideIndex,
    role: slide.slideIndex === 0 ? "표지" : "본문 시각 구성",
    quality: scores.visualQuality,
    recommended,
    reason: recommended
      ? "로컬 이미지 분석에서 도식 밀도·시각 균형·희소성이 우수한 장표입니다."
      : "반복·저밀도 가능성을 낮게 평가해 보조 후보로 분류했습니다.",
    ...scores,
    visualSignature: `local:${slide.visualHash}`,
    visualHash: slide.visualHash,
  };
}

export async function createLocalPortfolioReview(input: {
  bucket: string;
  slidePaths: string[];
  sourceHint?: string;
}): Promise<PortfolioVisualReview> {
  const analyses: LocalSlideAnalysis[] = [];
  const concurrency = 6;
  for (let offset = 0; offset < input.slidePaths.length; offset += concurrency) {
    const batch = input.slidePaths.slice(offset, offset + concurrency);
    analyses.push(...await Promise.all(batch.map((path, index) => (
      analyzeLocalSlide(input.bucket, path, offset + index)
    ))));
  }
  const assessments = analyses.map((slide) => localAssessment(slide, analyses));
  const selection = selectPortfolioSlides({
    slideCount: input.slidePaths.length,
    assessments,
  });
  const context = genericDocumentContext(input.sourceHint || "");
  return {
    suitable: input.slidePaths.length >= 5,
    confidence: 0.82,
    documentType: context.documentType,
    industry: context.industry,
    clientCategory: context.clientCategory,
    projectTitle: `${context.industry} ${context.documentType}`,
    designSummary: "로컬 이미지 분석으로 도식 밀도, 시각적 완성도, 희소성, 문서 구간 다양성을 비교했습니다.",
    reasons: [
      "Gemini와 무관한 로컬 이미지 지표로 장표를 선정했습니다.",
      "유사한 화면은 지문 비교로 제외하고 문서 전 구간을 고르게 반영했습니다.",
    ],
    rejectionReasons: input.slidePaths.length >= 5 ? [] : ["포트폴리오 제작에 필요한 장표가 5장 미만입니다."],
    slideAssessments: assessments,
    recommendedSlideIndexes: selection.selectedSlideIndexes,
    sensitiveRegions: [],
    selection,
  };
}
