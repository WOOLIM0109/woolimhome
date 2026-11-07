import assert from "node:assert/strict";
import test from "node:test";

import { APPROVED_A4_PORTRAIT_TEMPLATE_LIST } from "./approved-a4-portrait-templates.ts";
import { APPROVED_16X9_BACKGROUNDS, resolveApprovedMockupSlots } from "./approved-16x9-templates.ts";
import {
  APPROVED_PORTRAIT_4X3_BODY_TEMPLATE_LIST,
  APPROVED_PORTRAIT_4X3_SLIDE_ASPECT_RATIO,
  APPROVED_PORTRAIT_4X3_TEMPLATE_LIST,
  APPROVED_PORTRAIT_4X3_TEMPLATE_SUITE_ID,
  APPROVED_PORTRAIT_4X3_TEMPLATE_VERSION,
  getApprovedPortrait4x3MockupTemplate,
} from "./approved-portrait-4x3-templates.ts";

function approximately(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

function center(slot) {
  const radians = slot.angle * Math.PI / 180;
  return {
    x: slot.x + (slot.width * Math.cos(radians) - slot.height * Math.sin(radians)) / 2,
    y: slot.y + (slot.width * Math.sin(radians) + slot.height * Math.cos(radians)) / 2,
  };
}

function without(value, keys) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

test("registers a dedicated portrait 4:3 thumbnail and four body templates", () => {
  assert.equal(APPROVED_PORTRAIT_4X3_TEMPLATE_VERSION, "approved-portrait-4x3-v1");
  assert.equal(APPROVED_PORTRAIT_4X3_TEMPLATE_SUITE_ID, "approved-portrait-4x3-suite");
  assert.equal(APPROVED_PORTRAIT_4X3_SLIDE_ASPECT_RATIO, 3 / 4);
  assert.equal(APPROVED_PORTRAIT_4X3_BODY_TEMPLATE_LIST.length, 4);
  assert.deepEqual(APPROVED_PORTRAIT_4X3_TEMPLATE_LIST.map(({ id }) => id), [
    "portrait-4x3-thumbnail-1",
    "portrait-4x3-body-1-flatlay",
    "portrait-4x3-body-2-triptych",
    "portrait-4x3-body-3-grid",
    "portrait-4x3-body-4-studio",
  ]);
  for (const template of APPROVED_PORTRAIT_4X3_TEMPLATE_LIST) {
    assert.equal(getApprovedPortrait4x3MockupTemplate(template.id), template);
    assert.equal(template.version, APPROVED_PORTRAIT_4X3_TEMPLATE_VERSION);
    assert.equal(template.slideAspectRatio, 3 / 4);
  }
});

test("reuses the A4 portrait composition, backgrounds and every card centre", () => {
  for (const [index, template] of APPROVED_PORTRAIT_4X3_TEMPLATE_LIST.entries()) {
    const original = APPROVED_A4_PORTRAIT_TEMPLATE_LIST[index];
    const unchangedMetadata = (value) => without(value, ["id", "version", "slideAspectRatio", "rails", "fixedSlots"]);
    assert.deepEqual(unchangedMetadata(template), unchangedMetadata(original));
    assert.ok(APPROVED_16X9_BACKGROUNDS[template.backgroundId]);
    assert.equal(template.backgroundId, original.backgroundId);
    const originalSlots = resolveApprovedMockupSlots(original);
    const slots = resolveApprovedMockupSlots(template);
    assert.equal(slots.length, originalSlots.length);
    for (const [slotIndex, slot] of slots.entries()) {
      const originalSlot = originalSlots[slotIndex];
      const unchangedCard = (value) => without(value, ["x", "y", "height"]);
      assert.deepEqual(unchangedCard(slot), unchangedCard(originalSlot));
      approximately(slot.height, slot.width * 4 / 3);
      approximately(center(slot).x, center(originalSlot).x);
      approximately(center(slot).y, center(originalSlot).y);
    }
    for (const [railIndex, rail] of template.rails.entries()) {
      const unchangedRail = (value) => without(value, ["start"]);
      assert.deepEqual(unchangedRail(rail), unchangedRail(original.rails[railIndex]));
    }
  }
});
