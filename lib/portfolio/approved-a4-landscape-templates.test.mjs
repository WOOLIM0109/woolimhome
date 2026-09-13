import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
  APPROVED_A4_LANDSCAPE_TEMPLATE_LIST,
  APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  APPROVED_A4_LANDSCAPE_TEMPLATES,
} from "./approved-a4-landscape-templates.ts";
import {
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

const COLORS = [
  { r: 232, g: 45, b: 45 },
  { r: 35, g: 190, b: 75 },
  { r: 45, g: 95, b: 230 },
  { r: 240, g: 190, b: 25 },
  { r: 200, g: 40, b: 190 },
  { r: 25, g: 180, b: 190 },
  { r: 235, g: 120, b: 25 },
];

function approximately(actual, expected, epsilon = 1e-7) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function rotatedPolygon(slot) {
  const radians = slot.angle * Math.PI / 180;
  const widthAxis = { x: Math.cos(radians), y: Math.sin(radians) };
  const heightAxis = { x: -Math.sin(radians), y: Math.cos(radians) };
  return [
    { x: slot.x, y: slot.y },
    {
      x: slot.x + slot.width * widthAxis.x,
      y: slot.y + slot.width * widthAxis.y,
    },
    {
      x: slot.x + slot.width * widthAxis.x + slot.height * heightAxis.x,
      y: slot.y + slot.width * widthAxis.y + slot.height * heightAxis.y,
    },
    {
      x: slot.x + slot.height * heightAxis.x,
      y: slot.y + slot.height * heightAxis.y,
    },
  ];
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function clipPolygon(points, axis, boundary, keepBelow) {
  const inside = (point) => keepBelow
    ? point[axis] <= boundary
    : point[axis] >= boundary;
  const intersection = (start, end) => {
    const distance = end[axis] - start[axis];
    const progress = distance === 0 ? 0 : (boundary - start[axis]) / distance;
    return {
      x: start.x + progress * (end.x - start.x),
      y: start.y + progress * (end.y - start.y),
    };
  };
  const clipped = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const startInside = inside(start);
    const endInside = inside(end);
    if (startInside && endInside) {
      clipped.push(end);
    } else if (startInside) {
      clipped.push(intersection(start, end));
    } else if (endInside) {
      clipped.push(intersection(start, end), end);
    }
  }
  return clipped;
}

function visiblePolygon(slot, canvas) {
  let points = rotatedPolygon(slot);
  points = clipPolygon(points, "x", 0, false);
  points = clipPolygon(points, "x", canvas.width, true);
  points = clipPolygon(points, "y", 0, false);
  points = clipPolygon(points, "y", canvas.height, true);
  return points;
}

function rotatedBounds(slot) {
  const points = rotatedPolygon(slot);
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function railContract(template) {
  return template.rails.map((rail) => ({
    id: rail.id,
    start: rail.start,
    cardWidth: rail.cardWidth,
    gap: rail.gap,
    count: rail.count,
  }));
}

function fixedContract(template) {
  return template.fixedSlots.map((slot) => ({
    id: slot.id,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
  }));
}

async function sampleSlides(count) {
  return Promise.all(Array.from({ length: count }, async (_, index) => ({
    index,
    buffer: await sharp({
      create: {
        width: 420,
        height: 297,
        channels: 3,
        background: COLORS[index],
      },
    }).png().toBuffer(),
  })));
}

function washedColor(color, opacity) {
  return {
    r: Math.round(color.r * (1 - opacity) + 255 * opacity),
    g: Math.round(color.g * (1 - opacity) + 255 * opacity),
    b: Math.round(color.b * (1 - opacity) + 255 * opacity),
  };
}

test("locks the approved A4-landscape 1, 3, 4, 5, 6 template contract", () => {
  assert.deepEqual(
    APPROVED_A4_LANDSCAPE_TEMPLATE_LIST.map((template) => ({
      id: template.id,
      templateNumber: template.templateNumber,
      kind: template.kind,
      outputName: template.outputName,
      canvas: template.canvas,
      axisAngle: template.axisAngle,
      backgroundId: template.backgroundId,
      slotCount: resolveApprovedMockupSlots(template).length,
    })),
    [
      {
        id: "a4-landscape-thumbnail-1",
        templateNumber: 1,
        kind: "thumbnail",
        outputName: "thumbnail.jpg",
        canvas: { width: 1080, height: 1080 },
        axisAngle: -8,
        backgroundId: "thumbnail-light",
        slotCount: 7,
      },
      {
        id: "a4-landscape-body-3-stage",
        templateNumber: 3,
        kind: "body",
        outputName: "short-main.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: -9,
        backgroundId: "stage-radial",
        slotCount: 7,
      },
      {
        id: "a4-landscape-body-4-corridor",
        templateNumber: 4,
        kind: "body",
        outputName: "short-detail-1.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: -12,
        backgroundId: "corridor-light",
        slotCount: 7,
      },
      {
        id: "a4-landscape-body-5-grid",
        templateNumber: 5,
        kind: "body",
        outputName: "short-detail-2.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: 0,
        backgroundId: "grid-light",
        slotCount: 4,
      },
      {
        id: "a4-landscape-body-6-lattice",
        templateNumber: 6,
        kind: "body",
        outputName: "short-detail-3.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: -18,
        backgroundId: "corridor-light",
        slotCount: 6,
      },
    ],
  );

  assert.deepEqual(railContract(APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-thumbnail-1"]), [
    { id: "top", start: { x: -160, y: 215 }, cardWidth: 390, gap: 45, count: 3 },
    { id: "bottom", start: { x: -120, y: 845 }, cardWidth: 410, gap: 45, count: 3 },
  ]);
  assert.deepEqual(railContract(APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-3-stage"]), [
    { id: "back", start: { x: -180, y: 255 }, cardWidth: 520, gap: 50, count: 3 },
    { id: "front", start: { x: -250, y: 760 }, cardWidth: 560, gap: 45, count: 3 },
  ]);
  assert.deepEqual(railContract(APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-4-corridor"]), [
    { id: "top", start: { x: -130, y: 280 }, cardWidth: 500, gap: 30, count: 3 },
    { id: "bottom", start: { x: -220, y: 750 }, cardWidth: 500, gap: 30, count: 4 },
  ]);
  assert.deepEqual(railContract(APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-6-lattice"]), [
    { id: "top", start: { x: -120, y: 290 }, cardWidth: 600, gap: 50, count: 3 },
    { id: "middle", start: { x: -190, y: 780 }, cardWidth: 600, gap: 50, count: 3 },
  ]);

  assert.deepEqual(fixedContract(APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-thumbnail-1"]), [
    { id: "hero", x: 155, y: 340, width: 770, height: 770 / Math.SQRT2 },
  ]);
  assert.deepEqual(fixedContract(APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-3-stage"]), [
    { id: "hero", x: 400, y: 230, width: 800, height: 800 / Math.SQRT2 },
  ]);
  assert.deepEqual(fixedContract(APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-5-grid"]), [
    { id: "top-left", x: 200, y: 45, width: 560, height: 560 / Math.SQRT2 },
    { id: "top-right", x: 840, y: 45, width: 560, height: 560 / Math.SQRT2 },
    { id: "bottom-left", x: 200, y: 460, width: 560, height: 560 / Math.SQRT2 },
    { id: "bottom-right", x: 840, y: 460, width: 560, height: 560 / Math.SQRT2 },
  ]);
});

test("keeps every A4-landscape card parallel and every rail collinear", () => {
  for (const template of APPROVED_A4_LANDSCAPE_TEMPLATE_LIST) {
    const slots = resolveApprovedMockupSlots(template);
    assert.equal(template.version, APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION);
    approximately(template.slideAspectRatio, APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO, 1e-12);
    assert.deepEqual(template.layerOrder, REQUIRED_LAYER_ORDER);
    assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length);
    assert.deepEqual(
      slots.map((slot) => slot.priority).sort((left, right) => left - right),
      Array.from({ length: slots.length }, (_, index) => index),
    );

    for (const slot of slots) {
      assert.equal(slot.angle, template.axisAngle);
      approximately(slot.width / slot.height, Math.SQRT2);
      const [topLeft, topRight, bottomRight, bottomLeft] = rotatedPolygon(slot);
      const top = { x: topRight.x - topLeft.x, y: topRight.y - topLeft.y };
      const bottom = { x: bottomRight.x - bottomLeft.x, y: bottomRight.y - bottomLeft.y };
      approximately(top.x * bottom.y - top.y * bottom.x, 0, 1e-6);
      approximately(top.x / slot.width, Math.cos(template.axisAngle * Math.PI / 180));
      approximately(top.y / slot.width, Math.sin(template.axisAngle * Math.PI / 180));
    }

    for (const rail of template.rails) {
      const railSlots = slots
        .filter((slot) => slot.source === "rail" && slot.railId === rail.id)
        .sort((left, right) => left.railIndex - right.railIndex);
      assert.equal(railSlots.length, rail.count);
      const radians = template.axisAngle * Math.PI / 180;
      const step = rail.cardWidth + rail.gap;
      railSlots.forEach((slot, index) => {
        assert.equal(slot.railIndex, index);
        approximately(slot.x, rail.start.x + index * step * Math.cos(radians));
        approximately(slot.y, rail.start.y + index * step * Math.sin(radians));
        approximately(slot.width, rail.cardWidth);
        approximately(slot.height, rail.cardWidth / Math.SQRT2);
        assert.equal(slot.z, rail.zStart + index * rail.zStep);
      });
    }
  }
});

test("keeps every recorded A4-landscape slot materially visible and clip-safe", () => {
  for (const template of APPROVED_A4_LANDSCAPE_TEMPLATE_LIST) {
    const slots = resolveApprovedMockupSlots(template);
    let clippedSlotCount = 0;
    for (const slot of slots) {
      const bounds = rotatedBounds(slot);
      const clipped = bounds.left < 0
        || bounds.top < 0
        || bounds.right > template.canvas.width
        || bounds.bottom > template.canvas.height;
      const visibleArea = polygonArea(visiblePolygon(slot, template.canvas));
      const visibleRatio = visibleArea / (slot.width * slot.height);
      assert.ok(
        visibleRatio >= 0.25,
        `${template.id}/${slot.id} exposes only ${(visibleRatio * 100).toFixed(2)}% of its pixels`,
      );
      if (clipped) {
        clippedSlotCount += 1;
        assert.equal(
          slot.allowCanvasClip,
          true,
          `${template.id}/${slot.id} leaves the canvas without clip permission`,
        );
      } else if (!slot.allowCanvasClip) {
        const margin = Math.min(
          bounds.left,
          bounds.top,
          template.canvas.width - bounds.right,
          template.canvas.height - bounds.bottom,
        );
        assert.ok(margin >= 40, `${template.id}/${slot.id} has only ${margin.toFixed(2)}px safety margin`);
      }
    }

    if (template.id === "a4-landscape-body-5-grid") {
      assert.equal(clippedSlotCount, 0);
    } else {
      assert.ok(clippedSlotCount > 0, `${template.id} lost its intentional edge bleed`);
    }
  }
});

test("renders every approved A4-landscape slot and records the smart-object swap", async () => {
  for (const template of APPROVED_A4_LANDSCAPE_TEMPLATE_LIST) {
    const slots = resolveApprovedMockupSlots(template);
    const slides = await sampleSlides(slots.length);
    const result = await renderApproved16x9Mockup({
      template,
      slides,
      title: template.kind === "thumbnail" ? "A4 가로형 제안서 디자인" : null,
    });
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.deepEqual([metadata.width, metadata.height], [template.canvas.width, template.canvas.height]);
    assert.equal(result.templateId, template.id);
    assert.equal(result.templateVersion, APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION);
    assert.equal(result.outputName, template.outputName);
    assert.equal(result.slotAssignments.length, slots.length);
    assert.equal(new Set(result.slotAssignments.map((assignment) => assignment.sourceSlideIndex)).size, slots.length);
    assert.deepEqual(
      result.slotAssignments.map((assignment) => assignment.slotId),
      slots.map((slot) => slot.id),
    );

    const rendered = await sharp(result.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let index = 0; index < slots.length; index += 1) {
      const target = washedColor(COLORS[index], slots[index].washOpacity);
      let matchingPixels = 0;
      for (let offset = 0; offset < rendered.data.length; offset += 3) {
        const distance = Math.abs(rendered.data[offset] - target.r)
          + Math.abs(rendered.data[offset + 1] - target.g)
          + Math.abs(rendered.data[offset + 2] - target.b);
        if (distance <= 70) matchingPixels += 1;
      }
      assert.ok(
        matchingPixels > 500,
        `${template.id}/${slots[index].id} did not contribute visible rendered pixels`,
      );
    }
  }
});

test("refuses duplicate and excess A4-landscape smart-object inputs", async () => {
  const template = APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-5-grid"];
  const slides = await sampleSlides(5);

  await assert.rejects(
    renderApproved16x9Mockup({
      template,
      slides: [{ index: 0, buffer: slides[0].buffer }, { index: 0, buffer: slides[1].buffer }],
    }),
    /중복 배치/,
  );
  await assert.rejects(
    renderApproved16x9Mockup({
      template,
      slides: [{ index: 0, buffer: slides[0].buffer }, { index: 1, buffer: slides[0].buffer }],
    }),
    /내용이 같은 장표/,
  );
  await assert.rejects(
    renderApproved16x9Mockup({ template, slides }),
    /슬롯은 4개/,
  );
});
