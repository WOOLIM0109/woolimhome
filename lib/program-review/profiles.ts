export type MatchProfile = {
  targetKind: "self" | "customer";
  targetId: string;
  targetName: string;
  region: string | null;
  foundedOn: string | null;
  businessType: null;
  industries: string[] | null;
  employees: number | null;
  revenueKrw: number | null;
  certifications: string[] | null;
  hasSupportHistory: boolean;
  missingFields: string[];
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

export function selfMatchProfiles(): MatchProfile[] {
  return SELF_PROFILES.map((profile) => ({
    targetKind: "self", targetId: profile.id, targetName: profile.name,
    region: null, foundedOn: null, businessType: null, industries: null,
    employees: null, revenueKrw: null, certifications: null, hasSupportHistory: false,
    missingFields: unknownProfileFields(null, null),
  }));
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
