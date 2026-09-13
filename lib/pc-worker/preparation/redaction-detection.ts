import { createHash } from "node:crypto";
import {
  extractPptxRedactionPrimitives,
  type PptxRedactionPrimitive,
} from "./pptx-inspection.ts";
import {
  REDACTION_RULE_VERSION,
  type RedactionCandidate,
  type RedactionDetection,
  type RedactionRect,
} from "./redaction-types.ts";

type Match = { category: string; required: boolean; reason: string };
const mandatoryPatterns: readonly [RegExp, Match][] = [
  [/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]{1,64}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/iu,
    {category:"email",required:true,reason:"EMAIL_PATTERN_REQUIRES_OPAQUE_REDACTION"}],
  [/(?:\+?82[- .]?)?(?:0?1[016789])[- .]?\d{3,4}[- .]?\d{4}|0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}/u,
    {category:"contact",required:true,reason:"CONTACT_PATTERN_REQUIRES_OPAQUE_REDACTION"}],
  [/(?:\d{6}[- ]?[1-8]\d{6}|\d{3}[- ]?\d{2}[- ]?\d{5}|(?:주민|외국인|사업자|법인|여권|사원|고객|회원|식별)\s*(?:등록)?\s*(?:번호|ID))/iu,
    {category:"identifier",required:true,reason:"IDENTIFIER_PATTERN_REQUIRES_OPAQUE_REDACTION"}],
  [/(?:계좌|예금주|입금계좌|bank\s*account|\baccount\b\s*(?:no|number)?)(?:[^\n\r]{0,48})/iu,
    {category:"account",required:true,reason:"ACCOUNT_PATTERN_REQUIRES_OPAQUE_REDACTION"}],
  [/(?:비밀번호|패스워드|인증번호|보안코드|일회용\s*번호|password|passcode|\bpin\b|\botp\b|api\s*key|access\s*key|private\s*key|\bsecret\b|bearer\s+token|sk-[a-z0-9_-]{8,})/iu,
    {category:"authentication",required:true,reason:"AUTHENTICATION_PATTERN_REQUIRES_OPAQUE_REDACTION"}],
  [/(?:주소|소재지|거주지|사업장\s*위치|address\s*:|location\s*:)/iu,
    {category:"address",required:true,reason:"ADDRESS_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION"}],
];
const reviewPatterns: readonly [RegExp, Match][] = [
  [/(?:성명|이름|담당자|대표자|작성자|수신인|name\s*:)/iu,
    {category:"name",required:false,reason:"NAME_REQUIRES_LOCAL_DISCLOSURE_REVIEW"}],
  [/(?:\d[\d,.]*\s*(?:원|만원|억원|KRW|USD|EUR)|[$€]\s*\d|금액|예산|견적|단가|원가|마진)/iu,
    {category:"amount",required:false,reason:"AMOUNT_REQUIRES_LOCAL_DISCLOSURE_REVIEW"}],
  [/(?:대외비|기밀|내부용|confidential|고객\s*(?:목록|명단)|계약\s*(?:조건|상세)|내부\s*(?:수치|지표)|미공개)/iu,
    {category:"internal_detail",required:false,reason:"INTERNAL_DETAIL_REQUIRES_LOCAL_DISCLOSURE_REVIEW"}],
];
const visualPatterns: readonly [RegExp, Match][] = [
  [/(?:\bqr\b|큐알)/iu,{category:"qr",required:true,reason:"QR_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION"}],
  [/(?:bar\s*code|barcode|바코드)/iu,{category:"barcode",required:true,reason:"BARCODE_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION"}],
  [/(?:\b(?:signature|signed)\b|서명|날인)/iu,
    {category:"signature",required:true,reason:"SIGNATURE_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION"}],
  // A substring search for 직인 also matched the unrelated word 재직인원.
  // Keep explicit stamp compounds and common particles, but require real
  // letter/number boundaries around the complete expression. 서명/날인 above
  // still handles joined forms such as 직인날인 and 전자서명.
  [/(?<![\p{L}\p{N}])(?:(?:회사|법인|기관|대표자?|사용|관공서|사업자|전자)?직인)(?:란|도장|이미지|첨부|확인|등록|삭제|요청|생략|파일|원본)?(?:은|는|이|가|을|를|의|과|와|으로|로)?(?![\p{L}\p{N}])/iu,
    {category:"signature",required:true,reason:"SIGNATURE_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION"}],
];

function normalizeInput(text: string) {
  // Format controls and soft hyphens are invisible in the rendered slide and
  // must not split an otherwise contiguous sensitive token.
  return text.normalize("NFKC").replace(/[\p{Cf}\u00ad\u0000]/gu,"");
}
function matchesForText(text: string) {
  const matches:Match[]=[];
  for(const [pattern,match] of [...mandatoryPatterns,...reviewPatterns,...visualPatterns]) {
    pattern.lastIndex=0;
    if(pattern.test(text)) matches.push(match);
  }
  return matches;
}
function stableId(parts: readonly string[]) {
  return `candidate-${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0,20)}`;
}
function rectKey(rect: RedactionRect) {
  return [rect.x,rect.y,rect.width,rect.height].map((value)=>value.toFixed(8)).join(":");
}
function candidateFor(input:{sourceHash:string;slideContentHash:string;primitive:PptxRedactionPrimitive;
  rect:RedactionRect;match:Match}):RedactionCandidate {
  return {id:stableId([REDACTION_RULE_VERSION,input.sourceHash,input.slideContentHash,
    input.primitive.key,input.match.category,rectKey(input.rect)]),rect:input.rect,
  category:input.match.category,required:input.match.required,reason:input.match.reason};
}
function coverage(rectangles:readonly RedactionRect[]) {
  const unique=[...new Map(rectangles.map((rect)=>[rectKey(rect),rect])).values()];
  const xs=[...new Set(unique.flatMap((rect)=>[rect.x,rect.x+rect.width]))].sort((a,b)=>a-b);
  let area=0;
  for(let index=1;index<xs.length;index++) {
    const spans=unique.filter((rect)=>rect.x<xs[index]&&rect.x+rect.width>xs[index-1])
      .map((rect)=>[rect.y,rect.y+rect.height] as const).sort((a,b)=>a[0]-b[0]);
    let bottom=0,covered=0;
    for(const [top,end] of spans) { covered+=Math.max(0,end-Math.max(top,bottom));bottom=Math.max(bottom,end); }
    area+=(xs[index]-xs[index-1])*covered;
  }
  return Math.min(1,area);
}

/**
 * Local-only, deterministic candidate extraction. It deliberately does not
 * claim that images or semantic business content are safe: optional review
 * candidates must be resolved in the high-resolution local editor.
 */
export async function detectPptxRedactionCandidates(
  source: Buffer,
  slideNumbers: readonly number[],
): Promise<RedactionDetection[]> {
  const extracted=await extractPptxRedactionPrimitives(source,slideNumbers);
  return extracted.slides.map((slide)=>{
    const warnings=new Set(slide.warnings), candidates:RedactionCandidate[]=[];
    const uncertainties:NonNullable<RedactionDetection["uncertainties"]>=[];
    warnings.add("PIXEL_CONTENT_REQUIRES_HIGH_RESOLUTION_LOCAL_REVIEW");
    const seen=new Map<string,RedactionCandidate>();
    const seenUncertainties=new Set<string>();
    for(const primitive of slide.primitives) {
      const combined=normalizeInput(`${primitive.text} ${primitive.metadata}`);
      const truncated=combined.length>200_000;
      const scanned=truncated?combined.slice(0,200_000):combined;
      if(truncated) warnings.add("TEXT_SCAN_TRUNCATED_REQUIRES_LOCAL_REVIEW");
      const matches=matchesForText(scanned);
      if(primitive.kind==="image"&&!matches.some((match)=>["qr","barcode","signature"].includes(match.category))) {
        matches.push({category:"image_review",required:false,reason:"IMAGE_CONTENT_REQUIRES_LOCAL_REVIEW"});
      }
      if(primitive.kind==="chart") {
        matches.push({category:"chart_review",required:false,reason:"CHART_LABELS_REQUIRE_LOCAL_REVIEW"});
      }
      if(primitive.kind==="object") {
        matches.push({category:"object_review",required:true,reason:"UNINSPECTABLE_OBJECT_REQUIRES_LOCAL_REVIEW"});
      }
      // A rotated/autofit ordinary heading is not itself a disclosure. The
      // mandatory high-resolution inspection still applies to all pixels.
      if(!matches.length) continue;
      if(!primitive.rect) {
        warnings.add(matches.some((match)=>match.required)
          ? "REQUIRED_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED"
          : "REVIEW_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED");
        continue;
      }
      const rect=primitive.rect;
      if(primitive.geometryReview) warnings.add("CANDIDATE_GEOMETRY_REQUIRES_LOCAL_REVIEW");
      for(const match of matches) {
        const extractedCandidate=candidateFor({sourceHash:extracted.sourceHash,slideContentHash:slide.slideContentHash,
          primitive,rect,match});
        const key=`${extractedCandidate.category}:${rectKey(extractedCandidate.rect)}`;
        const candidate=seen.get(key) || extractedCandidate;
        if(!seen.has(key)) { seen.set(key,candidate);candidates.push(candidate); }
        if(primitive.geometryReview) {
          const code=primitive.textBoundsReview?"TEXT_RENDER_BOUNDS_UNRESOLVED"
            :primitive.kind==="text"?"TEXT_GEOMETRY_UNRESOLVED":"IMAGE_GEOMETRY_UNRESOLVED";
          const id=stableId([candidate.id,code]);
          if(!seenUncertainties.has(id)) {
            seenUncertainties.add(id);
            uncertainties.push({id,code,candidateId:candidate.id,rect});
          }
        }
      }
    }
    if(coverage(candidates.filter((candidate)=>candidate.required).map((candidate)=>candidate.rect))>=.35) {
      warnings.add("HIGH_REQUIRED_REDACTION_COVERAGE_REPLACEMENT_REVIEW");
    } else if(coverage(candidates.map((candidate)=>candidate.rect))>=.55) {
      warnings.add("HIGH_REVIEW_COVERAGE_REPLACEMENT_REVIEW");
    }
    return {sourceSlideNumber:slide.sourceSlideNumber,sourceHash:extracted.sourceHash,
      slideContentHash:slide.slideContentHash,candidates,warnings:[...warnings].sort(),
      ...(uncertainties.length?{uncertainties}: {})};
  });
}
