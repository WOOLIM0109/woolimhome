import { createHash } from "node:crypto";

export const PORTFOLIO_RULE_VERSION = "2026-08-04-privacy-template-v1";

export function createPortfolioSourceFingerprint(input: {
  bucket: string;
  slidePaths: string[];
  conversionUpdatedAt: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    ...input,
    ruleVersion: PORTFOLIO_RULE_VERSION,
  })).digest("hex");
}

export const PORTFOLIO_WRITING_RULES = `
포트폴리오 글 이미지 배치 규칙:
- 대표 썸네일은 목록 카드에서만 사용하고 본문용 이미지와 섞지 않는다.
- 5~19장 문서는 PSD 기반 메인·상세 목업 4장을 사용한다.
- 20장 이상 문서는 선정 장표를 중복 없이 6장씩 묶어, 완성된 묶음 수에 따라 다중 페이지 목업 3~5장을 사용한다.
- 도식이 풍부하고 완성도가 높으며 보기 드문 구성을 우선 선택하고, 같은 장표와 유사 레이아웃은 반복하지 않는다.
- 본문용 이미지는 글 상단에 한꺼번에 나열하지 않는다.
- 각 이미지는 그 이미지를 설명하는 문단 바로 다음에 figure로 배치한다.
- figure 안에는 img와 figcaption을 함께 넣는다.
- 연속된 figure를 만들지 않고, 이미지 사이에는 반드시 설명 문단이나 소제목을 둔다.
- 메인 콜라주, 정보 구조, 분석, 실행 전략처럼 서로 다른 역할의 이미지를 고른다.
- 같은 슬라이드 형식이나 같은 내용을 반복해서 보여주지 않는다.
`;

export function validatePortfolioBodyHtml(
  bodyHtml: string,
  options: { minimumFigures?: number } = {},
) {
  const issues: string[] = [];
  const figureCount = (bodyHtml.match(/<figure[\s>]/gi) || []).length;
  const imageCount = (bodyHtml.match(/<img[\s>]/gi) || []).length;
  const minimumFigures = Math.max(1, Math.min(10, options.minimumFigures || 5));

  if (figureCount < minimumFigures) {
    issues.push(`본문용 다중 페이지 목업이 ${minimumFigures}개 미만입니다.`);
  }
  if (figureCount !== imageCount) issues.push("본문 이미지는 모두 figure 안에 배치해야 합니다.");
  if (/<\/figure>\s*<figure[\s>]/i.test(bodyHtml)) {
    issues.push("본문 이미지가 설명 없이 연속으로 배치되어 있습니다.");
  }
  if (figureCount && !/<p[\s>][\s\S]*?<\/p>\s*<figure[\s>]/i.test(bodyHtml)) {
    issues.push("이미지는 관련 설명 문단 다음에 배치해야 합니다.");
  }

  return issues;
}

export function validatePortfolioPublicationMetadata(metadata: unknown) {
  const value = metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : {};
  const generated = value.generated && typeof value.generated === "object"
    ? value.generated as { bodyHtml?: unknown }
    : {};
  const mockup = value.portfolioMockup && typeof value.portfolioMockup === "object"
    ? value.portfolioMockup as {
      mode?: unknown;
      bodyBoardCount?: unknown;
      selectedSlideIndexes?: unknown;
      redactionStatus?: unknown;
    }
    : {};
  const portfolioAssets = Array.isArray(value.portfolioAssets) ? value.portfolioAssets : [];
  const bodyAssets = portfolioAssets.filter((asset) => (
    asset && typeof asset === "object" && (asset as { kind?: unknown }).kind === "body_image"
  )) as Array<{ slideIndexes?: unknown; url?: unknown }>;
  const rawSelectedSlideIndexes = Array.isArray(mockup.selectedSlideIndexes)
    ? mockup.selectedSlideIndexes
    : [];
  const selectedSlideIndexes = rawSelectedSlideIndexes.length
    ? rawSelectedSlideIndexes.filter((index): index is number => (
      typeof index === "number" && Number.isInteger(index) && index >= 0
    ))
    : [];
  const recordedBoardCount = typeof mockup.bodyBoardCount === "number"
    && Number.isInteger(mockup.bodyBoardCount)
    ? mockup.bodyBoardCount
    : null;
  const issues: string[] = [];
  if (typeof value.portfolioSourceFingerprint !== "string"
    || !/^[a-f0-9]{64}$/i.test(value.portfolioSourceFingerprint)) {
    issues.push("현재 원본과 일치하는 포트폴리오 목업 생성 기록이 없습니다.");
  }
  if (value.portfolioRuleVersion !== PORTFOLIO_RULE_VERSION) {
    issues.push("현재 포트폴리오 템플릿·기밀 규칙으로 다시 만든 기록이 없습니다.");
  }
  let minimumFigures = 5;
  if (mockup.mode === "short_psd") {
    minimumFigures = 4;
    if (recordedBoardCount !== 4) {
      issues.push("짧은 문서는 본문 목업 4장이 모두 확인되어야 합니다.");
    }
  } else if (mockup.mode === "six_grid") {
    const validLongCount = recordedBoardCount !== null
      && recordedBoardCount >= 3
      && recordedBoardCount <= 5;
    minimumFigures = validLongCount ? recordedBoardCount : 3;
    if (!validLongCount) {
      issues.push("긴 문서는 중복 없는 6장 묶음의 본문 목업 3~5장이 확인되어야 합니다.");
    }
  } else {
    issues.push("포트폴리오 목업 제작 방식을 확인할 수 없습니다.");
  }
  if (mockup.redactionStatus !== "verified") {
    issues.push("기밀 블러 검수를 통과하지 않았습니다.");
  }
  issues.push(...validatePortfolioBodyHtml(
    typeof generated.bodyHtml === "string" ? generated.bodyHtml : "",
    { minimumFigures },
  ));
  const figureCount = (
    (typeof generated.bodyHtml === "string" ? generated.bodyHtml : "").match(/<figure[\s>]/gi) || []
  ).length;
  if (recordedBoardCount !== null && figureCount !== recordedBoardCount) {
    issues.push(`본문 figure 수가 목업 기록 ${recordedBoardCount}장과 일치하지 않습니다.`);
  }
  if (recordedBoardCount !== null && bodyAssets.length !== recordedBoardCount) {
    issues.push(`저장된 본문 목업 자산 수가 기록 ${recordedBoardCount}장과 일치하지 않습니다.`);
  }

  const flattenedAssetIndexes: number[] = [];
  let invalidAssetIndexes = false;
  for (const asset of bodyAssets) {
    if (!Array.isArray(asset.slideIndexes)) {
      invalidAssetIndexes = true;
      continue;
    }
    const indexes = asset.slideIndexes.filter((index): index is number => (
      typeof index === "number" && Number.isInteger(index) && index >= 0
    ));
    if (indexes.length !== asset.slideIndexes.length || new Set(indexes).size !== indexes.length) {
      invalidAssetIndexes = true;
    }
    if (mockup.mode === "six_grid" && indexes.length !== 6) invalidAssetIndexes = true;
    flattenedAssetIndexes.push(...indexes);
  }
  const uniqueAssetIndexes = new Set(flattenedAssetIndexes);
  if (uniqueAssetIndexes.size !== flattenedAssetIndexes.length) invalidAssetIndexes = true;
  if (mockup.mode === "six_grid"
    && recordedBoardCount !== null
    && flattenedAssetIndexes.length !== recordedBoardCount * 6) {
    invalidAssetIndexes = true;
  }
  if (invalidAssetIndexes) {
    issues.push("본문 목업 장표는 자산별 고유 인덱스로 구성되어야 하며 긴 문서는 자산마다 정확히 6장이어야 합니다.");
  }
  const canonicalSelected = [...new Set(selectedSlideIndexes)].sort((left, right) => left - right);
  const canonicalAssets = [...uniqueAssetIndexes].sort((left, right) => left - right);
  if (selectedSlideIndexes.length !== canonicalSelected.length
    || selectedSlideIndexes.length !== rawSelectedSlideIndexes.length
    || canonicalSelected.length !== canonicalAssets.length
    || canonicalSelected.some((index, position) => index !== canonicalAssets[position])) {
    issues.push("선정 장표 기록과 실제 본문 목업 자산의 장표 구성이 일치하지 않습니다.");
  }
  const bodyHtml = typeof generated.bodyHtml === "string" ? generated.bodyHtml : "";
  const imageSources = [...bodyHtml.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1].replaceAll("&amp;", "&"));
  const assetUrls = bodyAssets
    .map((asset) => typeof asset.url === "string" ? asset.url.replaceAll("&amp;", "&") : "")
    .filter(Boolean);
  const canonicalImageSources = [...imageSources].sort();
  const canonicalAssetUrls = [...assetUrls].sort();
  if (canonicalImageSources.length !== canonicalAssetUrls.length
    || canonicalImageSources.some((url, index) => url !== canonicalAssetUrls[index])) {
    issues.push("본문 이미지 URL이 현재 기밀 블러 검수를 통과한 목업 자산과 일치하지 않습니다.");
  }
  return issues;
}

export function validatePortfolioSourceState(
  metadata: unknown,
  mockupJob: { status?: unknown; result?: unknown } | null | undefined,
  conversionJob?: {
    status?: unknown;
    result?: unknown;
    updated_at?: unknown;
  } | null,
) {
  const value = metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : {};
  const result = mockupJob?.result && typeof mockupJob.result === "object"
    ? mockupJob.result as Record<string, unknown>
    : {};
  const metadataFingerprint = typeof value.portfolioSourceFingerprint === "string"
    ? value.portfolioSourceFingerprint
    : "";
  const jobFingerprint = typeof result.sourceFingerprint === "string"
    ? result.sourceFingerprint
    : "";
  const conversionResult = conversionJob?.result && typeof conversionJob.result === "object"
    ? conversionJob.result as Record<string, unknown>
    : {};
  const conversionBucket = typeof conversionResult.bucket === "string" ? conversionResult.bucket : "";
  const conversionSlidePaths = Array.isArray(conversionResult.slidePaths)
    ? conversionResult.slidePaths.filter((path): path is string => typeof path === "string")
    : [];
  const conversionUpdatedAt = typeof conversionJob?.updated_at === "string"
    ? conversionJob.updated_at
    : "";
  const currentSourceFingerprint = conversionBucket && conversionSlidePaths.length && conversionUpdatedAt
    ? createPortfolioSourceFingerprint({
      bucket: conversionBucket,
      slidePaths: conversionSlidePaths,
      conversionUpdatedAt,
    })
    : "";
  const issues: string[] = [];

  if (value.portfolioRuleVersion !== PORTFOLIO_RULE_VERSION) {
    issues.push("포트폴리오 생성 규칙 버전이 현재 배포 버전과 일치하지 않습니다.");
  }

  if (!mockupJob || mockupJob.status !== "completed") {
    issues.push("최신 포트폴리오 목업 작업이 아직 완료되지 않았습니다.");
  }
  if (!metadataFingerprint || !jobFingerprint || metadataFingerprint !== jobFingerprint) {
    issues.push("현재 원본과 완료된 목업의 버전이 일치하지 않습니다.");
  }
  if (!conversionJob || conversionJob.status !== "completed") {
    issues.push("최신 원본 변환 작업이 완료 상태가 아닙니다.");
  }
  if (!currentSourceFingerprint || currentSourceFingerprint !== jobFingerprint) {
    issues.push("현재 변환된 원본과 완료된 목업의 버전이 일치하지 않습니다.");
  }
  return issues;
}
