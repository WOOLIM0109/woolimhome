import type { ExpertKnowledge } from "./types";

type VerificationTextField = "raw_text" | "perspective" | "case_evidence" | "differentiator";

export type VerificationKind = "official" | "privacy";

export type VerificationImportItem = {
  type: VerificationKind;
  detail: string;
};

export type VerificationChecklistItem = {
  kind: VerificationKind;
  label: string;
  instruction: string;
  excerpt?: string;
};

export type KnowledgeVerification = {
  pending: boolean;
  completed: boolean;
  completedAt: string | null;
  items: VerificationChecklistItem[];
};

const TEXT_FIELDS: VerificationTextField[] = [
  "raw_text",
  "perspective",
  "case_evidence",
  "differentiator",
];

const OFFICIAL_PENDING = /\[(?:발행 전\s*)?공식 확인 필요(?:\s*:\s*([^\]]+))?\]/g;
const PRIVACY_PENDING = /\[익명화 필요(?:\s*:\s*([^\]]+))?\]/g;
const COMPLETED_MARKER = /\[(?:공식 확인|익명화) 완료:\s*(\d{4}-\d{2}-\d{2})(?:\s*\|\s*[^\]]+)?\]/g;
const ANY_CONTROL_MARKER = /\[(?:(?:발행 전\s*)?공식 확인 필요|익명화 필요)(?:\s*:\s*[^\]]+)?\]|\[(?:공식 확인|익명화) 완료:\s*\d{4}-\d{2}-\d{2}(?:\s*\|\s*[^\]]+)?\]/g;

function combinedText(item: Pick<ExpertKnowledge, VerificationTextField>) {
  return TEXT_FIELDS.map((field) => item[field]).filter(Boolean).join("\n");
}

function compact(value: string, max = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max).trim()}…` : normalized;
}

function sentences(value: string) {
  return stripVerificationControlText(value)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => compact(sentence))
    .filter((sentence) => sentence.length >= 12);
}

function uniqueChecklist(items: VerificationChecklistItem[]) {
  const keys = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.label}:${item.excerpt || ""}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function inferredOfficialItems(value: string): VerificationChecklistItem[] {
  const sourceSentences = sentences(value);
  const rules: Array<{
    label: string;
    instruction: string;
    pattern: RegExp;
  }> = [
    {
      label: "제도·공고의 최신 운영 여부",
      instruction: "해당 제도와 사업이 현재도 운영되는지, 명칭·대상·적용 조건이 달라지지 않았는지 공식 기관 자료로 확인하세요.",
      pattern: /정부|공공|벤처나라|지원사업|정책|제도|공고|기관|법령|규정|인증|TIPS|팁스/i,
    },
    {
      label: "통계·수치의 공식 출처",
      instruction: "통계와 수치의 원문 출처, 조사 기준일, 조사 대상과 단위를 확인하세요.",
      pattern: /통계|수치|지표|비율|퍼센트|%|경쟁률|\d[\d,.]*\s*(?:원|만원|억원|명|건|개|회|%|개월|년)/i,
    },
    {
      label: "성과·사례의 사실관계",
      instruction: "선정·합격·수령·투자·매출 등 성과가 실제 자료와 일치하고 공개 가능한 표현인지 확인하세요.",
      pattern: /선정|합격|수령|유치|투자|매출|지원금|성과|성공|증가|감소|달성/i,
    },
    {
      label: "기간·대상·지원 조건",
      instruction: "금액, 신청 기간, 지원 대상과 자격 조건이 최신 공고와 일치하는지 확인하세요.",
      pattern: /기간|마감|신청|자격|대상|조건|지원금|\d{4}\s*년|\d{1,2}\s*월|\d{1,2}\s*일/i,
    },
  ];

  return rules.flatMap((rule) => {
    const excerpt = sourceSentences.find((sentence) => rule.pattern.test(sentence));
    return excerpt ? [{ kind: "official" as const, label: rule.label, instruction: rule.instruction, excerpt }] : [];
  }).slice(0, 4);
}

function explicitItems(value: string, pattern: RegExp, kind: VerificationKind) {
  return [...value.matchAll(new RegExp(pattern.source, pattern.flags))]
    .map((match) => match[1]?.trim())
    .filter((detail): detail is string => Boolean(detail))
    .map((detail): VerificationChecklistItem => ({
      kind,
      label: kind === "privacy" ? "익명화·공개 범위" : "공식 사실관계",
      instruction: kind === "privacy"
        ? "고객명, 개인 정보, 계약 조건과 식별 가능한 사례 정보가 삭제되거나 공개 동의를 받았는지 확인하세요."
        : "표시된 사실을 최신 공식 원문과 대조하고 출처를 확보하세요.",
      excerpt: compact(detail),
    }));
}

export function getKnowledgeVerification(
  item: Pick<ExpertKnowledge, VerificationTextField>,
): KnowledgeVerification {
  const text = combinedText(item);
  const officialPending = new RegExp(OFFICIAL_PENDING.source).test(text);
  const privacyPending = new RegExp(PRIVACY_PENDING.source).test(text);
  const completedMatches = [...text.matchAll(new RegExp(COMPLETED_MARKER.source, COMPLETED_MARKER.flags))];
  const explicitOfficial = explicitItems(text, OFFICIAL_PENDING, "official");
  const explicitPrivacy = explicitItems(text, PRIVACY_PENDING, "privacy");
  const items: VerificationChecklistItem[] = [...explicitOfficial, ...explicitPrivacy];

  if (officialPending && explicitOfficial.length === 0) items.push(...inferredOfficialItems(text));
  if (privacyPending && explicitPrivacy.length === 0) {
    const privacyExcerpt = sentences(text).find((sentence) => /고객|고객사|대표|업체|기업|계약|사례|개인/i.test(sentence));
    items.push({
      kind: "privacy",
      label: "익명화·공개 범위",
      instruction: "고객명, 개인 정보, 계약 조건과 식별 가능한 사례 정보가 삭제되거나 공개 동의를 받았는지 확인하세요.",
      excerpt: privacyExcerpt,
    });
  }
  if ((officialPending || privacyPending) && items.length === 0) {
    items.push({
      kind: "official",
      label: "원문에 표시된 사실관계",
      instruction: "원문에 포함된 외부 사실과 공개 범위를 공식 자료 및 보유 증빙과 대조하세요.",
    });
  }

  const completedDates = completedMatches.map((match) => match[1]).sort();
  return {
    pending: officialPending || privacyPending,
    completed: completedMatches.length > 0,
    completedAt: completedDates.at(-1) || null,
    items: uniqueChecklist(items),
  };
}

export function stripVerificationControlText(value?: string | null) {
  if (!value) return value || "";
  return value
    .replace(new RegExp(ANY_CONTROL_MARKER.source, ANY_CONTROL_MARKER.flags), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function completeMarkers(value: string | null, completedAt: string) {
  if (!value) return value;
  return value
    .replace(new RegExp(OFFICIAL_PENDING.source, OFFICIAL_PENDING.flags), (_match, detail?: string) => (
      `[공식 확인 완료: ${completedAt}${detail?.trim() ? ` | ${detail.trim()}` : ""}]`
    ))
    .replace(new RegExp(PRIVACY_PENDING.source, PRIVACY_PENDING.flags), (_match, detail?: string) => (
      `[익명화 완료: ${completedAt}${detail?.trim() ? ` | ${detail.trim()}` : ""}]`
    ));
}

export function verificationCompletionChanges(
  item: Pick<ExpertKnowledge, VerificationTextField>,
  completedAt: string,
) {
  return Object.fromEntries(TEXT_FIELDS.map((field) => [field, completeMarkers(item[field], completedAt)])) as Record<
    VerificationTextField,
    string | null
  >;
}

function safeMarkerDetail(value: string) {
  return compact(value.replace(/[\[\]\r\n]/g, " "), 160);
}

export function serializeVerificationMarkers(items?: VerificationImportItem[]) {
  if (!items?.length) return "";
  const lines = items
    .filter((item) => (item.type === "official" || item.type === "privacy") && item.detail?.trim())
    .slice(0, 6)
    .map((item) => `[${item.type === "privacy" ? "익명화" : "공식 확인"} 필요: ${safeMarkerDetail(item.detail)}]`);
  return [...new Set(lines)].join("\n");
}
