import {
  APPROVED_16X9_BACKGROUNDS,
  APPROVED_16X9_BODY_TEMPLATE_LIST,
  APPROVED_16X9_TEMPLATES,
  APPROVED_16X9_TEMPLATE_SUITE_ID,
  APPROVED_16X9_TEMPLATE_VERSION,
  resolveApprovedMockupSlots,
  type ApprovedMockupTemplateSpec,
} from "./approved-16x9-templates.ts";
import {
  APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_LIST,
  APPROVED_A4_LANDSCAPE_TEMPLATES,
  APPROVED_A4_LANDSCAPE_TEMPLATE_SUITE_ID,
  APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
} from "./approved-a4-landscape-templates.ts";
import {
  APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST,
  APPROVED_A4_PORTRAIT_TEMPLATES,
  APPROVED_A4_PORTRAIT_TEMPLATE_SUITE_ID,
  APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
} from "./approved-a4-portrait-templates.ts";

export type ApprovedMockupSuiteAspectClass = "16:9" | "a4_landscape" | "a4_portrait";

export type ApprovedMockupSuite = Readonly<{
  aspectClass: ApprovedMockupSuiteAspectClass;
  suiteId: string;
  version: string;
  thumbnail: ApprovedMockupTemplateSpec<string, string, number>;
  bodyTemplates: readonly ApprovedMockupTemplateSpec<string, string, number>[];
}>;

/**
 * `as const` protects callers at compile time only. Approved mockup geometry is
 * also a production contract, so freeze every nested array and coordinate at
 * runtime before exposing it through the registry.
 */
function deepFreeze<T>(value: T): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }
  if (Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

// Background definitions are part of the approved visual contract too. Keep
// the original exported object immutable rather than freezing only its IDs.
deepFreeze(APPROVED_16X9_BACKGROUNDS);

const APPROVED_16X9_SUITE = {
  aspectClass: "16:9",
  suiteId: APPROVED_16X9_TEMPLATE_SUITE_ID,
  version: APPROVED_16X9_TEMPLATE_VERSION,
  thumbnail: APPROVED_16X9_TEMPLATES["thumbnail-1"],
  bodyTemplates: APPROVED_16X9_BODY_TEMPLATE_LIST,
} as const satisfies ApprovedMockupSuite;

const APPROVED_A4_LANDSCAPE_SUITE = {
  aspectClass: "a4_landscape",
  suiteId: APPROVED_A4_LANDSCAPE_TEMPLATE_SUITE_ID,
  version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  thumbnail: APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-thumbnail-1"],
  bodyTemplates: APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_LIST,
} as const satisfies ApprovedMockupSuite;

const APPROVED_A4_PORTRAIT_SUITE = {
  aspectClass: "a4_portrait",
  suiteId: APPROVED_A4_PORTRAIT_TEMPLATE_SUITE_ID,
  version: APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  thumbnail: APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-thumbnail-1"],
  bodyTemplates: APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST,
} as const satisfies ApprovedMockupSuite;

export const APPROVED_MOCKUP_SUITES = deepFreeze([
  APPROVED_16X9_SUITE,
  APPROVED_A4_LANDSCAPE_SUITE,
  APPROVED_A4_PORTRAIT_SUITE,
] as const satisfies readonly ApprovedMockupSuite[]);

/**
 * Strict approved rendering never leaves a defined slot empty. A source slide
 * may be reused across different templates only after every available unique
 * slide has been used, and reuse must stay balanced across the whole suite.
 * The existing renderer does not consume this contract yet; the strict stage-1
 * entry point opts into it without changing legacy pipeline behaviour.
 */
export const APPROVED_MOCKUP_DUPLICATE_POLICY = deepFreeze({
  withinTemplate: "forbid",
  acrossTemplates: "allow_after_unique",
  reuseDistribution: "balanced",
} as const);

export type ApprovedMockupTemplateContract = Readonly<{
  templateId: string;
  kind: "thumbnail" | "body";
  slotCapacity: number;
  requiredSlotCount: number;
}>;

export type ApprovedMockupSuiteContract = Readonly<{
  aspectClass: ApprovedMockupSuiteAspectClass;
  suiteId: string;
  version: string;
  minimumUniqueSlideCount: number;
  duplicatePolicy: typeof APPROVED_MOCKUP_DUPLICATE_POLICY;
  templates: readonly ApprovedMockupTemplateContract[];
}>;

export function approvedMockupSuiteTemplates(suite: ApprovedMockupSuite) {
  return [suite.thumbnail, ...suite.bodyTemplates] as const;
}

function createApprovedMockupSuiteContract(
  suite: ApprovedMockupSuite,
): ApprovedMockupSuiteContract {
  const templates = approvedMockupSuiteTemplates(suite).map((template) => {
    const slotCapacity = resolveApprovedMockupSlots(template).length;
    return {
      templateId: template.id,
      kind: template.kind,
      slotCapacity,
      // Every approved slot is required by the new strict rendering path.
      requiredSlotCount: slotCapacity,
    } as const;
  });
  return deepFreeze({
    aspectClass: suite.aspectClass,
    suiteId: suite.suiteId,
    version: suite.version,
    minimumUniqueSlideCount: Math.max(...templates.map((template) => template.slotCapacity)),
    duplicatePolicy: APPROVED_MOCKUP_DUPLICATE_POLICY,
    templates,
  });
}

export const APPROVED_MOCKUP_SUITE_CONTRACTS: readonly ApprovedMockupSuiteContract[] =
  deepFreeze(APPROVED_MOCKUP_SUITES.map(createApprovedMockupSuiteContract));

/**
 * Current production callers use only the two suites that were already wired
 * before the stage-one portrait review. Candidate suites remain available to
 * strict QA through `getRegisteredApprovedMockupSuite` until later integration.
 */
export function getApprovedMockupSuite(aspectClass: string) {
  if (aspectClass !== "16:9" && aspectClass !== "a4_landscape") return null;
  return getRegisteredApprovedMockupSuite(aspectClass);
}

/** Looks up every registered suite, including candidates not yet enabled live. */
export function getRegisteredApprovedMockupSuite(aspectClass: string) {
  return APPROVED_MOCKUP_SUITES.find((suite) => suite.aspectClass === aspectClass) || null;
}

export function getApprovedMockupSuiteContract(aspectClass: string) {
  return APPROVED_MOCKUP_SUITE_CONTRACTS.find(
    (contract) => contract.aspectClass === aspectClass,
  ) || null;
}

export function getApprovedMockupSuiteByVersion(version: unknown) {
  if (typeof version !== "string") return null;
  return APPROVED_MOCKUP_SUITES.find((suite) => suite.version === version) || null;
}

export function matchesApprovedBodyTemplateSet(input: {
  templateIds: readonly string[];
  version: unknown;
}) {
  const suite = getApprovedMockupSuiteByVersion(input.version);
  if (!suite || input.templateIds.length !== suite.bodyTemplates.length) return null;
  const expected = new Set<string>(suite.bodyTemplates.map((template) => template.id));
  const actual = new Set(input.templateIds);
  if (actual.size !== expected.size || [...actual].some((id) => !expected.has(id))) return null;
  return suite;
}

/** Matches the complete five-template whitelist, including the thumbnail. */
export function matchesApprovedTemplateSet(input: {
  templateIds: readonly string[];
  version: unknown;
}) {
  const suite = getApprovedMockupSuiteByVersion(input.version);
  if (!suite) return null;
  const expectedIds = approvedMockupSuiteTemplates(suite).map((template) => template.id);
  if (input.templateIds.length !== expectedIds.length) return null;
  const expected = new Set<string>(expectedIds);
  const actual = new Set(input.templateIds);
  if (actual.size !== expected.size || [...actual].some((id) => !expected.has(id))) return null;
  return suite;
}
