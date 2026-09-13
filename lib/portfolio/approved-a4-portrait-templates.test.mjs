import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST,
  APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO,
  APPROVED_A4_PORTRAIT_TEMPLATE_LIST,
  APPROVED_A4_PORTRAIT_TEMPLATE_SUITE_ID,
  APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  APPROVED_A4_PORTRAIT_TEMPLATES,
  getApprovedA4PortraitMockupTemplate,
} from "./approved-a4-portrait-templates.ts";
import { resolveApprovedMockupSlots } from "./approved-16x9-templates.ts";

const REQUIRED_LAYER_ORDER = [
  "background",
  "support-shadow",
  "support",
  "focus-shadow",
  "hero",
  "logo",
];

function approximately(actual, expected, epsilon = 1e-7) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function quad(slot) {
  const radians = (slot.angle * Math.PI) / 180;
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

function center(slot) {
  const points = quad(slot);
  return {
    x: (points[0].x + points[2].x) / 2,
    y: (points[0].y + points[2].y) / 2,
  };
}

function cross(left, right) {
  return left.x * right.y - left.y * right.x;
}

function bounds(slot) {
  const points = quad(slot);
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

test("locks the approved A4-portrait suite and output contract", () => {
  assert.equal(APPROVED_A4_PORTRAIT_TEMPLATE_SUITE_ID, "approved-a4-portrait-suite");
  assert.deepEqual(
    APPROVED_A4_PORTRAIT_TEMPLATE_LIST.map((template) => ({
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
        id: "a4-portrait-thumbnail-1",
        templateNumber: 1,
        kind: "thumbnail",
        outputName: "thumbnail.jpg",
        canvas: { width: 1080, height: 1080 },
        axisAngle: 0,
        backgroundId: "a4-portrait-thumbnail-diagonal",
        slotCount: 2,
      },
      {
        id: "a4-portrait-body-1-flatlay",
        templateNumber: 3,
        kind: "body",
        outputName: "short-main.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: -10,
        backgroundId: "a4-portrait-flatlay",
        slotCount: 7,
      },
      {
        id: "a4-portrait-body-2-triptych",
        templateNumber: 4,
        kind: "body",
        outputName: "short-detail-1.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: 0,
        backgroundId: "corridor-light",
        slotCount: 3,
      },
      {
        id: "a4-portrait-body-3-grid",
        templateNumber: 5,
        kind: "body",
        outputName: "short-detail-2.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: 0,
        backgroundId: "stage-radial",
        slotCount: 4,
      },
      {
        id: "a4-portrait-body-4-studio",
        templateNumber: 6,
        kind: "body",
        outputName: "short-detail-3.jpg",
        canvas: { width: 1600, height: 900 },
        axisAngle: -(Math.atan2(130, 405) * 180) / Math.PI,
        backgroundId: "a4-portrait-dark-wood",
        slotCount: 2,
      },
    ],
  );

  assert.equal(APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST.length, 4);
  assert.equal(
    getApprovedA4PortraitMockupTemplate("a4-portrait-body-4-studio"),
    APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-4-studio"],
  );
});

test("keeps every card at the undistorted A4 portrait ratio with stable roles", () => {
  for (const template of APPROVED_A4_PORTRAIT_TEMPLATE_LIST) {
    assert.equal(template.version, APPROVED_A4_PORTRAIT_TEMPLATE_VERSION);
    approximately(template.slideAspectRatio, APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO, 1e-12);
    assert.deepEqual(template.layerOrder, REQUIRED_LAYER_ORDER);

    const slots = resolveApprovedMockupSlots(template);
    assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length);
    assert.deepEqual(
      slots.map((slot) => slot.priority),
      Array.from({ length: slots.length }, (_, index) => index),
    );
    for (const slot of slots) {
      assert.equal(slot.angle, template.axisAngle);
      approximately(slot.width / slot.height, 1 / Math.SQRT2, 1e-12);
    }
  }

  assert.deepEqual(
    resolveApprovedMockupSlots(APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-thumbnail-1"])
      .map((slot) => slot.role),
    ["support", "support"],
  );
  assert.deepEqual(
    resolveApprovedMockupSlots(APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-2-triptych"])
      .map((slot) => slot.role),
    ["hero", "support", "support"],
  );
});

test("locks the thumbnail centres, title box and reference shadow", () => {
  const template = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-thumbnail-1"];
  const slots = resolveApprovedMockupSlots(template);
  const byId = new Map(slots.map((slot) => [slot.id, slot]));

  assert.deepEqual(template.titleBox, {
    left: 300,
    top: 36,
    width: 650,
    height: 60,
    fontSize: 34,
    color: "#27313a",
    align: "right",
  });
  assert.deepEqual(template.logo, {
    assetPath: "/images/woolim-logo-cropped.png",
    left: 42,
    top: 34,
    width: 82,
    z: 1_000,
  });
  assert.deepEqual(template.edgeAlignments, [
    { slotIds: ["left", "right"], edges: ["top", "bottom"] },
  ]);
  assert.deepEqual(center(byId.get("left")), { x: 305, y: 520 });
  assert.deepEqual(center(byId.get("right")), { x: 775, y: 520 });
  assert.deepEqual(byId.get("left").shadow, {
    kind: "custom",
    layers: [{ dx: 10, dy: 20, blur: 20, opacity: 0.22, color: "#111111" }],
  });
});

test("keeps the approved BODY 2 triptych and BODY 3 grid geometry unchanged", () => {
  const body2 = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-2-triptych"];
  const body3 = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-3-grid"];
  const contract = (template) => template.fixedSlots.map((slot) => ({
    id: slot.id,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    role: slot.role,
    priority: slot.priority,
    z: slot.z,
  }));

  assert.deepEqual(contract(body2), [
    {
      id: "left",
      x: 90,
      y: 145,
      width: 350,
      height: 350 * Math.SQRT2,
      role: "support",
      priority: 1,
      z: 10,
    },
    {
      id: "hero",
      x: 555,
      y: 72,
      width: 490,
      height: 490 * Math.SQRT2,
      role: "hero",
      priority: 0,
      z: 100,
    },
    {
      id: "right",
      x: 1160,
      y: 145,
      width: 350,
      height: 350 * Math.SQRT2,
      role: "support",
      priority: 2,
      z: 11,
    },
  ]);
  assert.deepEqual(contract(body3), [
    {
      id: "left-1",
      x: 75,
      y: 216,
      width: 330,
      height: 330 * Math.SQRT2,
      role: "support",
      priority: 0,
      z: 10,
    },
    {
      id: "left-2",
      x: 445,
      y: 216,
      width: 330,
      height: 330 * Math.SQRT2,
      role: "support",
      priority: 1,
      z: 11,
    },
    {
      id: "right-1",
      x: 815,
      y: 216,
      width: 330,
      height: 330 * Math.SQRT2,
      role: "support",
      priority: 2,
      z: 12,
    },
    {
      id: "right-2",
      x: 1185,
      y: 216,
      width: 330,
      height: 330 * Math.SQRT2,
      role: "support",
      priority: 3,
      z: 13,
    },
  ]);
  assert.equal("edgeAlignments" in body2, false);
  assert.deepEqual(body3.edgeAlignments, [
    {
      slotIds: ["left-1", "left-2", "right-1", "right-2"],
      edges: ["top", "bottom"],
    },
  ]);
});

test("aligns BODY 1 on exact shared rails while retaining its two anchors", () => {
  const template = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-1-flatlay"];
  const slots = resolveApprovedMockupSlots(template);
  const top = slots
    .filter((slot) => slot.railId === "top")
    .sort((left, right) => left.railIndex - right.railIndex);
  const bottom = slots
    .filter((slot) => slot.railId === "bottom")
    .sort((left, right) => left.railIndex - right.railIndex);
  const topCentres = top.map(center);
  const bottomCentres = bottom.map(center);
  const axis = {
    x: Math.cos((-10 * Math.PI) / 180),
    y: Math.sin((-10 * Math.PI) / 180),
  };

  approximately(topCentres[1].x, 475);
  approximately(topCentres[1].y, 255);
  approximately(bottomCentres[0].x, 355);
  approximately(bottomCentres[0].y, 780);
  assert.deepEqual(top.map((slot) => slot.priority), [6, 0, 2, 4]);
  assert.deepEqual(bottom.map((slot) => slot.priority), [1, 3, 5]);

  for (const centres of [topCentres, bottomCentres]) {
    for (let index = 1; index < centres.length; index += 1) {
      const delta = {
        x: centres[index].x - centres[0].x,
        y: centres[index].y - centres[0].y,
      };
      approximately(cross(delta, axis), 0, 1e-7);
      approximately(centres[index].x - centres[index - 1].x, 410);
      approximately(
        centres[index].y - centres[index - 1].y,
        410 * Math.tan((-10 * Math.PI) / 180),
      );
    }
  }

  approximately(topCentres[2].y, 182.70593790952935);
  approximately(topCentres[3].y, 110.4118758190587);
});

test("keeps the smaller BODY 1 logo clear of the left top card edge", async () => {
  const template = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-1-flatlay"];
  assert.deepEqual(template.logo, {
    assetPath: "/images/woolim-logo-cropped.png",
    left: 32,
    top: 12,
    width: 75,
    z: 1_000,
  });

  const leftTop = resolveApprovedMockupSlots(template).find((slot) => slot.id === "top-1");
  const [topLeft, topRight] = quad(leftTop);
  const logoPath = path.join(
    process.cwd(),
    "public",
    template.logo.assetPath.replace(/^[/\\]+/, ""),
  );
  const { data, info } = await sharp(logoPath)
    .resize({ width: template.logo.width })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minimumGap = Number.POSITIVE_INFINITY;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      const canvasX = template.logo.left + x;
      const canvasY = template.logo.top + y;
      const progress = (canvasX - topLeft.x) / (topRight.x - topLeft.x);
      const cardEdgeY = topLeft.y + progress * (topRight.y - topLeft.y);
      minimumGap = Math.min(minimumGap, cardEdgeY - canvasY);
    }
  }
  assert.ok(
    minimumGap >= 3,
    `BODY 1 logo has only ${minimumGap.toFixed(3)}px clearance from the card edge`,
  );
});

test("expresses BODY 4 as two collinear rotated A4 rectangles, not perspective quads", () => {
  const template = APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-4-studio"];
  const slots = resolveApprovedMockupSlots(template);
  const back = slots.find((slot) => slot.id === "back-right");
  const front = slots.find((slot) => slot.id === "front-left");
  const backQuad = quad(back);
  const frontQuad = quad(front);
  const frontTop = {
    x: frontQuad[1].x - frontQuad[0].x,
    y: frontQuad[1].y - frontQuad[0].y,
  };
  const frontSide = {
    x: frontQuad[3].x - frontQuad[0].x,
    y: frontQuad[3].y - frontQuad[0].y,
  };
  const topOffset = {
    x: backQuad[0].x - frontQuad[0].x,
    y: backQuad[0].y - frontQuad[0].y,
  };
  const bottomOffset = {
    x: backQuad[3].x - frontQuad[3].x,
    y: backQuad[3].y - frontQuad[3].y,
  };

  approximately(frontTop.x, 405, 1e-9);
  approximately(frontTop.y, -130, 1e-9);
  approximately(frontSide.x, 130 * Math.SQRT2, 1e-9);
  approximately(frontSide.y, 405 * Math.SQRT2, 1e-9);
  approximately(cross(topOffset, frontTop), 0, 0.0002);
  approximately(cross(bottomOffset, frontTop), 0, 0.0002);
  assert.deepEqual(slots.map((slot) => slot.role), ["support", "support"]);
  assert.deepEqual(slots.map((slot) => slot.z), [10, 20]);
  assert.deepEqual(template.edgeAlignments, [
    { slotIds: ["back-right", "front-left"], edges: ["top", "bottom"] },
  ]);
  assert.deepEqual(back.shadow.layers, [
    { dx: 7, dy: 10, blur: 18, opacity: 0.23, color: "#111820" },
    { dx: 2, dy: 3, blur: 5, opacity: 0.36, color: "#111820" },
  ]);
  assert.deepEqual(front.shadow.layers, [
    { dx: 8, dy: 12, blur: 22, opacity: 0.27, color: "#111820" },
    { dx: 2, dy: 4, blur: 6, opacity: 0.4, color: "#111820" },
  ]);
});

test("permits clipping only for the intentional BODY 1 edge bleed", () => {
  for (const template of APPROVED_A4_PORTRAIT_TEMPLATE_LIST) {
    for (const slot of resolveApprovedMockupSlots(template)) {
      const slotBounds = bounds(slot);
      const isClipped = slotBounds.left < 0
        || slotBounds.top < 0
        || slotBounds.right > template.canvas.width
        || slotBounds.bottom > template.canvas.height;
      if (isClipped) {
        assert.equal(template.id, "a4-portrait-body-1-flatlay");
        assert.equal(slot.allowCanvasClip, true);
      } else if (template.id !== "a4-portrait-body-1-flatlay") {
        assert.equal(slot.allowCanvasClip, false);
      }
    }
  }

  const body1Slots = resolveApprovedMockupSlots(
    APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-1-flatlay"],
  );
  assert.ok(body1Slots.some((slot) => bounds(slot).left < 0));
  assert.ok(body1Slots.some((slot) => bounds(slot).top < 0));
  assert.ok(body1Slots.some((slot) => bounds(slot).bottom > 900));
});
