import sharp from "sharp";
import { getApprovedMockupSuiteContract } from "../../portfolio/approved-mockup-suites.ts";
import { sha256, type PptxInspection, type SlideInspection } from "./pptx-inspection.ts";

export type PreviewCheck = { sourceSlideNumber: number; width: number; height: number;
  sha256: string; visualHash: string; blank: boolean; error?: string };
/** Local visual classification, not permission to disclose content or skip redaction. */
export type SlideArtworkReview = { sourceHash: string; slideContentHash: string; previewHash: string;
  sourceSlideNumber: number; classification: "abstract_graphic"; reviewedBy: string; reason: string;
  inspectedAtFullResolution: true };
export type PreparationSelection = { version: 1; status: "ready_for_local_review" | "held";
  minimum: number; cover: number | null; selected: number[]; reserves: number[];
  holds: string[]; manualReviewRequired: true;
  artworkReviews?: SlideArtworkReview[];
  slides: { sourceSlideNumber: number; disposition: "selected" | "reserve" | "excluded" | "candidate";
    score: number; reasons: string[] }[] };

/** Validation isn't a claim that every glyph is readable; that still needs local review. */
export async function validatePreparedPng(bytes: Buffer, input: {
  sourceSlideNumber: number; slideWidth: number; slideHeight: number; longEdge: number;
}): Promise<PreviewCheck> {
  const img = sharp(bytes, {limitInputPixels: 12_000_000}), meta = await img.metadata();
  if (meta.format !== "png" || !meta.width || !meta.height) throw new Error("INVALID_RENDERED_PNG");
  const expectedRatio = input.slideWidth / input.slideHeight;
  if (Math.abs(meta.width/meta.height/expectedRatio-1)>.005 || Math.abs(Math.max(meta.width,meta.height)-input.longEdge)>1) throw new Error("RENDERED_SIZE_MISMATCH");
  const raw = await img.clone().flatten({background:"#fff"}).greyscale().resize(64,64,{fit:"fill"}).raw().toBuffer();
  let min=255,max=0; for (const value of raw) { min=Math.min(min,value); max=Math.max(max,value); }
  // Only confidently uniform renders are rejected. White slides with sparse text are not blank.
  return { sourceSlideNumber:input.sourceSlideNumber,width:meta.width,height:meta.height,
    sha256:sha256(bytes),visualHash:sha256(raw),blank:max-min<3 };
}
const structuralExclusions = new Set([
  "HIDDEN", "EMPTY_OR_DECORATION_ONLY", "CORRUPT_SLIDE", "TABLE_DENSE", "PHOTO_DENSE",
  "MEDIA_UNRESOLVED", "MEDIA_CLASSIFICATION_REVIEW", "UNINSPECTABLE_OBJECT",
  "INHERITED_MEDIA_UNRESOLVED", "INHERITED_OBJECT_REVIEW",
]);
export function previewCandidate(slide: SlideInspection) {
  // Density is evaluated after previews; even excluded designs stay visible for explanation.
  return !slide.issues.some((i)=>["HIDDEN","EMPTY_OR_DECORATION_ONLY","CORRUPT_SLIDE"].includes(i.code));
}
function scoreSlide(s: SlideInspection, layouts: Set<string>): number {
  const m=s.metrics;
  // Explainable heuristics, not an assertion that code can objectively judge design quality.
  const hierarchy = Math.min(25,(s.title?8:3)+(m.textCoverage<.65?9:3)+(m.textCharacters<700?8:2));
  const composition = Math.min(25,5 + Math.min(10,m.charts*6) + Math.min(7,m.pictures*3) + Math.min(8,m.shapes));
  const representative = s.sourceSlideNumber===1 ? 20 : Math.min(20,5+(s.title?7:0)+(m.textCharacters>40?8:0));
  const diversity=layouts.has(m.layoutSignature)?3:15;
  const redaction= Math.max(0,15-Math.floor(m.textCharacters/150)-Math.round(m.photoCoverage*15));
  return hierarchy+composition+representative+diversity+redaction;
}
const MAX_ARTWORK_REVIEWS = 500;
function artworkReviewNote(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    && !/[\x00-\x1f\x7f]/.test(value);
}
/** Local JSON is still untrusted input. Copy only the evidence fields we use. */
function projectedArtworkReview(value: unknown): SlideArtworkReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.sourceSlideNumber !== "number" || !Number.isSafeInteger(row.sourceSlideNumber) || row.sourceSlideNumber < 1
    || typeof row.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(row.sourceHash)
    || typeof row.slideContentHash !== "string" || !/^[a-f0-9]{64}$/.test(row.slideContentHash)
    || typeof row.previewHash !== "string" || !/^[a-f0-9]{64}$/.test(row.previewHash)
    || row.classification !== "abstract_graphic" || row.inspectedAtFullResolution !== true
    || !artworkReviewNote(row.reviewedBy, 100) || !artworkReviewNote(row.reason, 500)) return null;
  return { sourceHash: row.sourceHash, slideContentHash: row.slideContentHash, previewHash: row.previewHash,
    sourceSlideNumber: row.sourceSlideNumber, classification: "abstract_graphic",
    reviewedBy: row.reviewedBy.trim(), reason: row.reason.trim(), inspectedAtFullResolution: true };
}
export function selectPreparedSlides(inspection: PptxInspection, previews: readonly PreviewCheck[], options: {
  selectedSlideNumbers?: readonly number[]; targetCount?: number;
  artworkReviews?: readonly SlideArtworkReview[];
}={}): PreparationSelection {
  const contract=getApprovedMockupSuiteContract(inspection.aspect), minimum=contract?.minimumUniqueSlideCount || 0;
  const result:PreparationSelection={version:1,status:"held",minimum,cover:null,selected:[],reserves:[],holds:[],manualReviewRequired:true,slides:[]};
  if (!contract) result.holds.push("승인된 규격 템플릿이 없습니다.");
  const previewNumbers = new Set<number>();
  const duplicatePreviewNumbers = new Set<number>();
  for (const preview of previews) {
    if (previewNumbers.has(preview.sourceSlideNumber)) duplicatePreviewNumbers.add(preview.sourceSlideNumber);
    previewNumbers.add(preview.sourceSlideNumber);
  }
  if (duplicatePreviewNumbers.size) {
    result.holds.push(`미리보기 장표 번호가 중복되었습니다: ${[...duplicatePreviewNumbers].sort((a,b)=>a-b).join(", ")}`);
  }
  const knownSlideNumbers = new Set(inspection.slides.map((slide) => slide.sourceSlideNumber));
  const unknownPreviewNumbers = [...previewNumbers].filter((number) => !knownSlideNumbers.has(number)).sort((a,b)=>a-b);
  if (unknownPreviewNumbers.length) result.holds.push(`원본에 없는 미리보기 장표 번호입니다: ${unknownPreviewNumbers.join(", ")}`);
  const checks=new Map(previews.map((p)=>[p.sourceSlideNumber,p]));
  const reviewedArtwork=new Set<number>();
  const reviewNumbers=new Set<number>();
  const suppliedReviews: unknown = options.artworkReviews;
  const reviewRows = Array.isArray(suppliedReviews) && suppliedReviews.length <= MAX_ARTWORK_REVIEWS ? suppliedReviews : [];
  if(suppliedReviews !== undefined && (!Array.isArray(suppliedReviews) || suppliedReviews.length > MAX_ARTWORK_REVIEWS)) {
    result.holds.push(`ARTWORK_REVIEW_INVALID: 검수 기록은 최대 ${MAX_ARTWORK_REVIEWS}개의 항목으로 된 배열이어야 합니다.`);
  }
  for(const [index, rawReview] of reviewRows.entries()) {
    const review = projectedArtworkReview(rawReview);
    if(!review) {
      result.holds.push(`ARTWORK_REVIEW_INVALID: ${index + 1}번째 검수 항목의 형식·해시·검토자 또는 사유가 올바르지 않습니다.`);
      continue;
    }
    const slide=inspection.slides.find((s)=>s.sourceSlideNumber===review.sourceSlideNumber);
    const preview=checks.get(review.sourceSlideNumber);
    const invalid=reviewNumbers.has(review.sourceSlideNumber) || !slide || !preview || preview.error || preview.blank
      || duplicatePreviewNumbers.has(review.sourceSlideNumber)
      || review.sourceHash!==inspection.sourceHash || review.slideContentHash!==slide?.contentHash
      || review.previewHash!==preview?.sha256
      || !slide?.issues.some((i)=>i.code==="PHOTO_DENSE");
    reviewNumbers.add(review.sourceSlideNumber);
    if(invalid) result.holds.push(`ARTWORK_REVIEW_INVALID: ${review.sourceSlideNumber}번의 원본·장표·이미지 또는 검수 기록이 일치하지 않습니다.`);
    else { reviewedArtwork.add(review.sourceSlideNumber); (result.artworkReviews ??= []).push(review); }
  }
  const contentSeen=new Set<string>(), visualSeen=new Set<string>(), eligible:SlideInspection[]=[];
  for (const s of inspection.slides) {
    const reasons=s.issues.filter((i)=>structuralExclusions.has(i.code)
      && !(i.code==="PHOTO_DENSE" && reviewedArtwork.has(s.sourceSlideNumber))).map((i)=>i.code+": "+i.detail);
    if (s.missingFonts.length) reasons.push("MISSING_FONTS: "+s.missingFonts.join(", "));
    if (s.embeddedUnverifiedFonts.length) reasons.push("EMBEDDED_FONT_UNVERIFIED: "+s.embeddedUnverifiedFonts.join(", "));
    if (s.issues.some((i)=>i.code==="FONT_UNRESOLVED")) reasons.push("FONT_UNRESOLVED");
    const p=checks.get(s.sourceSlideNumber);
    if (duplicatePreviewNumbers.has(s.sourceSlideNumber)) reasons.push("PREVIEW_DUPLICATE");
    if (previewCandidate(s) && (!p || p.error)) reasons.push(p?.error || "PREVIEW_MISSING");
    if (p?.blank) reasons.push("BLANK_RENDER");
    if (!reasons.length && (contentSeen.has(s.contentHash) || (p && visualSeen.has(p.visualHash)))) reasons.push("DUPLICATE_SLIDE");
    if (!reasons.length) { contentSeen.add(s.contentHash); if (p) visualSeen.add(p.visualHash); eligible.push(s); }
    result.slides.push({sourceSlideNumber:s.sourceSlideNumber,disposition:reasons.length?"excluded":"candidate",score:0,reasons});
    if(reviewedArtwork.has(s.sourceSlideNumber)) result.slides[result.slides.length-1].reasons.push("ARTWORK_REVIEWED: 추상 그래픽 육안 확인. 블러·개인정보 검수는 별도 필수.");
  }
  const overrides=options.selectedSlideNumbers;
  const layouts=new Set<string>();
  if (overrides) {
    if (new Set(overrides).size!==overrides.length || overrides.some((n)=>!Number.isInteger(n))) result.holds.push("수동 선별 번호가 중복되었거나 올바르지 않습니다.");
    for (const n of new Set(overrides)) {
      const s=eligible.find((s)=>s.sourceSlideNumber===n);
      if (!s) result.holds.push(`${n}번은 누락·손상·폰트·제외 조건을 해결해야 선택할 수 있습니다.`);
      else { result.selected.push(n); layouts.add(s.metrics.layoutSignature); }
    }
  } else {
    const target=Math.max(minimum,Math.min(24,options.targetCount ?? 14));
    const remaining=[...eligible];
    // Keep an eligible actual first slide as cover. Otherwise let the score choose, pending local review.
    const first=remaining.findIndex((s)=>s.sourceSlideNumber===1);
    if(first>=0) { const s=remaining.splice(first,1)[0]; result.selected.push(1); layouts.add(s.metrics.layoutSignature); }
    while(result.selected.length<target && remaining.length) {
      remaining.sort((a,b)=>scoreSlide(b,layouts)-scoreSlide(a,layouts)||a.sourceSlideNumber-b.sourceSlideNumber);
      const s=remaining.shift()!; result.selected.push(s.sourceSlideNumber); layouts.add(s.metrics.layoutSignature);
    }
  }
  const remaining=eligible.filter((s)=>!result.selected.includes(s.sourceSlideNumber));
  remaining.sort((a,b)=>scoreSlide(b,layouts)-scoreSlide(a,layouts)||a.sourceSlideNumber-b.sourceSlideNumber);
  result.reserves=remaining.slice(0,2).map((s)=>s.sourceSlideNumber);
  result.cover=result.selected[0] ?? null;
  if(result.selected.length<minimum) result.holds.push(`고유 장표 ${minimum}장 필요: 현재 ${result.selected.length}장. 제외 장표를 억지로 반복하지 않습니다.`);
  for(const row of result.slides) {
    const slide=inspection.slides.find((s)=>s.sourceSlideNumber===row.sourceSlideNumber)!;
    row.score=scoreSlide(slide,new Set());
    if(result.selected.includes(row.sourceSlideNumber)) { row.disposition="selected"; row.reasons.push(overrides?"사용자 선별":"구조·구성·대표성·다양성·블러 후 가독성 기준 후보"); }
    if(result.reserves.includes(row.sourceSlideNumber)) { row.disposition="reserve"; row.reasons.push("선택 장표 교체용 예비 후보"); }
    for(const i of slide.issues.filter((i)=>!structuralExclusions.has(i.code))) row.reasons.push(i.code+": "+i.detail);
  }
  if(!result.holds.length && result.selected.length>=minimum && minimum>0) result.status="ready_for_local_review";
  return result;
}
