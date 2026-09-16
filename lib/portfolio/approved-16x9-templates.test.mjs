import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  APPROVED_16X9_BODY_TEMPLATE_LIST,
  APPROVED_16X9_TEMPLATES,
  resolveApprovedMockupSlots,
} from "./approved-16x9-templates.ts";
import { renderApproved16x9Mockup } from "./approved-16x9-renderer.ts";

const REQUIRED_LAYER_ORDER = [
  "background",
  "support-shadow",
  "support",
  "focus-shadow",
  "hero",
  "logo",
];

function rotatedBounds(slot) {
  const radians = slot.angle * Math.PI / 180;
  const u = { x: Math.cos(radians), y: Math.sin(radians) };
  const v = { x: -Math.sin(radians), y: Math.cos(radians) };
  const points = [
    { x: slot.x, y: slot.y },
    { x: slot.x + slot.width * u.x, y: slot.y + slot.width * u.y },
    {
      x: slot.x + slot.width * u.x + slot.height * v.x,
      y: slot.y + slot.width * u.y + slot.height * v.y,
    },
    { x: slot.x + slot.height * v.x, y: slot.y + slot.height * v.y },
  ];
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

test("keeps the approved 1, 3, 4, 5, 6 template contract", () => {
  assert.deepEqual(
    [APPROVED_16X9_TEMPLATES["thumbnail-1"], ...APPROVED_16X9_BODY_TEMPLATE_LIST]
      .map((template) => template.templateNumber),
    [1, 3, 4, 5, 6],
  );
  assert.deepEqual(
    APPROVED_16X9_BODY_TEMPLATE_LIST.map((template) => template.outputName),
    ["short-main.jpg", "short-detail-1.jpg", "short-detail-2.jpg", "short-detail-3.jpg"],
  );
  assert.deepEqual(
    APPROVED_16X9_BODY_TEMPLATE_LIST.map((template) => [
      template.canvas.width,
      template.canvas.height,
      resolveApprovedMockupSlots(template).length,
    ]),
    [[1600, 900, 7], [1600, 900, 7], [1600, 900, 4], [1600, 900, 8]],
  );
});

test("locks every card to one template axis and one layer order", () => {
  for (const template of Object.values(APPROVED_16X9_TEMPLATES)) {
    const slots = resolveApprovedMockupSlots(template);
    assert.ok(slots.every((slot) => slot.angle === template.axisAngle));
    assert.deepEqual(template.layerOrder, REQUIRED_LAYER_ORDER);
    assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length);
    assert.deepEqual(
      slots.map((slot) => slot.priority).sort((left, right) => left - right),
      Array.from({ length: slots.length }, (_, index) => index),
    );
  }
});

test("uses one shared light background for templates 4 and 6", () => {
  assert.equal(APPROVED_16X9_TEMPLATES["body-4-corridor"].backgroundId, "corridor-light");
  assert.equal(
    APPROVED_16X9_TEMPLATES["body-6-lattice"].backgroundId,
    APPROVED_16X9_TEMPLATES["body-4-corridor"].backgroundId,
  );
});

test("every recorded slot contributes visible pixels to its canvas", () => {
  for (const template of Object.values(APPROVED_16X9_TEMPLATES)) {
    for (const slot of resolveApprovedMockupSlots(template)) {
      const bounds = rotatedBounds(slot);
      assert.ok(
        bounds.right > 0
          && bounds.bottom > 0
          && bounds.left < template.canvas.width
          && bounds.top < template.canvas.height,
        `${template.id}/${slot.id} is completely outside the canvas`,
      );
    }
  }
});

test("swaps seven slides into the approved thumbnail and records every slot", async () => {
  const slides = await Promise.all(Array.from({ length: 7 }, async (_, index) => ({
    index,
    buffer: await sharp({
      create: {
        width: 320 + index,
        height: 180,
        channels: 3,
        background: `hsl(${index * 41}, 70%, 55%)`,
      },
    }).png().toBuffer(),
  })));
  const result = await renderApproved16x9Mockup({
    template: APPROVED_16X9_TEMPLATES["thumbnail-1"],
    slides,
    title: "장표만 교체하는 포트폴리오 목업",
  });
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.deepEqual([metadata.width, metadata.height], [1080, 1080]);
  assert.equal(result.slotAssignments.length, 7);
  assert.equal(new Set(result.slotAssignments.map((assignment) => assignment.sourceSlideIndex)).size, 7);
  assert.equal(result.slotAssignments[0].slotId, "hero");
});

test("refuses duplicate or excess smart-object inputs", async () => {
  const buffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#ff5f25" },
  }).png().toBuffer();
  await assert.rejects(
    renderApproved16x9Mockup({
      template: APPROVED_16X9_TEMPLATES["body-5-grid"],
      slides: [{ index: 0, buffer }, { index: 0, buffer }],
    }),
    /중복 배치/,
  );
  await assert.rejects(
    renderApproved16x9Mockup({
      template: APPROVED_16X9_TEMPLATES["body-5-grid"],
      slides: [{ index: 0, buffer }, { index: 1, buffer }],
    }),
    /내용이 같은 장표/,
  );
  const slides = await Promise.all(Array.from({ length: 5 }, async (_, index) => ({
    index,
    buffer: await sharp({
      create: { width: 320 + index, height: 180, channels: 3, background: `hsl(${index * 50}, 70%, 50%)` },
    }).png().toBuffer(),
  })));
  await assert.rejects(
    renderApproved16x9Mockup({
      template: APPROVED_16X9_TEMPLATES["body-5-grid"],
      slides,
    }),
    /슬롯은 4개/,
  );
});
