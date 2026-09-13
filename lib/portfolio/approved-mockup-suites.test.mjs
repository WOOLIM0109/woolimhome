import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_16X9_BACKGROUNDS,
  APPROVED_16X9_BODY_TEMPLATE_LIST,
  APPROVED_16X9_TEMPLATES,
  APPROVED_16X9_TEMPLATE_VERSION,
} from "./approved-16x9-templates.ts";
import {
  APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_LIST,
  APPROVED_A4_LANDSCAPE_TEMPLATES,
  APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
} from "./approved-a4-landscape-templates.ts";
import {
  APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST,
  APPROVED_A4_PORTRAIT_TEMPLATES,
  APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
} from "./approved-a4-portrait-templates.ts";
import {
  APPROVED_MOCKUP_DUPLICATE_POLICY,
  APPROVED_MOCKUP_SUITE_CONTRACTS,
  APPROVED_MOCKUP_SUITES,
  approvedMockupSuiteTemplates,
  getApprovedMockupSuite,
  getApprovedMockupSuiteContract,
  getApprovedMockupSuiteByVersion,
  getRegisteredApprovedMockupSuite,
  matchesApprovedBodyTemplateSet,
  matchesApprovedTemplateSet,
} from "./approved-mockup-suites.ts";

function assertDeepFrozen(value, path = "value") {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) {
      assertDeepFrozen(descriptor.value, `${path}.${String(key)}`);
    }
  }
}

test("registers only the three approved document shapes", () => {
  assert.deepEqual(
    APPROVED_MOCKUP_SUITES.map((suite) => suite.aspectClass),
    ["16:9", "a4_landscape", "a4_portrait"],
  );
  assert.equal(getRegisteredApprovedMockupSuite("16:9")?.aspectClass, "16:9");
  assert.equal(getRegisteredApprovedMockupSuite("a4_landscape")?.aspectClass, "a4_landscape");
  assert.equal(getRegisteredApprovedMockupSuite("a4_portrait")?.aspectClass, "a4_portrait");
  assert.equal(getRegisteredApprovedMockupSuite("4:3"), null);
  assert.equal(getRegisteredApprovedMockupSuite("unknown"), null);
});

test("keeps the portrait candidate outside the current production lookup", () => {
  assert.equal(getApprovedMockupSuite("16:9")?.aspectClass, "16:9");
  assert.equal(getApprovedMockupSuite("a4_landscape")?.aspectClass, "a4_landscape");
  assert.equal(getApprovedMockupSuite("a4_portrait"), null);
  assert.equal(getApprovedMockupSuite("4:3"), null);
  assert.equal(getApprovedMockupSuite("unknown"), null);
});

test("recognizes only the current registered template versions", () => {
  assert.equal(
    getApprovedMockupSuiteByVersion(APPROVED_16X9_TEMPLATE_VERSION)?.aspectClass,
    "16:9",
  );
  assert.equal(
    getApprovedMockupSuiteByVersion(APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION)?.aspectClass,
    "a4_landscape",
  );
  assert.equal(
    getApprovedMockupSuiteByVersion(APPROVED_A4_PORTRAIT_TEMPLATE_VERSION)?.aspectClass,
    "a4_portrait",
  );
  assert.equal(getApprovedMockupSuiteByVersion("approved-a4-landscape-v0"), null);
  assert.equal(getApprovedMockupSuiteByVersion("approved-a4-portrait-v0"), null);
  assert.equal(getApprovedMockupSuiteByVersion(null), null);
});

test("matches a complete body set only to the suite that owns it", () => {
  const a4Ids = APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_LIST.map((template) => template.id);
  assert.equal(matchesApprovedBodyTemplateSet({
    templateIds: a4Ids,
    version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  })?.aspectClass, "a4_landscape");
  assert.equal(matchesApprovedBodyTemplateSet({
    templateIds: a4Ids,
    version: APPROVED_16X9_TEMPLATE_VERSION,
  }), null);
  assert.equal(matchesApprovedBodyTemplateSet({
    templateIds: a4Ids.slice(0, -1),
    version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  }), null);
  assert.equal(matchesApprovedBodyTemplateSet({
    templateIds: [a4Ids[0], a4Ids[2], a4Ids[3]],
    version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  }), null);
  assert.equal(matchesApprovedBodyTemplateSet({
    templateIds: [a4Ids[0], a4Ids[0], a4Ids[2], a4Ids[3]],
    version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  }), null);
  assert.equal(matchesApprovedBodyTemplateSet({
    templateIds: APPROVED_16X9_BODY_TEMPLATE_LIST.map((template) => template.id),
    version: APPROVED_16X9_TEMPLATE_VERSION,
  })?.aspectClass, "16:9");
  assert.equal(matchesApprovedBodyTemplateSet({
    templateIds: APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST.map((template) => template.id),
    version: APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  })?.aspectClass, "a4_portrait");
});

test("matches only a complete five-template set with its exact version", () => {
  for (const suite of APPROVED_MOCKUP_SUITES) {
    const ids = approvedMockupSuiteTemplates(suite).map((template) => template.id);
    assert.equal(ids.length, 5);
    assert.equal(matchesApprovedTemplateSet({
      templateIds: ids,
      version: suite.version,
    })?.suiteId, suite.suiteId);
    assert.equal(matchesApprovedTemplateSet({
      templateIds: ids.slice(1),
      version: suite.version,
    }), null);
    assert.equal(matchesApprovedTemplateSet({
      templateIds: [...ids, ids[0]],
      version: suite.version,
    }), null);
    assert.equal(matchesApprovedTemplateSet({
      templateIds: [ids[0], ids[0], ...ids.slice(2)],
      version: suite.version,
    }), null);
  }

  const portraitIds = [
    APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-thumbnail-1"].id,
    ...APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST.map((template) => template.id),
  ];
  assert.equal(matchesApprovedTemplateSet({
    templateIds: portraitIds,
    version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  }), null);
  assert.equal(matchesApprovedTemplateSet({
    templateIds: portraitIds,
    version: "unknown-template-version",
  }), null);
});

test("derives every strict slot requirement and minimum from template geometry", () => {
  const expectedCapacities = {
    "16:9": [7, 7, 7, 4, 8],
    a4_landscape: [7, 7, 7, 4, 6],
    a4_portrait: [2, 7, 3, 4, 2],
  };
  const expectedMinimums = { "16:9": 8, a4_landscape: 7, a4_portrait: 7 };

  assert.equal(APPROVED_MOCKUP_SUITE_CONTRACTS.length, 3);
  for (const contract of APPROVED_MOCKUP_SUITE_CONTRACTS) {
    assert.equal(getApprovedMockupSuiteContract(contract.aspectClass), contract);
    assert.deepEqual(
      contract.templates.map((template) => template.slotCapacity),
      expectedCapacities[contract.aspectClass],
    );
    assert.deepEqual(
      contract.templates.map((template) => template.requiredSlotCount),
      expectedCapacities[contract.aspectClass],
    );
    assert.equal(contract.minimumUniqueSlideCount, expectedMinimums[contract.aspectClass]);
    assert.equal(contract.duplicatePolicy, APPROVED_MOCKUP_DUPLICATE_POLICY);
  }
  assert.equal(getApprovedMockupSuiteContract("4:3"), null);
  assert.equal(getApprovedMockupSuiteContract("unknown"), null);
});

test("keeps suite contracts attached to their own thumbnail and four bodies", () => {
  const templateLists = {
    "16:9": [
      APPROVED_16X9_TEMPLATES["thumbnail-1"],
      ...APPROVED_16X9_BODY_TEMPLATE_LIST,
    ],
    a4_landscape: [
      APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-thumbnail-1"],
      ...APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_LIST,
    ],
    a4_portrait: [
      APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-thumbnail-1"],
      ...APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST,
    ],
  };

  for (const contract of APPROVED_MOCKUP_SUITE_CONTRACTS) {
    const templates = templateLists[contract.aspectClass];
    assert.deepEqual(
      contract.templates.map(({ templateId, kind }) => ({ templateId, kind })),
      templates.map((template) => ({ templateId: template.id, kind: template.kind })),
    );
    assert.equal(contract.templates.filter((template) => template.kind === "thumbnail").length, 1);
    assert.equal(contract.templates.filter((template) => template.kind === "body").length, 4);
    assert.deepEqual(contract.duplicatePolicy, {
      withinTemplate: "forbid",
      acrossTemplates: "allow_after_unique",
      reuseDistribution: "balanced",
    });
  }
});

test("deep-freezes approved geometry and strict contracts at runtime", () => {
  assertDeepFrozen(APPROVED_16X9_BACKGROUNDS, "APPROVED_16X9_BACKGROUNDS");
  assertDeepFrozen(APPROVED_MOCKUP_SUITES, "APPROVED_MOCKUP_SUITES");
  assertDeepFrozen(APPROVED_MOCKUP_DUPLICATE_POLICY, "APPROVED_MOCKUP_DUPLICATE_POLICY");
  assertDeepFrozen(APPROVED_MOCKUP_SUITE_CONTRACTS, "APPROVED_MOCKUP_SUITE_CONTRACTS");
});
