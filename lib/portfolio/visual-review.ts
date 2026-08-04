import sharp from "sharp";
import { contentAdmin } from "@/lib/content-ops/data";
import { generateGeminiJson } from "./gemini";
import { selectPortfolioSlides, type SlideSelectionResult } from "./slide-selection";
import {
  PortfolioCheckpointYield,
  yieldPortfolioCheckpointIfNeeded,
} from "./checkpoint";
import { fingerprintPortfolioImage } from "./image-fingerprint";
import { GeminiRequestError } from "@/lib/gemini/client";

export type SensitiveRegion = {
  slideIndex: number;
  type: "contact" | "address" | "registration_number" | "person_name" | "personal_information"
    | "body_text" | "small_text" | "table_content" | "chart_label"
    | "embedded_photo" | "screenshot" | "logo" | "footer"
    | "client_identifier" | "project_identifier";
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
  diagramRichness?: number;
  visualQuality?: number;
  rarity?: number;
  textDensity?: number;
  diagramTypes?: string[];
  visualSignature?: string;
  visualHash?: string;
};

export type SensitiveSlideAudit = {
  slideIndex: number;
  hasSmallOrMediumText: boolean;
  hasEmbeddedVisual: boolean;
  hasLogoOrIdentifier: boolean;
  complete: boolean;
};

export type ConfidentialDetectionResult = {
  regions: SensitiveRegion[];
  audits: SensitiveSlideAudit[];
};

export type PortfolioVisualReview = {
  suitable: boolean;
  confidence: number;
  documentType: string;
  industry: string;
  clientCategory?: "large_company" | "public_institution" | "general_company" | "unknown";
  projectTitle: string;
  designSummary: string;
  reasons: string[];
  rejectionReasons: string[];
  slideAssessments: SlideAssessment[];
  recommendedSlideIndexes: number[];
  sensitiveRegions: SensitiveRegion[];
  selection?: SlideSelectionResult;
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
    .flatten({ background: "#ffffff" })
    .resize({ width: 160, height: 120, fit: "inside", withoutEnlargement: true })
    .blur(2.6)
    .resize({ width: 320, height: 240, fit: "inside", kernel: sharp.kernel.nearest })
    .jpeg({ quality: 68, mozjpeg: true })
    .toBuffer();
  return { inlineData: { mimeType: "image/jpeg", data: normalized.toString("base64") } } as const;
}

async function assessmentImagePart(bucket: string, path: string) {
  const { data, error } = await contentAdmin().storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message || "장표 평가 이미지를 읽지 못했습니다.");
  const input = Buffer.from(await data.arrayBuffer());
  const [normalized, fingerprint] = await Promise.all([
    sharp(input)
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: 160, height: 120, fit: "inside", withoutEnlargement: true })
      .blur(2.6)
      .resize({ width: 320, height: 240, fit: "inside", kernel: sharp.kernel.nearest })
      .jpeg({ quality: 68, mozjpeg: true })
      .toBuffer(),
    fingerprintPortfolioImage(input),
  ]);
  return {
    part: { inlineData: { mimeType: "image/jpeg", data: normalized.toString("base64") } } as const,
    visualHash: fingerprint.visualHash,
  };
}

function score(value: unknown) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function normalizeAssessment(value: SlideAssessment, slideCount: number): SlideAssessment | null {
  const slideIndex = Number(value.slideIndex);
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slideCount) return null;
  const normalized: SlideAssessment = {
    ...value,
    slideIndex,
    role: String(value.role || "본문"),
    quality: score(value.quality),
    recommended: Boolean(value.recommended),
    reason: String(value.reason || ""),
    diagramRichness: score(value.diagramRichness),
    visualQuality: score(value.visualQuality ?? value.quality),
    rarity: score(value.rarity),
    textDensity: score(value.textDensity),
    diagramTypes: (value.diagramTypes || []).map(String).filter(Boolean).slice(0, 8),
    visualSignature: String(value.visualSignature || "").slice(0, 160),
  };
  return normalized;
}

async function assessPortfolioSlideBatch(input: {
  bucket: string;
  slidePaths: string[];
  indexes: number[];
}) {
  const parts = await Promise.all(input.indexes.map(async (index) => [
    index,
    await assessmentImagePart(input.bucket, input.slidePaths[index]),
  ] as const));
  const result = await generateGeminiJson<{ assessments: SlideAssessment[] }>([
    {
      text: `당신은 비즈니스 PPT 포트폴리오의 아트디렉터입니다.
각 슬라이드는 개인정보 보호를 위해 저해상도 블러 처리되어 있습니다. 글자 내용을 읽거나 고객을 추측하지 말고 도식 구조·구성·색상·정보 위계만 비교해 포트폴리오 본문 목업에 넣을 가치가 있는지 평가하세요.

평가 점수는 모두 0~100입니다.
- diagramRichness: 프로세스, 로드맵, 관계도, 조직도, 지도, 시스템 구성도, 인포그래픽 등 도식의 양과 완성도
- visualQuality: 정렬, 여백, 색상, 위계, 균형을 포함한 전체 디자인 완성도
- rarity: 흔한 목차·표·텍스트 페이지가 아니라 보기 드문 도식과 시각 구성을 사용한 정도
- textDensity: 본문이나 표의 작은 글자가 화면을 차지하는 정도. 텍스트만 많을수록 높게 평가
- quality: 포트폴리오 장면으로서의 종합 완성도

선정 원칙:
- 도식이 많고 멋있게 완성되었거나 보기 드문 도식이 있는 장표를 최우선으로 추천합니다.
- 단순 목차, 간지, 감사 페이지, 텍스트만 많은 페이지, 단순 표, 반복 레이아웃은 추천하지 않습니다.
- diagramTypes에는 실제로 보이는 도식 유형만 짧게 기록합니다.
- visualSignature에는 고객명·기관명·제품명 없이 레이아웃과 도식 구조만 요약합니다.
- reason에는 추천 또는 제외 이유를 한 문장으로 기록합니다.

반드시 아래 JSON 모양만 반환하세요.
{
  "assessments": [
    {
      "slideIndex": 0,
      "role": "기술 로드맵",
      "quality": 90,
      "recommended": true,
      "reason": "단계별 흐름을 독창적인 로드맵으로 정리함",
      "diagramRichness": 95,
      "visualQuality": 91,
      "rarity": 88,
      "textDensity": 35,
      "diagramTypes": ["로드맵", "프로세스"],
      "visualSignature": "가로 단계형 로드맵과 하단 핵심 지표"
    }
  ]
}`,
    },
    ...parts.flatMap(([index, image]) => [
      { text: `평가 대상 실제 슬라이드 인덱스: ${index}` },
      image.part,
    ]),
  ], { maxOutputTokens: 12000, timeoutMs: 55_000, attempts: 1, jsonAttempts: 1 });
  const allowed = new Set(input.indexes);
  const hashes = new Map(parts.map(([index, image]) => [index, image.visualHash]));
  const byIndex = new Map((result.assessments || [])
    .map((value) => normalizeAssessment({
      ...value,
      visualHash: hashes.get(Number(value.slideIndex)),
    }, input.slidePaths.length))
    .filter((value): value is SlideAssessment => value !== null && allowed.has(value.slideIndex))
    .map((value) => [value.slideIndex, value]));
  return input.indexes.map((slideIndex) => byIndex.get(slideIndex) || ({
    slideIndex,
    role: slideIndex === 0 ? "표지" : "본문",
    quality: slideIndex === 0 ? 55 : 0,
    recommended: slideIndex === 0,
    reason: "자동 시각 평가 결과가 없어 후순위로 처리",
    diagramRichness: 0,
    visualQuality: 0,
    rarity: 0,
    textDensity: 100,
    diagramTypes: [],
    visualSignature: `미평가-${slideIndex}`,
    visualHash: hashes.get(slideIndex),
  }));
}

export async function assessAllPortfolioSlides(input: {
  bucket: string;
  slidePaths: string[];
  existingAssessments?: SlideAssessment[];
  onProgress?: (assessments: SlideAssessment[]) => Promise<void> | void;
  shouldYield?: () => boolean;
}) {
  const batchSize = 8;
  const indexes = input.slidePaths.map((_, index) => index);
  const byIndex = new Map<number, SlideAssessment>();
  for (const value of input.existingAssessments || []) {
    const normalized = normalizeAssessment(value, input.slidePaths.length);
    if (normalized) byIndex.set(normalized.slideIndex, normalized);
  }
  const missingIndexes = indexes.filter((index) => !byIndex.has(index));
  const batches = Array.from(
    { length: Math.ceil(missingIndexes.length / batchSize) },
    (_, batchIndex) => missingIndexes.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
  );
  for (let offset = 0; offset < batches.length; offset += 2) {
    yieldPortfolioCheckpointIfNeeded(input.shouldYield);
    const wave = await Promise.all(batches.slice(offset, offset + 2).map((batch) =>
      assessPortfolioSlideBatch({ ...input, indexes: batch })));
    for (const assessment of wave.flat()) byIndex.set(assessment.slideIndex, assessment);
    if (input.onProgress) {
      await input.onProgress([...byIndex.values()].sort((left, right) => left.slideIndex - right.slideIndex));
    }
  }
  return indexes.map((slideIndex) => byIndex.get(slideIndex) || ({
    slideIndex,
    role: slideIndex === 0 ? "표지" : "본문",
    quality: slideIndex === 0 ? 55 : 0,
    recommended: slideIndex === 0,
    reason: "자동 시각 평가 결과가 없어 후순위로 처리",
    diagramRichness: 0,
    visualQuality: 0,
    rarity: 0,
    textDensity: 100,
    diagramTypes: [],
    visualSignature: `미평가-${slideIndex}`,
  }));
}

function normalizedRegion(region: SensitiveRegion, slideCount: number) {
  const slideIndex = Number(region.slideIndex);
  const x = Math.max(0, Math.min(1, Number(region.x || 0)));
  const y = Math.max(0, Math.min(1, Number(region.y || 0)));
  const width = Math.max(0, Math.min(1 - x, Number(region.width || 0)));
  const height = Math.max(0, Math.min(1 - y, Number(region.height || 0)));
  const allowedTypes = new Set<SensitiveRegion["type"]>([
    "contact", "address", "registration_number", "person_name", "personal_information",
    "body_text", "small_text", "table_content", "chart_label", "embedded_photo",
    "screenshot", "logo", "footer", "client_identifier", "project_identifier",
  ]);
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slideCount) return null;
  if (!allowedTypes.has(region.type)) return null;
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

function normalizedAudit(value: SensitiveSlideAudit, slideCount: number): SensitiveSlideAudit | null {
  const slideIndex = Number(value.slideIndex);
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slideCount) return null;
  if (typeof value.hasSmallOrMediumText !== "boolean"
    || typeof value.hasEmbeddedVisual !== "boolean"
    || typeof value.hasLogoOrIdentifier !== "boolean"
    || typeof value.complete !== "boolean") {
    return null;
  }
  return {
    slideIndex,
    hasSmallOrMediumText: value.hasSmallOrMediumText,
    hasEmbeddedVisual: value.hasEmbeddedVisual,
    hasLogoOrIdentifier: value.hasLogoOrIdentifier,
    complete: value.complete,
  };
}

function uniqueAudits(audits: SensitiveSlideAudit[]) {
  const byIndex = new Map<number, SensitiveSlideAudit>();
  audits.forEach((audit) => byIndex.set(audit.slideIndex, audit));
  return [...byIndex.values()].sort((left, right) => left.slideIndex - right.slideIndex);
}

export function confidentialRegionCoverage(regions: SensitiveRegion[], indexes: number[]) {
  const selected = [...new Set(indexes)].filter((value) => Number.isInteger(value) && value >= 0);
  if (!selected.length) {
    return {
      coverage: 0,
      coveredSlides: 0,
      regionCount: 0,
      slideMetrics: [],
      oversizedRegionCount: 0,
    };
  }
  const columns = 50;
  const rows = 32;
  let filledCells = 0;
  let coveredSlides = 0;
  const slideMetrics: Array<{
    slideIndex: number;
    coverage: number;
    regionCount: number;
    hasTextOrIdentifier: boolean;
  }> = [];
  const textOrIdentifierTypes = new Set<SensitiveRegion["type"]>([
    "contact", "address", "registration_number", "person_name", "personal_information",
    "body_text", "small_text", "table_content", "chart_label", "footer",
    "client_identifier", "project_identifier",
  ]);
  for (const slideIndex of selected) {
    const occupied = new Uint8Array(columns * rows);
    const slideRegions = regions.filter((value) => value.slideIndex === slideIndex);
    for (const region of slideRegions) {
      const left = Math.max(0, Math.floor(region.x * columns));
      const top = Math.max(0, Math.floor(region.y * rows));
      const right = Math.min(columns, Math.ceil((region.x + region.width) * columns));
      const bottom = Math.min(rows, Math.ceil((region.y + region.height) * rows));
      for (let row = top; row < bottom; row += 1) {
        for (let column = left; column < right; column += 1) occupied[row * columns + column] = 1;
      }
    }
    const count = occupied.reduce((sum, value) => sum + value, 0);
    if (count) coveredSlides += 1;
    filledCells += count;
    slideMetrics.push({
      slideIndex,
      coverage: count / (columns * rows),
      regionCount: slideRegions.length,
      hasTextOrIdentifier: slideRegions.some((region) => textOrIdentifierTypes.has(region.type)),
    });
  }
  return {
    coverage: filledCells / (selected.length * columns * rows),
    coveredSlides,
    regionCount: regions.filter((value) => selected.includes(value.slideIndex)).length,
    slideMetrics,
    oversizedRegionCount: regions.filter((region) => (
      selected.includes(region.slideIndex) && region.width * region.height > 0.55
    )).length,
  };
}

export function verifyConfidentialRegions(
  regions: SensitiveRegion[],
  indexes: number[],
  audits: SensitiveSlideAudit[] = [],
) {
  const selectedIndexes = [...new Set(indexes)]
    .filter((value) => Number.isInteger(value) && value >= 0);
  const metrics = confidentialRegionCoverage(regions, indexes);
  const requiredCoveredSlides = selectedIndexes.length;
  const auditByIndex = new Map(audits.map((audit) => [audit.slideIndex, audit]));
  const textTypes = new Set<SensitiveRegion["type"]>([
    "body_text", "small_text", "table_content", "chart_label", "footer",
    "contact", "address", "registration_number", "person_name", "personal_information",
    "client_identifier", "project_identifier",
  ]);
  const embeddedVisualTypes = new Set<SensitiveRegion["type"]>(["embedded_photo", "screenshot"]);
  const logoTypes = new Set<SensitiveRegion["type"]>(["logo", "client_identifier", "project_identifier"]);
  const geometryFailedSlideIndexes = metrics.slideMetrics.filter((slide) => {
    const slideRegions = regions.filter((region) => region.slideIndex === slide.slideIndex);
    const audit = auditByIndex.get(slide.slideIndex);
    const geometryPassed = slide.coverage >= 0.025
      && slide.coverage <= 0.72
      && slide.regionCount >= (slide.slideIndex === 0 ? 1 : 2)
      && (slide.slideIndex === 0 || slide.hasTextOrIdentifier);
    const auditPassed = Boolean(
      audit?.complete
      && (!audit.hasSmallOrMediumText || slideRegions.some((region) => textTypes.has(region.type)))
      && (!audit.hasEmbeddedVisual || slideRegions.some((region) => embeddedVisualTypes.has(region.type)))
      && (!audit.hasLogoOrIdentifier || slideRegions.some((region) => logoTypes.has(region.type))),
    );
    return !geometryPassed || !auditPassed;
  }).map((slide) => slide.slideIndex);
  const failed = new Set(geometryFailedSlideIndexes);
  regions.filter((region) => region.width * region.height > 0.55)
    .forEach((region) => failed.add(region.slideIndex));
  if (metrics.coverage < 0.05 || metrics.coverage > 0.65) {
    selectedIndexes.forEach((index) => failed.add(index));
  }
  const failedSlideIndexes = [...failed].sort((left, right) => left - right);
  const slideChecksPassed = failedSlideIndexes.length === 0;
  const verified = selectedIndexes.length > 0
    && metrics.regionCount >= selectedIndexes.length
    && metrics.coveredSlides === requiredCoveredSlides
    && metrics.coverage >= 0.05
    && metrics.coverage <= 0.65
    && metrics.oversizedRegionCount === 0
    && slideChecksPassed;
  return {
    ...metrics,
    failedSlideIndexes,
    verified,
    reason: verified
      ? null
      : `기밀 블러 검증 기준을 충족하지 못했습니다. 영역 ${metrics.regionCount}곳, 적용 장표 ${metrics.coveredSlides}/${indexes.length}, 화면 비율 ${Math.round(metrics.coverage * 100)}%, 과대 영역 ${metrics.oversizedRegionCount}곳`,
  };
}

export async function detectConfidentialRegions(input: {
  bucket: string;
  slidePaths: string[];
  indexes: number[];
  existingRegions?: SensitiveRegion[];
  existingAudits?: SensitiveSlideAudit[];
  completedIndexes?: number[];
  onProgress?: (
    result: ConfidentialDetectionResult,
    completedIndexes: number[],
  ) => Promise<void> | void;
  shouldYield?: () => boolean;
}): Promise<ConfidentialDetectionResult> {
  const requestedIndexes = [...new Set(input.indexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < input.slidePaths.length);
  const requested = new Set(requestedIndexes);
  const existingRegions = uniqueRegions((input.existingRegions || [])
    .map((region) => normalizedRegion(region, input.slidePaths.length))
    .filter((region): region is SensitiveRegion => Boolean(region))
    .filter((region) => requested.has(region.slideIndex)));
  const existingAudits = uniqueAudits((input.existingAudits || [])
    .map((audit) => normalizedAudit(audit, input.slidePaths.length))
    .filter((audit): audit is SensitiveSlideAudit => Boolean(audit))
    .filter((audit) => requested.has(audit.slideIndex)));
  const coveredIndexes = new Set((input.completedIndexes || [])
    .filter((index) => requested.has(index)));
  const indexes = requestedIndexes.filter((index) => !coveredIndexes.has(index));
  if (!indexes.length) return { regions: existingRegions, audits: existingAudits };
  // Two slides per request keeps dense proposal pages below the model's JSON
  // output limit. Four-slide batches can be truncated before the closing brace.
  const batchSize = 2;
  if (indexes.length > batchSize) {
    const batches = Array.from(
      { length: Math.ceil(indexes.length / batchSize) },
      (_, batchIndex) => indexes.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
    );
    const combined: SensitiveRegion[] = [...existingRegions];
    const combinedAudits: SensitiveSlideAudit[] = [...existingAudits];
    const completed = new Set(coveredIndexes);
    const concurrentBatches = 2;
    for (let offset = 0; offset < batches.length; offset += concurrentBatches) {
      yieldPortfolioCheckpointIfNeeded(input.shouldYield);
      const waveBatches = batches.slice(offset, offset + concurrentBatches);
      const wave = await Promise.all(batches
        .slice(offset, offset + concurrentBatches)
        .map((batch) => detectConfidentialRegions({
          bucket: input.bucket,
          slidePaths: input.slidePaths,
          indexes: batch,
          shouldYield: input.shouldYield,
        })));
      wave.forEach((result) => {
        combined.push(...result.regions);
        combinedAudits.push(...result.audits);
      });
      waveBatches.flat().forEach((index) => completed.add(index));
      if (input.onProgress) {
        await input.onProgress({
          regions: uniqueRegions(combined),
          audits: uniqueAudits(combinedAudits),
        }, [...completed].sort((left, right) => left - right));
      }
    }
    return { regions: uniqueRegions(combined), audits: uniqueAudits(combinedAudits) };
  }

  const regions: SensitiveRegion[] = [];
  const audits: SensitiveSlideAudit[] = [];
  for (let offset = 0; offset < indexes.length; offset += batchSize) {
    yieldPortfolioCheckpointIfNeeded(input.shouldYield);
    const batch = indexes.slice(offset, offset + batchSize);
    const parts = await Promise.all(batch.map(async (index) => [
      { text: `분석 대상 슬라이드: 실제 인덱스 ${index}` },
      await imagePart(input.bucket, input.slidePaths[index]),
    ]));
    let result: ConfidentialDetectionResult;
    let independentAudit: { audits?: SensitiveSlideAudit[] };
    try {
      result = await generateGeminiJson<ConfidentialDetectionResult>([
      {
        text: `당신은 기밀 비즈니스 문서의 정밀 비식별화 편집자입니다.
제공된 슬라이드는 외부 전송 전에 저해상도 블러 처리되어 있습니다. 글자 내용을 판독하거나 고객을 추측하지 말고, 보이는 글줄·로고·사진·화면 영역의 형태와 위치를 기준으로 공개하면 안 되는 세부 내용과 삽입 사진을 블러 처리할 직사각형 좌표를 찾으세요.

반드시 블러할 대상:
- 큰 구조적 제목과 큰 핵심 숫자를 제외한 모든 작은 글자와 중간 크기 글자. 본문, 설명문, 각주, 조건, 캡션을 빠짐없이 찾으세요.
- 표·차트·다이어그램 안의 셀 내용, 범례, 축 이름, 세부 수치, 노드 설명 등 읽을 수 있는 세부 문구
- 실제 인물·제품·장소·시설·행사 사진, 렌더링 이미지, 화면·영상 캡처 등 삽입된 모든 래스터 이미지
- 전화번호, 이메일, 주소, 등록번호, 개인 이름 등 개인 식별정보
- 표지와 내지에 있는 모든 회사·기관·사업 로고 및 심벌. 좌측 상단, 중앙 하단, 좌우측 하단, 여러 로고가 나란히 배치된 영역도 각각 빠짐없이 찾으세요.
- 실제 회사명·기관명·브랜드명·사람 이름·기밀 프로젝트명·과제번호는 글씨가 크더라도 반드시 가리세요.
- 내지 하단의 바닥글 문구, 저작권·기관명·문서명·쪽번호 등 푸터 정보. 디자인 선이나 여백 전체가 아니라 실제 글자와 마크가 있는 부분만 찾으세요.

반드시 남겨 둘 대상:
- 표지 제목, 페이지 제목, 장·절 제목, 큰 소제목
- 고객을 식별하지 않는 큰 숫자·핵심어·짧은 강조 문구
- 일반 아이콘, 일러스트, 도형, 선, 화살표, 컬러 블록, 표의 선과 그리드, 다이어그램 구조

좌표 규칙:
- 슬라이드 전체를 한 번에 가리지 마세요.
- 한 열이나 한 카드 전체가 아니라 실제 작은 글줄 또는 사진의 경계에 최대한 밀착한 사각형을 각각 기록하세요.
- 큰 제목 위에 사진이 겹쳐 있으면 사진 영역을 여러 사각형으로 나누어 제목 글자는 피하세요.
- 서로 떨어진 글이나 사진은 반드시 별도 영역으로 나누세요.
- 좌표는 각 이미지 전체를 기준으로 0~1 사이 x,y,width,height입니다.
- 작은 본문은 type="small_text" 또는 type="body_text", 표 안의 내용은 type="table_content", 차트·도식의 작은 문구는 type="chart_label"로 기록하세요.
- 삽입 사진은 type="embedded_photo", 화면 캡처는 type="screenshot"으로 기록하세요.
- 회사·기관·사업 로고와 심벌은 type="logo", 하단 바닥글과 쪽번호는 type="footer"로 기록하세요.
- 실제 회사·기관·브랜드명은 type="client_identifier", 기밀 프로젝트명과 과제번호는 type="project_identifier"로 기록하세요.
- 개인 식별정보는 contact, address, registration_number, person_name, personal_information 중 맞는 type을 사용하세요.
- 큰 제목과 디자인 효과용 타이포그래피를 가리는 영역은 반환하지 마세요.

반드시 아래 JSON 모양만 반환하세요.
{
  "regions": [
    {"slideIndex": 0, "type": "small_text", "label": "작은 설명문", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.08}
  ],
  "audits": [
    {"slideIndex": 0, "hasSmallOrMediumText": true, "hasEmbeddedVisual": false, "hasLogoOrIdentifier": true, "complete": true}
  ]
}
audits에는 요청된 모든 슬라이드를 정확히 한 번씩 넣으세요. 작은·중간 글자, 삽입 사진·화면, 로고·고객 식별자를 각각 끝까지 확인한 경우에만 complete=true로 반환하세요. 해당 요소가 하나라도 보이면 대응하는 has... 값을 반드시 true로 기록하세요.`,
      },
      ...parts.flat(),
      ], { maxOutputTokens: 16000, timeoutMs: 55_000, attempts: 1, jsonAttempts: 1 });
      yieldPortfolioCheckpointIfNeeded(input.shouldYield);
      independentAudit = await generateGeminiJson<{ audits?: SensitiveSlideAudit[] }>([
        {
          text: `당신은 첫 번째 탐지기와 독립적으로 동작하는 기밀 요소 존재 검사자입니다.
각 이미지는 개인정보 보호를 위해 저해상도 블러 처리되어 있습니다. 글자를 읽거나 고객을 추측하지 말고, 요청된 모든 슬라이드에서 다음 요소가 존재하는지만 보수적으로 판정하세요.
- hasSmallOrMediumText: 큰 제목을 제외한 작은 글자, 표, 차트 라벨, 각주가 하나라도 보임
- hasEmbeddedVisual: 실제 사진, 제품·시설 이미지, 스크린샷이 하나라도 보임
- hasLogoOrIdentifier: 로고처럼 보이는 마크나 고객·프로젝트 식별 표시가 하나라도 보임
애매하면 해당 has 값을 true로 두세요. 세 항목을 모두 확인한 경우에만 complete=true로 두고, 요청된 슬라이드를 하나도 빠뜨리지 마세요.
다른 탐지 결과나 좌표는 제공되지 않으며, 아래 JSON만 반환하세요.
{"audits":[{"slideIndex":0,"hasSmallOrMediumText":true,"hasEmbeddedVisual":true,"hasLogoOrIdentifier":true,"complete":true}]}`,
        },
        ...parts.flat(),
      ], { maxOutputTokens: 4000, timeoutMs: 55_000, attempts: 1, jsonAttempts: 1 });
    } catch (error) {
      if (error instanceof GeminiRequestError || error instanceof PortfolioCheckpointYield) throw error;
      if (batch.length === 1) throw error;
      const fallback = await Promise.all(batch.map((index) => detectConfidentialRegions({
        bucket: input.bucket,
        slidePaths: input.slidePaths,
        indexes: [index],
        shouldYield: input.shouldYield,
      })));
      fallback.forEach((value) => {
        regions.push(...value.regions);
        audits.push(...value.audits);
      });
      continue;
    }
    regions.push(...(result.regions || []));
    const primaryByIndex = new Map((result.audits || []).map((audit) => [Number(audit.slideIndex), audit]));
    const independentByIndex = new Map((independentAudit.audits || [])
      .map((audit) => [Number(audit.slideIndex), audit]));
    for (const slideIndex of batch) {
      const primary = primaryByIndex.get(slideIndex);
      const independent = independentByIndex.get(slideIndex);
      const completePrimary = primary
        && typeof primary.hasSmallOrMediumText === "boolean"
        && typeof primary.hasEmbeddedVisual === "boolean"
        && typeof primary.hasLogoOrIdentifier === "boolean"
        && primary.complete === true;
      const completeIndependent = independent
        && typeof independent.hasSmallOrMediumText === "boolean"
        && typeof independent.hasEmbeddedVisual === "boolean"
        && typeof independent.hasLogoOrIdentifier === "boolean"
        && independent.complete === true;
      if (!completePrimary || !completeIndependent) continue;
      audits.push({
        slideIndex,
        hasSmallOrMediumText: primary.hasSmallOrMediumText || independent.hasSmallOrMediumText,
        hasEmbeddedVisual: primary.hasEmbeddedVisual || independent.hasEmbeddedVisual,
        hasLogoOrIdentifier: primary.hasLogoOrIdentifier || independent.hasLogoOrIdentifier,
        complete: true,
      });
    }
  }
  const allowed = new Set(requestedIndexes);
  const normalized = uniqueRegions([...existingRegions, ...regions]
    .map((region) => normalizedRegion(region, input.slidePaths.length))
    .filter((region): region is SensitiveRegion => Boolean(region))
    .filter((region) => allowed.has(region.slideIndex)));
  const normalizedAudits = uniqueAudits([...existingAudits, ...audits]
    .map((audit) => normalizedAudit(audit, input.slidePaths.length))
    .filter((audit): audit is SensitiveSlideAudit => Boolean(audit))
    .filter((audit) => allowed.has(audit.slideIndex)));
  if (input.onProgress) {
    await input.onProgress({ regions: normalized, audits: normalizedAudits }, [...new Set([
      ...coveredIndexes,
      ...indexes,
    ])].sort((left, right) => left - right));
  }
  return { regions: normalized, audits: normalizedAudits };
}

function normalizeReview(review: PortfolioVisualReview, slideCount: number) {
  const indexes = [...new Set((review.recommendedSlideIndexes || [])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0 && value < slideCount))];
  review.confidence = Math.max(0, Math.min(1, Number(review.confidence || 0)));
  review.clientCategory = ["large_company", "public_institution", "general_company", "unknown"]
    .includes(String(review.clientCategory))
    ? review.clientCategory
    : "unknown";
  review.recommendedSlideIndexes = indexes.slice(0, 30);
  review.reasons = (review.reasons || []).map(String).slice(0, 6);
  review.rejectionReasons = (review.rejectionReasons || []).map(String).slice(0, 6);
  review.slideAssessments = (review.slideAssessments || [])
    .map((slide) => normalizeAssessment(slide, slideCount))
    .filter((slide): slide is SlideAssessment => Boolean(slide));
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
  baseReview?: PortfolioVisualReview;
  existingAssessments?: SlideAssessment[];
  onBaseReview?: (review: PortfolioVisualReview) => Promise<void> | void;
  onAssessmentProgress?: (
    review: PortfolioVisualReview,
    assessments: SlideAssessment[],
  ) => Promise<void> | void;
  shouldYield?: () => boolean;
}) {
  let normalized: PortfolioVisualReview;
  if (input.baseReview) {
    normalized = normalizeReview(input.baseReview, input.slidePaths.length);
  } else {
    yieldPortfolioCheckpointIfNeeded(input.shouldYield);
    const indexes = samplingIndexes(input.slidePaths.length);
    const parts = await Promise.all(indexes.map(async (index) => [
      { text: `검토 이미지 ${indexes.indexOf(index) + 1}: 실제 슬라이드 인덱스 ${index}` },
      await imagePart(input.bucket, input.slidePaths[index]),
    ]));

    const review = await generateGeminiJson<PortfolioVisualReview>([
      {
        text: `당신은 울림컴퍼니 디자인 포트폴리오의 엄격한 편집장입니다.
원본 파일명과 저장 경로는 개인정보 보호를 위해 제공되지 않습니다.
전체 페이지 수: ${input.slidePaths.length}

뒤에 제공하는 표본 이미지는 외부 전송 전에 저해상도 블러로 비식별화되어 있습니다. 글자 내용을 읽거나 고객을 추측하지 말고 레이아웃·도식·색상·페이지 구조만 보고 네이버 디자인 블로그 포트폴리오로 쓸 만한 완성 프로젝트인지 판정하세요.

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

썸네일용 분류:
- clientCategory는 실제 고객이 대기업이면 large_company, 공공기관·정부기관·지자체이면 public_institution, 일반 기업이면 general_company로 기록한다.
- 표본만으로 확실히 구분할 수 없으면 unknown으로 기록한다.
- 실제 회사명·기관명·브랜드명은 projectTitle에 넣지 말고 업종, 문서 목적, 문서 종류만으로 일반화한다.

반드시 아래 모양의 JSON만 반환하세요.
{
  "suitable": true,
  "confidence": 0.0,
  "documentType": "",
  "industry": "",
  "clientCategory": "unknown",
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
    ], { maxOutputTokens: 6000, timeoutMs: 55_000, attempts: 1, jsonAttempts: 1 });

    normalized = normalizeReview(review, input.slidePaths.length);
    if (input.onBaseReview) await input.onBaseReview(normalized);
  }
  if (!normalized.suitable) return normalized;

  const assessments = await assessAllPortfolioSlides({
    bucket: input.bucket,
    slidePaths: input.slidePaths,
    existingAssessments: input.existingAssessments,
    shouldYield: input.shouldYield,
    onProgress: async (progress) => {
      normalized.slideAssessments = progress;
      if (input.onAssessmentProgress) {
        await input.onAssessmentProgress(normalized, progress);
      }
    },
  });
  const selection = selectPortfolioSlides({
    slideCount: input.slidePaths.length,
    assessments,
  });
  normalized.slideAssessments = assessments;
  normalized.recommendedSlideIndexes = selection.selectedSlideIndexes;
  normalized.selection = selection;
  return normalized;
}
