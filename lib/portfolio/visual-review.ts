import sharp from "sharp";
import { contentAdmin } from "@/lib/content-ops/data";
import { generateGeminiJson } from "./gemini";

export type SensitiveRegion = {
  slideIndex: number;
  type: "contact" | "address" | "registration_number" | "person_name" | "personal_information"
    | "body_text" | "embedded_photo" | "logo" | "footer";
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

function normalizedRegion(region: SensitiveRegion, slideCount: number) {
  const slideIndex = Number(region.slideIndex);
  const x = Math.max(0, Math.min(1, Number(region.x || 0)));
  const y = Math.max(0, Math.min(1, Number(region.y || 0)));
  const width = Math.max(0, Math.min(1 - x, Number(region.width || 0)));
  const height = Math.max(0, Math.min(1 - y, Number(region.height || 0)));
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slideCount) return null;
  if (width < 0.008 || height < 0.006) return null;
  return {
    ...region,
    slideIndex,
    x,
    y,
    width,
    height,
  };
}

function uniqueRegions(regions: SensitiveRegion[]) {
  const seen = new Set<string>();
  return regions.filter((region) => {
    const key = [
      region.slideIndex,
      region.type,
      Math.round(region.x * 500),
      Math.round(region.y * 500),
      Math.round(region.width * 500),
      Math.round(region.height * 500),
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function detectConfidentialRegions(input: {
  bucket: string;
  slidePaths: string[];
  indexes: number[];
}) {
  const indexes = [...new Set(input.indexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < input.slidePaths.length);
  // Two slides per request keeps dense proposal pages below the model's JSON
  // output limit. Four-slide batches can be truncated before the closing brace.
  const batchSize = 2;
  if (indexes.length > batchSize) {
    const batches = Array.from(
      { length: Math.ceil(indexes.length / batchSize) },
      (_, batchIndex) => indexes.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
    );
    const combined: SensitiveRegion[] = [];
    const concurrentBatches = 2;
    for (let offset = 0; offset < batches.length; offset += concurrentBatches) {
      const wave = await Promise.all(batches
        .slice(offset, offset + concurrentBatches)
        .map((batch) => detectConfidentialRegions({ ...input, indexes: batch })));
      combined.push(...wave.flat());
    }
    return uniqueRegions(combined);
  }

  const regions: SensitiveRegion[] = [];
  for (let offset = 0; offset < indexes.length; offset += batchSize) {
    const batch = indexes.slice(offset, offset + batchSize);
    const parts = await Promise.all(batch.map(async (index) => [
      { text: `분석 대상 슬라이드: 실제 인덱스 ${index}` },
      await imagePart(input.bucket, input.slidePaths[index]),
    ]));
    let result: { regions: SensitiveRegion[] };
    try {
      result = await generateGeminiJson<{ regions: SensitiveRegion[] }>([
      {
        text: `당신은 기밀 비즈니스 문서의 정밀 비식별화 편집자입니다.
제공된 슬라이드에서 디자인 레이아웃은 최대한 보존하고, 공개하면 안 되는 세부 내용과 삽입 사진만 블러 처리할 직사각형 좌표를 찾으세요.

반드시 블러할 대상:
- 소제목 아래에 이어지는 작은 본문, 설명문, 각주, 상세 조건, 수치 설명, 표 안의 작은 셀 내용
- 실제 인물·제품·장소·시설·행사 사진, 화면 캡처, 영상 캡처 등 삽입된 사진 이미지
- 전화번호, 이메일, 주소, 등록번호, 개인 이름 등 개인 식별정보
- 표지와 내지에 있는 모든 회사·기관·사업 로고 및 심벌. 좌측 상단, 중앙 하단, 좌우측 하단, 여러 로고가 나란히 배치된 영역도 각각 빠짐없이 찾으세요.
- 내지 하단의 바닥글 문구, 저작권·기관명·문서명·쪽번호 등 푸터 정보. 디자인 선이나 여백 전체가 아니라 실제 글자와 마크가 있는 부분만 찾으세요.

반드시 남겨 둘 대상:
- 표지 제목, 페이지 제목, 장·절 제목, 큰 소제목
- 타이포그래피 크기 차이로 디자인 효과를 준 큰 숫자·핵심어·짧은 강조 문구
- 일반 아이콘, 일러스트, 도형, 선, 화살표, 컬러 블록, 표의 선과 그리드, 다이어그램 구조

좌표 규칙:
- 슬라이드 전체를 한 번에 가리지 마세요.
- 한 열이나 한 카드 전체가 아니라 실제 작은 글줄 또는 사진의 경계에 최대한 밀착한 사각형을 각각 기록하세요.
- 큰 제목 위에 사진이 겹쳐 있으면 사진 영역을 여러 사각형으로 나누어 제목 글자는 피하세요.
- 서로 떨어진 글이나 사진은 반드시 별도 영역으로 나누세요.
- 좌표는 각 이미지 전체를 기준으로 0~1 사이 x,y,width,height입니다.
- 작은 본문은 type="body_text", 삽입 사진은 type="embedded_photo"로 기록하세요.
- 회사·기관·사업 로고와 심벌은 type="logo", 하단 바닥글과 쪽번호는 type="footer"로 기록하세요.
- 개인 식별정보는 contact, address, registration_number, person_name, personal_information 중 맞는 type을 사용하세요.
- 큰 제목과 디자인 효과용 타이포그래피를 가리는 영역은 반환하지 마세요.

반드시 아래 JSON 모양만 반환하세요.
{
  "regions": [
    {"slideIndex": 0, "type": "body_text", "label": "작은 설명문", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.08}
  ]
}`,
      },
      ...parts.flat(),
      ], { maxOutputTokens: 16000, timeoutMs: 120_000 });
    } catch (error) {
      if (batch.length === 1) throw error;
      const fallback = await Promise.all(batch.map((index) => detectConfidentialRegions({
        ...input,
        indexes: [index],
      })));
      regions.push(...fallback.flat());
      continue;
    }
    regions.push(...(result.regions || []));
  }
  const allowed = new Set(indexes);
  return uniqueRegions(regions
    .map((region) => normalizedRegion(region, input.slidePaths.length))
    .filter((region): region is SensitiveRegion => Boolean(region))
    .filter((region) => allowed.has(region.slideIndex)));
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
    .map((region) => normalizedRegion(region, slideCount))
    .filter((region): region is SensitiveRegion => Boolean(region));
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
