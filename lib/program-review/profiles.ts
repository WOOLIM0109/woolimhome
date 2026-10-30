import { entityTargetName } from "./customer-profiles.ts";
export type MatchProfile = {
  targetKind: "self" | "customer";
  targetId: string;
  targetName: string;
  region: string | null;
  foundedOn: string | null;
  businessType: string | null;
  industries: string[] | null;
  employees: number | null;
  revenueKrw: number | null;
  certifications: string[] | null;
  hasSupportHistory: boolean;
  missingFields: string[];
  certificationsComplete?: boolean;
};

export const SELF_PROFILES = [
  { id: "woolim-company", name: "울림컴퍼니", aliases: [] as string[] },
  { id: "cellavento", name: "셀라벤토", aliases: ["로닛"] },
].map((profile) => ({
  ...profile,
  region: null, founded_on: null, business_type: null, industries: null,
  employees: null, revenue_band: null, certifications: null, notes: null,
}));

// Verified against the authenticated production API and its official source.
// These are field names only; no customer response or freeform value is retained.
export const WOOLIMWORKS_API_FIELD_NAMES = {
  customers: [
    "id", "name", "companyName", "contactName", "representative", "companies", "region", "source",
    "customerKind", "businessRegistrationNumber", "corporateRegistrationNumber", "foundedOn", "staffContact",
    "contactLink", "businessSummary", "status", "displayStatus", "contractStatus", "assigneeId", "assigneeName",
    "nextActionDate", "memo", "aliases", "projectCount", "activeProjectCount", "completedProjectCount",
    "quoteCount", "supportProjectCount", "lastActivityAt", "createdAt", "updatedAt",
  ],
  aliases: ["id", "alias", "normalizedAlias", "source"],
  projects: [
    "id", "customerId", "customerName", "title", "projectType", "projectCategory", "status", "priority",
    "assigneeId", "assigneeName", "startDate", "dueDate", "paymentStatus", "submissionStatus", "amount", "memo",
    "createdAt", "updatedAt",
  ],
  customerDetail: ["customer", "projects", "legacyPrograms", "quoteRequests"],
  legacyPrograms: [
    "id", "customerId", "businessItem", "agencyName", "programName", "programCategory", "link", "deadline",
    "status", "note", "createdAt", "updatedAt",
  ],
} as const;

export const CUSTOMER_ACTIVITY_BASIS =
  "external_projects.createdAt 등록일 기준 최근 18개월(경계 포함), 또는 고객사 지원사업·기업인증 프로젝트/legacyPrograms 이력. updatedAt·lastActivityAt은 기간 판정에 사용하지 않음.";

export type CachedCustomerProfile = {
  id: string;
  name: string;
  region: string | null;
  foundedOn: string | null;
  hasSupportHistory: boolean;
};

export type AgentCustomer = {
  id: string;
  name: string;
  region: string | null;
  foundedOn: string | null;
  /** 지원사업 매칭 대상인지 가리는 값들. 울림웍스가 주는 그대로입니다. */
  displayStatus: string | null;
  contractStatus: string | null;
  supportProjects: number;
};

export type AgentProject = {
  id: string;
  customerId: string;
  projectCategory: string;
  createdAt: string;
};

export function unknownProfileFields(region: string | null, foundedOn: string | null) {
  return [
    ...(region ? [] : ["region"]), ...(foundedOn ? [] : ["foundedOn"]),
    "businessType", "industries", "employees", "revenueKrw", "certifications",
  ];
}

export function customerMatchProfile(customer: CachedCustomerProfile): MatchProfile {
  return {
    targetKind: "customer", targetId: customer.id, targetName: customer.name,
    region: customer.region, foundedOn: customer.foundedOn,
    businessType: null, industries: null, employees: null, revenueKrw: null, certifications: null,
    hasSupportHistory: customer.hasSupportHistory,
    missingFields: unknownProfileFields(customer.region, customer.foundedOn),
  };
}

/** Approved facts are read from the private store; source code contains placeholders only. */
export function selfMatchProfiles(rows?: readonly unknown[]): MatchProfile[] {
  if (rows === undefined) return SELF_PROFILES.map((profile) => ({
    targetKind: "self", targetId: profile.id, targetName: profile.name,
    region: null, foundedOn: null, businessType: null, industries: null,
    employees: null, revenueKrw: null, certifications: null, hasSupportHistory: false,
    missingFields: unknownProfileFields(null, null),
  }));
  const invalid = () => { throw new Error("자사 프로필 형식이 올바르지 않습니다."); };
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : invalid();
  const text = (value: unknown): string | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") return invalid();
    const trimmed = value.trim();
    return !trimmed || /^(?:확인\s*필요|미확인|불명|unknown|pending)$/i.test(trimmed) ? null : trimmed;
  };
  const texts = (value: unknown): string[] | null => {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value)) return invalid();
    return [...new Set(value.map(text).filter((item): item is string => item !== null))];
  };
  const numeric = (value: unknown): number | null => {
    if (value === undefined || value === null || (typeof value === "string" && text(value) === null)) return null;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
  };
  if (rows.length !== SELF_PROFILES.length) return invalid();
  const seen = new Set<string>();
  const profiles = rows.map((value) => {
    const row = object(value), profile = object(row.profile);
    if (typeof row.id !== "string" || !SELF_PROFILES.some((entry) => entry.id === row.id) || seen.has(row.id)) return invalid();
    seen.add(row.id);
    const name = text(row.name);
    if (!name || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1) return invalid();
    let region = text(profile.region);
    // Preserve a known city while leaving an explicitly unconfirmed district blank.
    if (region?.includes("확인 필요")) region = text(region.replace(/\s*[（(][^）)]*확인\s*필요[^）)]*[）)]/g, ""));
    const founded = text(profile.founded_on);
    const date = founded && /^\d{4}-\d{2}-\d{2}$/.test(founded) ? Date.parse(`${founded}T00:00:00Z`) : NaN;
    const foundedOn = Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === founded ? founded : null;
    const businessType = text(profile.business_type), industries = texts(profile.industries);
    const employees = numeric(profile.employees), revenueKrw = numeric(profile.revenue_krw);
    const rawCertifications = texts(profile.certifications);
    const certifications = rawCertifications?.filter((item) => !/확인\s*필요|미확인|유효기간.*확인/.test(item)) ?? null;
    if (profile.certifications_complete !== undefined && typeof profile.certifications_complete !== "boolean") return invalid();
    if (profile.has_support_history !== undefined && typeof profile.has_support_history !== "boolean") return invalid();
    const certificationsComplete = profile.certifications_complete === true && certifications !== null
      && certifications.length === rawCertifications?.length;
    return {
      targetKind: "self" as const, targetId: row.id, targetName: name, region, foundedOn, businessType, industries,
      employees, revenueKrw, certifications, certificationsComplete, hasSupportHistory: profile.has_support_history === true,
      missingFields: [
        ...(region ? [] : ["region"]), ...(foundedOn ? [] : ["foundedOn"]), ...(businessType ? [] : ["businessType"]),
        ...(industries !== null ? [] : ["industries"]), ...(employees !== null ? [] : ["employees"]),
        ...(revenueKrw !== null ? [] : ["revenueKrw"]), ...(certificationsComplete ? [] : ["certifications"]),
      ],
    };
  });
  return SELF_PROFILES.map((row) => profiles.find((profile) => profile.targetId === row.id)!);
}

/**
 * 적어 둔 고객사 요건으로 **사업자별** 판정 프로필을 만듭니다.
 *
 * 울림웍스에는 업종·직원수·매출·인증 칸이 없어서, 이 표에 적어 두지 않으면
 * 판정 축 7개 중 5개가 비어 있습니다 (`customerMatchProfile`).
 *
 * 적어 두지 않은 칸은 **null 로 둡니다.** 모르는 것을 아는 것처럼 채우면
 * 판정이 조용히 틀립니다. 지역·설립일은 적은 값이 없으면 울림웍스 값을 씁니다.
 */
export function customerEntityMatchProfile(
  customer: CachedCustomerProfile,
  entity: { entityKey: string; entityName: string; profile: Record<string, unknown> },
  options: { targetId: string; several: boolean },
): MatchProfile {
  const stored = entity.profile ?? {};
  const one = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed && !/^(?:확인\s*필요|미확인|불명|unknown|pending)$/i.test(trimmed) ? trimmed : null;
  };
  const many = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    const items = [...new Set(value.map(one).filter((item): item is string => item !== null))];
    return items.length ? items : null;
  };
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

  const region = one(stored.region) ?? customer.region;
  const founded = one(stored.founded_on);
  const foundedOn = founded && /^\d{4}-\d{2}-\d{2}$/.test(founded) ? founded : customer.foundedOn;
  const businessType = one(stored.business_type);
  const industries = many(stored.industries);
  const employees = count(stored.employees);
  const revenueKrw = count(stored.revenue_krw);
  const certifications = many(stored.certifications);
  // 인증은 '적어 둔 것이 전부' 라고 확인해야 '없음' 으로 판정할 수 있습니다.
  const certificationsComplete = stored.certifications_complete === true;
  return {
    targetKind: "customer", targetId: options.targetId,
    targetName: entityTargetName(customer.name, entity.entityName, options.several),
    region, foundedOn, businessType, industries, employees, revenueKrw, certifications,
    certificationsComplete,
    hasSupportHistory: stored.has_support_history === true || customer.hasSupportHistory,
    missingFields: [
      ...(region ? [] : ["region"]), ...(foundedOn ? [] : ["foundedOn"]),
      ...(businessType ? [] : ["businessType"]), ...(industries !== null ? [] : ["industries"]),
      ...(employees !== null ? [] : ["employees"]), ...(revenueKrw !== null ? [] : ["revenueKrw"]),
      ...(certificationsComplete ? [] : ["certifications"]),
    ],
  };
}

/** Calendar months in Asia/Seoul, clamping month-end rather than overflowing it. */
export function customerActivityCutoff(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("프로필 기준 시각이 올바르지 않습니다.");
  const seoul = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = seoul.getUTCDate();
  seoul.setUTCDate(1);
  seoul.setUTCMonth(seoul.getUTCMonth() - 18);
  const lastDay = new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth() + 1, 0)).getUTCDate();
  seoul.setUTCDate(Math.min(day, lastDay));
  return new Date(seoul.getTime() - 9 * 60 * 60 * 1000);
}

export function hasRecentRegisteredProject(projects: AgentProject[], now: Date) {
  const cutoff = customerActivityCutoff(now).getTime();
  return projects.some((project) => {
    const registeredAt = Date.parse(project.createdAt);
    return Number.isFinite(registeredAt) && registeredAt >= cutoff && registeredAt <= now.getTime();
  });
}

export function hasCustomerSupportProject(projects: AgentProject[]) {
  return projects.some((project) => ["support_client", "certification"].includes(project.projectCategory));
}

export function activeCustomerProfile(
  customer: AgentCustomer,
  projects: AgentProject[],
  hasLegacyProgramHistory: boolean,
  now: Date,
): CachedCustomerProfile | null {
  const hasSupportHistory = hasLegacyProgramHistory || hasCustomerSupportProject(projects);
  if (!hasSupportHistory && !hasRecentRegisteredProject(projects, now)) return null;
  return { id: customer.id, name: customer.name, region: customer.region, foundedOn: customer.foundedOn, hasSupportHistory };
}
