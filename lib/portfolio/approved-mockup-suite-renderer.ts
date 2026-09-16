import { createHash } from "node:crypto";
import sharp from "sharp";

import {
  APPROVED_16X9_BACKGROUNDS,
  resolveApprovedMockupSlots,
  type ApprovedMockupTemplateSpec,
} from "./approved-16x9-templates.ts";
import {
  getApprovedMockupSuiteContract,
  getRegisteredApprovedMockupSuite,
  type ApprovedMockupSuite,
} from "./approved-mockup-suites.ts";
import {
  renderApprovedMockup,
  type ApprovedMockupAssignedSlide,
  type ApprovedMockupRenderResult,
} from "./approved-16x9-renderer.ts";
import { inspectApprovedTemplateGeometry } from "./approved-mockup-geometry.ts";

type AnyTemplate = ApprovedMockupTemplateSpec<string, string, number>;

export function approvedTemplateFingerprint(template: AnyTemplate) {
  return createHash("sha256").update(JSON.stringify({
    template,
    background: APPROVED_16X9_BACKGROUNDS[template.backgroundId],
  })).digest("hex");
}

export type ApprovedSuiteRenderOptions = Readonly<{
  aspectClass: string;
  slides: readonly ApprovedMockupAssignedSlide[];
  /** Original zero-based index; defaults to the first selected source slide. */
  coverIndex?: number;
  title?: string | null;
}>;

/**
 * New stage-one entry point. It accepts a registered suite, never arbitrary
 * geometry, fills every physical slot, and performs no job/database/AI calls.
 * Existing pipeline callers keep their existing entry point until integration.
 */
export async function renderApprovedMockupSuite(options: ApprovedSuiteRenderOptions) {
  const suite: ApprovedMockupSuite | null = getRegisteredApprovedMockupSuite(
    options.aspectClass,
  );
  const contract = getApprovedMockupSuiteContract(options.aspectClass);
  if (!suite || !contract) throw new Error(`승인된 목업 세트가 없는 규격입니다: ${options.aspectClass}`);
  if (options.slides.length < contract.minimumUniqueSlideCount) {
    throw new Error(`빈 슬롯 없이 ${suite.aspectClass} 세트를 만들려면 서로 다른 장표 ${contract.minimumUniqueSlideCount}장이 필요합니다. 현재 ${options.slides.length}장입니다.`);
  }

  const indexes = new Set<number>();
  const hashes = new Set<string>();
  for (const slide of options.slides) {
    if (!Number.isInteger(slide.index) || slide.index < 0) throw new Error("원본 장표 번호가 유효하지 않습니다.");
    if (indexes.has(slide.index)) throw new Error(`원본 장표 ${slide.index + 1}이 중복됐습니다.`);
    if (!Buffer.isBuffer(slide.buffer) || slide.buffer.length === 0) throw new Error(`장표 ${slide.index + 1} 이미지가 비어 있습니다.`);
    const hash = createHash("sha256").update(slide.buffer).digest("hex");
    if (hashes.has(hash)) throw new Error("내용이 같은 장표 이미지가 중복됐습니다.");
    indexes.add(slide.index);
    hashes.add(hash);
    const metadata = await sharp(slide.buffer).metadata();
    const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    if (!width || !height || Math.abs(width / height / suite.thumbnail.slideAspectRatio - 1) > 0.005) {
      throw new Error(`장표 ${slide.index + 1}의 비율이 ${suite.aspectClass} 템플릿과 다릅니다. 늘이거나 잘라서 맞추지 않습니다.`);
    }
  }

  const coverIndex = options.coverIndex ?? options.slides[0].index;
  if (!indexes.has(coverIndex)) throw new Error("선택된 장표에 표지 장표가 없습니다.");
  const templates: readonly AnyTemplate[] = [suite.thumbnail, ...suite.bodyTemplates];
  const usage = new Map(options.slides.map((slide) => [slide.index, 0]));
  const assets: (ApprovedMockupRenderResult & { geometryHash: string })[] = [];
  const geometry = templates.map(inspectApprovedTemplateGeometry);
  if (geometry.some((check) => !check.passed)) {
    throw new Error(geometry.flatMap((check) => check.errors.map((error) => `${check.templateId}: ${error}`)).join("\n"));
  }
  for (const template of templates) {
    const slots = resolveApprovedMockupSlots(template);
    const inBoard = new Set<number>();
    const assigned = slots.map((_, position) => {
      const candidates = options.slides.filter((slide) => !inBoard.has(slide.index));
      candidates.sort((left, right) => (usage.get(left.index)! - usage.get(right.index)!) || left.index - right.index);
      const slide = template.kind === "thumbnail" && position === 0
        ? candidates.find((candidate) => candidate.index === coverIndex)!
        : candidates[0];
      if (!slide) throw new Error(`${template.id}: 필수 슬롯을 채울 고유 장표가 부족합니다.`);
      inBoard.add(slide.index);
      usage.set(slide.index, usage.get(slide.index)! + 1);
      return slide;
    });
    const rendered = await renderApprovedMockup({ template, slides: assigned, title: options.title });
    if (rendered.slotAssignments.length !== slots.length) throw new Error(`${template.id}: 렌더 결과에 슬롯 누락이 있습니다.`);
    assets.push({ ...rendered, geometryHash: approvedTemplateFingerprint(template) });
  }
  return {
    suiteId: suite.suiteId,
    version: suite.version,
    aspectClass: suite.aspectClass,
    contract,
    geometry,
    assets,
  };
}
