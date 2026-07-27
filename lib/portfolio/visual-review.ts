import sharp from "sharp";
import { contentAdmin } from "@/lib/content-ops/data";
import { generateGeminiJson } from "./gemini";

export type SensitiveRegion = {
  slideIndex: number;
  type: "contact" | "address" | "registration_number" | "person_name" | "personal_information";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SlideAssessment = {
  slideIndex: number;
  role: string;
  quality: number;
  recommended: boolean;
  reason: string;
};

export type PortfolioVisualReview = {
  suitable: boolean;
  confidence: number;
  documentType: string;
  industry: string;
  projectTitle: string;
  designSummary: string;
  reasons: string[];
  rejectionReasons: string[];
  slideAssessments: SlideAssessment[];
  recommendedSlideIndexes: number[];
  sensitiveRegions: SensitiveRegion[];
};

function samplingIndexes(length: number) {
  if (length <= 6) return Array.from({ length }, (_, index) => index);
  const values = [0, 1, Math.floor(length * 0.35), Math.floor(length * 0.6), length - 2, length - 1];
  return [...new Set(values)].filter((index) => index >= 0 && index < length);
}

async function imagePart(bucket: string, path: string) {
  const { data, error } = await contentAdmin().storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message || "검토 이미지를 읽지 못했습니다.");
  const input = Buffer.from(await data.arrayBuffer());
  const normalized = await sharp(input)
    .rotate()
    .resize({ width: 1280, height: 900, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { inlineData: { mimeType: "image/jpeg", data: normalized.toString("base64") } } as const;
}

function normalizeReview(review: PortfolioVisualReview, slideCount: number) {
  const indexes = [...new Set((review.recommendedSlideIndexes || [])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value < slideCount))];
  review.confidence = Math.max(0, Math.min(1, Number(review.confidence || 0)));
  review.recommendedSlideIndexes = indexes.slice(0, 8);
  review.reasons = (review.reasons || []).map(String).slice(0, 6);
  review.rejectionReasons = (review.rejectionReasons || []).map(String).slice(0, 6);
  review.slideAssessments = (review.slideAssessments || []).filter((slide) =>
    Number.isInteger(Number(slide.slideIndex))
    && Number(slide.slideIndex) >= 0
    && Number(slide.slideIndex) < slideCount);
  review.sensitiveRegions = (review.sensitiveRegions || []).filter((region) =>
    Number.isInteger(Number(region.slideIndex))
    && Number(region.slideIndex) >= 0
    && Number(region.slideIndex) < slideCount)
    .map((region) => ({
      ...region,
      slideIndex: Number(region.slideIndex),
      x: Math.max(0, Math.min(1, Number(region.x || 0))),
      y: Math.max(0, Math.min(1, Number(region.y || 0))),
      width: Math.max(0, Math.min(1, Number(region.width || 0))),
      height: Math.max(0, Math.min(1, Number(region.height || 0))),
    }));
  return review;
}

export async function reviewPortfolioSlides(input: {
  bucket: string;
  slidePaths: string[];
  sourceFileName: string;
  sourcePath?: string;
}) {
  const indexes = samplingIndexes(input.slidePaths.length);
  const parts = await Promise.all(indexes.map(async (index) => [
    { text: `검토 이미지 ${indexes.indexOf(index) + 1}: 실제 슬라이드 인덱스 ${index}` },
    await imagePart(input.bucket, input.slidePaths[index]),
  ]));

  const review = await generateGeminiJson<PortfolioVisualReview>([
    {
      text: `당신은 울림컴퍼니 디자인 포트폴리오의 엄격한 편집장입니다.
파일명: ${input.sourceFileName}
원본 경로: ${input.sourcePath || ""}
전체 페이지 수: ${input.slidePaths.length}

뒤에 제공하는 표본 이미지를 실제로 보고 네이버 디자인 블로그 포트폴리오로 쓸 만한 완성 프로젝트인지 판정하세요.

적합 조건:
- 일반적인 가로형 PPT·제안서·회사소개서·제품소개서·IR·사업계획서 등 완성된 비즈니스 문서다.
- 최소 5페이지이고, 서로 다른 내용과 정보 구조를 보여준다.
- 디자인 완성도와 기획 구조를 설명할 장면이 4개 이상 있다.
- 신청서·공고·양식·제출서류·웹 상세페이지를 단순히 PPT에 담은 문서가 아니다.
- 같은 포맷이 반복되는 페이지만으로 구성되지 않았다.

개인정보 처리:
- 전화번호, 이메일, 상세 주소, 사업자·법인 등록번호, 팀원 또는 담당자 실명, 그 밖의 개인 식별정보만 sensitiveRegions에 기록한다.
- 회사명·브랜드명·제품명은 기본적으로 가리지 않는다.
- 좌표는 해당 슬라이드 전체를 기준으로 0~1 사이 x,y,width,height로 기록한다.

반드시 아래 모양의 JSON만 반환하세요.
{
  "suitable": true,
  "confidence": 0.0,
  "documentType": "",
  "industry": "",
  "projectTitle": "",
  "designSummary": "",
  "reasons": [""],
  "rejectionReasons": [""],
  "slideAssessments": [
    {"slideIndex": 0, "role": "표지", "quality": 0, "recommended": true, "reason": ""}
  ],
  "recommendedSlideIndexes": [0,1,2,3],
  "sensitiveRegions": [
    {"slideIndex": 0, "type": "contact", "label": "전화번호", "x": 0, "y": 0, "width": 0, "height": 0}
  ]
}

확신이 부족하거나 표본만으로 적합성을 확인할 수 없으면 suitable=false로 두세요.`,
    },
    ...parts.flat(),
  ], { maxOutputTokens: 6000 });

  return normalizeReview(review, input.slidePaths.length);
}
