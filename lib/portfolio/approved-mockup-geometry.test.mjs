import assert from "node:assert/strict";
import test from "node:test";

import { APPROVED_A4_PORTRAIT_TEMPLATES } from "./approved-a4-portrait-templates.ts";
import { inspectApprovedTemplateGeometry } from "./approved-mockup-geometry.ts";
import {
  APPROVED_MOCKUP_SUITES,
  approvedMockupSuiteTemplates,
} from "./approved-mockup-suites.ts";

test("all approved template geometries pass aspect, clipping, and edge checks", () => {
  for (const suite of APPROVED_MOCKUP_SUITES) {
    for (const template of approvedMockupSuiteTemplates(suite)) {
      const inspection = inspectApprovedTemplateGeometry(template);
      assert.equal(inspection.passed, true, `${template.id}: ${inspection.errors.join("; ")}`);
      assert.deepEqual(inspection.errors, []);
      assert.equal(inspection.slots.length > 0, true);
      assert.ok(inspection.slots.every((slot) => slot.visibleRatio > 0));
      assert.ok(inspection.slots.every((slot) => slot.aspectRelativeError <= 1e-8));
      assert.ok(inspection.alignments.every((alignment) => alignment.deviationPx <= 1e-5));
    }
  }
});

test("edgeAlignments catches fixed cards whose angle matches but top line bends", () => {
  const template = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-3-grid"];
  const bent = {
    ...template,
    fixedSlots: template.fixedSlots.map((slot) => slot.id === "left-2"
      ? { ...slot, y: slot.y + 12 }
      : slot),
  };
  const inspection = inspectApprovedTemplateGeometry(bent);

  assert.equal(inspection.passed, false);
  assert.ok(inspection.errors.some((error) => error.startsWith("fixed-1/top:")));
  assert.ok(!inspection.errors.some((error) => error.includes("공통 대각선 각도 불일치")));
  assert.equal(
    inspection.alignments.find(({ id, edge }) => id === "fixed-1" && edge === "top")
      ?.deviationPx,
    12,
  );
});

test("separate rails are checked internally without claiming cross-rail alignment", () => {
  const template = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-1-flatlay"];
  const shiftedSecondRail = {
    ...template,
    rails: template.rails.map((rail, index) => index === 1
      ? { ...rail, start: { x: rail.start.x + 37, y: rail.start.y + 29 } }
      : rail),
  };
  const inspection = inspectApprovedTemplateGeometry(shiftedSecondRail);

  assert.equal(inspection.passed, true, inspection.errors.join("; "));
  assert.deepEqual(new Set(inspection.alignments.map(({ id }) => id)), new Set(["top", "bottom"]));
  assert.ok(inspection.alignments.every(({ deviationPx }) => deviationPx <= 1e-5));
});
