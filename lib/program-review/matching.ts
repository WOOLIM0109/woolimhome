import type { Requirements } from "./requirements";
import type { MatchProfile } from "./profiles";

export type ProgramMatch = {
  targetKind: MatchProfile["targetKind"];
  targetId: string;
  targetName: string;
  verdict: "candidate" | "mismatch" | "unknown";
  reasons: string[];
  score: number;
};
export type MatchOptions = { now: Date | string | number; programDeadlineAt?: string | null };
export type RankedProgramMatch = ProgramMatch & { programId: string };

const DAY = 86_400_000;
const REGION_ALIASES: Array<[string, string[]]> = [
  ["부산", ["부산", "부산시", "부산광역시"]], ["서울", ["서울", "서울시", "서울특별시"]],
  ["대구", ["대구", "대구시", "대구광역시"]], ["인천", ["인천", "인천시", "인천광역시"]],
  ["광주", ["광주광역시"]], ["대전", ["대전", "대전시", "대전광역시"]],
  ["울산", ["울산", "울산시", "울산광역시"]], ["세종", ["세종", "세종시", "세종특별자치시"]],
  ["경기", ["경기", "경기도"]], ["강원", ["강원", "강원도", "강원특별자치도"]],
  ["충북", ["충북", "충청북도"]], ["충남", ["충남", "충청남도"]],
  ["전북", ["전북", "전라북도", "전북특별자치도"]], ["전남", ["전남", "전라남도"]],
  ["경북", ["경북", "경상북도"]], ["경남", ["경남", "경상남도"]],
  ["제주", ["제주", "제주도", "제주특별자치도"]],
];

function normalized(value: string) { return value.normalize("NFKC").replace(/[\s()（）·,.:\-/]/g, "").toLowerCase(); }
function hasEvidence(requirements: Requirements, path: string) {
  const text = requirements.evidence?.[path];
  return typeof text === "string" && /^\[source:[^\]\r\n]+ (?:p|para)\.\d+\]\s+\S/.test(text);
}
function list(requirements: Requirements, field: "regions" | "target_types" | "industries_included" | "industries_excluded" | "required_certifications") {
  const values = requirements[field];
  return values?.length && values.every((value, index) => value.trim() && hasEvidence(requirements, `${field}.${index}`)) ? values : null;
}
function isoDay(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}
function timestamp(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isoDay(value) === null ? null : Date.parse(`${value}T23:59:59.999+09:00`);
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || isoDay(value.slice(0, 10)) === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function region(value: string | null) {
  if (!value) return null;
  const text = value.trim();
  if (text === "전국") return { name: "전국", broadOnly: true };
  for (const [name, aliases] of REGION_ALIASES) {
    if (aliases.includes(text)) return { name, broadOnly: true };
    if (aliases.some((alias) => text.startsWith(`${alias} `))) return { name, broadOnly: false };
  }
  return null;
}
function institutionOnly(value: string) {
  return /^(?:연구기관|연구소|국공립연구기관|정부출연연구기관|공공연구기관|대학|대학교|대학산학협력단|대학교산학협력단|산학협력단|지자체|지방자치단체|광역자치단체|기초자치단체)(?:만|전용)?$/.test(normalized(value));
}
function certification(value: string) {
  const text = normalized(value);
  const names: Record<string, string> = {
    여성기업확인서: "여성기업", 여성기업확인: "여성기업", 벤처기업확인서: "벤처기업", 벤처기업확인: "벤처기업",
    장애인기업확인서: "장애인기업", 장애인기업확인: "장애인기업",
  };
  return names[text] || text;
}
function certificationsComplete(profile: MatchProfile) {
  return profile.certifications !== null && !profile.missingFields.some((field) => /certificat|인증/i.test(field));
}
function industry(value: string) {
  const text = normalized(value);
  if (["유흥", "유흥업", "유흥주점업", "일반유흥주점업", "무도유흥주점업"].includes(text)) return "유흥";
  if (["도박", "도박업", "도박장운영업"].includes(text)) return "도박";
  return text;
}

function anniversary(founded: number, years: number) {
  const date = new Date(founded);
  const year = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay));
}

/** Score only a clearly labelled grant; loans, budgets and self-pay figures are not interchangeable. */
function supportScore(requirements: Requirements) {
  if (!requirements.support_amount_text || !hasEvidence(requirements, "support_amount_text")) return 0;
  const evidence = requirements.evidence!.support_amount_text;
  const text = `${requirements.support_amount_text} ${evidence}`;
  if (!/지원금|보조금|사업화\s*자금|지원\s*한도|기업당\s*지원|업체당\s*지원|과제당\s*지원/.test(text)
    || /대출|융자|보증|총\s*사업비|총\s*예산|전체\s*예산|자부담|매출액/.test(text)) return 0;
  const amounts = [...requirements.support_amount_text.replace(/[,\s]/g, "")
    .matchAll(/((?:\d+(?:\.\d+)?(?:조|억|천만|백만|십만|만|천|백)?)+)원/g)].map((match) => {
    const multipliers: Record<string, number> = { 조: 1e12, 억: 1e8, 천만: 1e7, 백만: 1e6, 십만: 1e5, 만: 1e4, 천: 1e3, 백: 1e2 };
    return [...match[1].matchAll(/(\d+(?:\.\d+)?)(조|억|천만|백만|십만|만|천|백)?/g)]
      .reduce((sum, token) => sum + Number(token[1]) * (multipliers[token[2]] || 1), 0);
  }).filter((value) => Number.isFinite(value) && value > 0);
  // Multiple amounts may refer to different tracks; leave their interpretation to the reader.
  if (amounts.length !== 1) return 0;
  const amount = amounts[0];
  return amount >= 1e8 ? 30 : amount >= 5e7 ? 20 : amount >= 1e7 ? 10 : 5;
}

function scoring(requirements: Requirements, profile: MatchProfile, now: number, deadline: number | null) {
  const reasons: string[] = [];
  let score = supportScore(requirements);
  if (score) reasons.push(`명시된 지원금 규모 +${score}`);
  if (Number.isFinite(now) && deadline !== null && deadline - now >= 7 * DAY) {
    score += 5; reasons.push("마감 여유 7일 이상 +5");
  }
  if (profile.hasSupportHistory) { score += 5; reasons.push("과거 지원사업 이력 +5"); }
  const held = new Set((certificationsComplete(profile) ? profile.certifications! : []).map(certification));
  const awarded = new Set<string>();
  for (const [index, bonus] of (requirements.bonus_points || []).entries()) {
    if (bonus.item && bonus.points !== null && Number.isFinite(bonus.points) && bonus.points > 0
      && hasEvidence(requirements, `bonus_points.${index}.item`) && hasEvidence(requirements, `bonus_points.${index}.points`)
      && held.has(certification(bonus.item)) && !awarded.has(certification(bonus.item))) {
      const points = Math.min(10, bonus.points);
      awarded.add(certification(bonus.item));
      score += points; reasons.push(`현재 인증과 일치하는 가점: ${bonus.item} +${points}`);
    }
  }
  return { score, reasons };
}

/** Conservative screening only. Unknown data never becomes a rejection or a score penalty. */
export function matchProgram(requirements: Requirements, profiles: MatchProfile[], options: MatchOptions): ProgramMatch[] {
  const now = options.now instanceof Date ? options.now.getTime()
    : typeof options.now === "number" ? options.now : Date.parse(options.now);
  const documentDeadline = hasEvidence(requirements, "deadline_at") ? timestamp(requirements.deadline_at) : null;
  const deadline = documentDeadline ?? timestamp(options.programDeadlineAt);
  const regions = list(requirements, "regions");
  const types = list(requirements, "target_types");
  const included = list(requirements, "industries_included");
  const excluded = list(requirements, "industries_excluded");
  const certifications = list(requirements, "required_certifications");
  const geographic = regions?.map(region);
  const regionEvidence = regions?.map((_, index) => requirements.evidence![`regions.${index}`]).join(" ") || "";
  const simpleRegion = geographic?.every((entry) => entry?.broadOnly)
    && !/이전|전입|지점|예정|제외|일부/.test(regionEvidence);
  const allowedRegions = new Set(geographic?.map((entry) => entry?.name));
  const allRegionsMismatch = Boolean(profiles.length && simpleRegion && !allowedRegions.has("부산") && !allowedRegions.has("전국")
    && profiles.every((profile) => {
      const location = region(profile.region);
      return location && location.name !== "전국" && !allowedRegions.has(location.name);
    }));
  const targetEvidence = types?.map((_, index) => requirements.evidence![`target_types.${index}`]).join(" ") || "";
  const allInstitutions = Boolean(types?.length && types.every(institutionOnly)
    && !/기업|창업|소상공인|사업자|협약|컨소시엄|공동|주관|참여/.test(targetEvidence));

  return profiles.map((profile) => {
    const mismatches: string[] = [];
    const unknowns: string[] = [];
    if (Number.isFinite(now) && deadline !== null && deadline < now) mismatches.push("공고 마감이 지남");
    if (allInstitutions) mismatches.push("대상이 연구기관·대학·지자체 전용");
    if (allRegionsMismatch) mismatches.push("부산·전국 공고가 아니며 대상 전원의 확인된 지역과 불일치");
    if (!Number.isFinite(now)) unknowns.push("판정 기준 시각 정보 부족");
    if (deadline === null) unknowns.push("공고 마감 시각 정보 부족");
    const missing = new Set(profile.missingFields);
    if (!profile.region) missing.add("region");
    if (!profile.foundedOn) missing.add("founded_on");
    if (profile.industries === null) missing.add("industries");
    if (missing.size) unknowns.push(`프로필 정보 부족: ${[...missing].sort().join(", ")}`);
    if (!regions) unknowns.push("공고 지역 요건의 확정 근거 정보 부족");
    else if (!simpleRegion || !region(profile.region)) unknowns.push("지역 세부 요건 또는 대상 지역 정보 부족");
    else if (!allowedRegions.has("전국") && !allowedRegions.has(region(profile.region)!.name) && !allRegionsMismatch) {
      unknowns.push("지역 요건 추가 확인 필요: 대상 전원의 불일치가 확정되지 않음");
    }
    if (!types) unknowns.push("공고 대상 요건의 확정 근거 정보 부족");
    else if (types.every(institutionOnly) && !allInstitutions) unknowns.push("기관과 기업의 참여 범위는 정독 확인 필요");

    const age = requirements.business_age;
    if (age && age.min_years === null && age.max_years === null) {
      unknowns.push("업력의 엄격 경계 또는 예외 조건은 정독 확인 필요");
    } else if (age) {
      const founded = isoDay(profile.foundedOn);
      const asOf = hasEvidence(requirements, "business_age.as_of") ? isoDay(age.as_of) : null;
      const ageEvidence = ["min_years", "max_years", "basis", "as_of"].map((key) => requirements.evidence?.[`business_age.${key}`] || "").join(" ");
      if (founded === null || asOf === null || founded > asOf || !age.basis || !hasEvidence(requirements, "business_age.basis")) {
        unknowns.push("업력 판정 정보 부족: 설립일과 원문 기준일·산정 기준 확인 필요");
      } else if ((age.min_years !== null && age.max_years !== null && age.min_years > age.max_years)
        || /다만|예외|특례|신\s*산업|딥테크|초격차|간주|면제|\d\s*년\s*(?:미만|초과)/.test(ageEvidence)) {
        unknowns.push("업력 범위 상충 또는 예외 조건은 정독 확인 필요");
      }
      else {
        for (const [key, label] of [["min_years", "최소"], ["max_years", "최대"]] as const) {
          const years = age[key];
          if (years === null) continue;
          if (!hasEvidence(requirements, `business_age.${key}`) || !Number.isInteger(years) || years < 0) {
            unknowns.push(`업력 ${label} 범위의 확정 근거 정보 부족`); continue;
          }
          const boundary = anniversary(founded, years);
          if (key === "min_years" && boundary > asOf) mismatches.push(`원문 기준일 ${age.as_of} 기준 업력 ${years}년 미달`);
          if (key === "max_years" && boundary < asOf) mismatches.push(`원문 기준일 ${age.as_of} 기준 업력 ${years}년 초과`);
        }
      }
    }
    if (requirements.industries_excluded?.length && !excluded) unknowns.push("제외 업종의 확정 근거 정보 부족");
    if (excluded?.length) {
      if (profile.industries === null || !profile.industries.length) unknowns.push("제외 업종 비교 정보 부족: 현재 업종 확인 필요");
      else {
        const found = excluded.find((item) => profile.industries!.some((held) => industry(held) === industry(item)));
        if (found) mismatches.push(`원문에서 제외한 업종에 해당: ${found}`);
        else if (excluded.some((item) => profile.industries!.some((held) => {
          const a = industry(item), b = industry(held);
          return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
        }))) unknowns.push("제외 업종의 범주 비교는 정독 확인 필요");
      }
    }
    if (requirements.required_certifications?.length && !certifications) unknowns.push("필수 인증의 확정 근거 정보 부족");
    if (certifications?.length) {
      const evidence = certifications.map((_, index) => requirements.evidence![`required_certifications.${index}`]).join(" ");
      if (!certificationsComplete(profile)) unknowns.push("필수 인증 비교 정보 부족: 현재 인증 보유 현황 확인 필요");
      else if (/또는|혹은|택\s*1|택일|중\s*(?:하나|1|한)|하나\s*이상|우대|가점|권장|선택|면제|해당\s*시/.test(evidence)) {
        unknowns.push("필수 인증의 선택·예외 조건은 정독 확인 필요");
      }
      else {
        const held = new Set(profile.certifications!.map(certification));
        const missingCertifications = certifications.filter((item) => !held.has(certification(item)));
        if (missingCertifications.length) mismatches.push(`필수 인증 미보유가 확인됨: ${missingCertifications.join(", ")}`);
      }
    }
    // Inclusion and size constraints are left for reading; they are outside automatic rejection rules.
    if (requirements.industries_included?.length && (!included || !profile.industries?.some((held) => included.some((item) => industry(held) === industry(item))))) {
      unknowns.push("포함 업종 요건은 정독 확인 필요");
    }
    for (const [key, field, label] of [["max_employees", "employees", "상시근로자"], ["max_revenue_krw", "revenueKrw", "매출"]] as const) {
      const limit = requirements.size?.[key];
      if (limit !== null && limit !== undefined
        && (!hasEvidence(requirements, `size.${key}`) || profile[field] === null || profile[field] > limit)) {
        unknowns.push(`${label} 상한 요건은 정독 확인 필요`);
      }
    }
    const scored = scoring(requirements, profile, now, deadline);
    const verdict = mismatches.length ? "mismatch" : unknowns.length ? "unknown" : "candidate";
    return {
      targetKind: profile.targetKind, targetId: profile.targetId, targetName: profile.targetName, verdict,
      reasons: [...new Set([...mismatches, ...unknowns, ...scored.reasons, ...(verdict === "candidate" ? ["명백한 제외 요건에 해당하지 않음"] : [])])],
      score: scored.score,
    };
  });
}

/** A program occupies one reading slot even if several targets match; unknowns stay eligible. */
export function rankDailyCandidates(matches: RankedProgramMatch[], limit = 8): string[] {
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.min(8, Math.floor(limit))) : 8;
  const scores = new Map<string, number>();
  for (const match of matches) {
    if (match.verdict === "mismatch" || !match.programId.trim()) continue;
    const score = Number.isFinite(match.score) ? Math.max(0, match.score) : 0;
    scores.set(match.programId, Math.max(scores.get(match.programId) ?? 0, score));
  }
  return [...scores].sort(([a, scoreA], [b, scoreB]) => scoreB - scoreA || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, maximum).map(([programId]) => programId);
}
