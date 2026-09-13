/**
 * Approved A4-portrait portfolio mockup geometry.
 *
 * The records below are the reusable smart-object contract for the approved
 * thumbnail and four body images. Render time may replace slide buffers only;
 * canvas, positions, angle, background, shadows, title box and logo stay fixed.
 */

import type {
  ApprovedMockupFixedSlotSpec,
  ApprovedMockupLayer,
  ApprovedMockupLogoSpec,
  ApprovedMockupRailSpec,
  ApprovedMockupShadow,
  ApprovedMockupTemplateSpec,
} from "./approved-16x9-templates.ts";

export const APPROVED_A4_PORTRAIT_TEMPLATE_VERSION = "approved-a4-portrait-v1" as const;
export const APPROVED_A4_PORTRAIT_TEMPLATE_SUITE_ID = "approved-a4-portrait-suite" as const;
export const APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO = 1 / Math.SQRT2;

export type ApprovedA4PortraitTemplateId =
  | "a4-portrait-thumbnail-1"
  | "a4-portrait-body-1-flatlay"
  | "a4-portrait-body-2-triptych"
  | "a4-portrait-body-3-grid"
  | "a4-portrait-body-4-studio";

export type ApprovedA4PortraitTemplateSpec = ApprovedMockupTemplateSpec<
  ApprovedA4PortraitTemplateId,
  typeof APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  number
>;

const THUMBNAIL_CANVAS = { width: 1080, height: 1080 } as const;
const BODY_CANVAS = { width: 1600, height: 900 } as const;
const DEFAULT_LAYER_ORDER = [
  "background",
  "support-shadow",
  "support",
  "focus-shadow",
  "hero",
  "logo",
] as const satisfies readonly ApprovedMockupLayer[];

const THUMBNAIL_LOGO = {
  assetPath: "/images/woolim-logo-cropped.png",
  left: 42,
  top: 34,
  width: 82,
  z: 1_000,
} as const satisfies ApprovedMockupLogoSpec;

const BODY_LOGO = {
  assetPath: "/images/woolim-logo-cropped.png",
  left: 48,
  top: 38,
  width: 110,
  z: 1_000,
} as const satisfies ApprovedMockupLogoSpec;

const A4_PORTRAIT_HEIGHT_FACTOR = 1 / APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO;

function customShadow(
  layers: Extract<ApprovedMockupShadow, { kind: "custom" }>["layers"],
): ApprovedMockupShadow {
  return { kind: "custom", layers };
}

function support(input: {
  id: string;
  x: number;
  y: number;
  width: number;
  priority: number;
  z: number;
  shadow?: ApprovedMockupShadow;
  allowCanvasClip?: boolean;
}): ApprovedMockupFixedSlotSpec {
  return {
    id: input.id,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.width * A4_PORTRAIT_HEIGHT_FACTOR,
    role: "support",
    priority: input.priority,
    z: input.z,
    shadow: input.shadow || { kind: "support", strength: 1 },
    washOpacity: 0,
    allowCanvasClip: input.allowCanvasClip || false,
  };
}

function hero(input: {
  x: number;
  y: number;
  width: number;
  priority: number;
  z: number;
}): ApprovedMockupFixedSlotSpec {
  return {
    id: "hero",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.width * A4_PORTRAIT_HEIGHT_FACTOR,
    role: "hero",
    priority: input.priority,
    z: input.z,
    shadow: { kind: "focus" },
    washOpacity: 0,
    allowCanvasClip: false,
  };
}

function rotatedTopLeftFromCenter(input: {
  centerX: number;
  centerY: number;
  width: number;
  angle: number;
}) {
  const radians = (input.angle * Math.PI) / 180;
  const height = input.width * A4_PORTRAIT_HEIGHT_FACTOR;
  const widthX = input.width * Math.cos(radians);
  const widthY = input.width * Math.sin(radians);
  const heightX = -height * Math.sin(radians);
  const heightY = height * Math.cos(radians);
  return {
    x: input.centerX - (widthX + heightX) / 2,
    y: input.centerY - (widthY + heightY) / 2,
  };
}

function rail(input: {
  id: string;
  centerX: number;
  centerY: number;
  cardWidth: number;
  horizontalStep: number;
  angle: number;
  priorities: readonly number[];
  zStart: number;
  shadow: ApprovedMockupShadow;
}): ApprovedMockupRailSpec {
  const start = rotatedTopLeftFromCenter({
    centerX: input.centerX,
    centerY: input.centerY,
    width: input.cardWidth,
    angle: input.angle,
  });
  const axisStep = input.horizontalStep / Math.cos((input.angle * Math.PI) / 180);
  return {
    id: input.id,
    start,
    cardWidth: input.cardWidth,
    gap: axisStep - input.cardWidth,
    count: input.priorities.length,
    role: "support",
    priorities: input.priorities,
    zStart: input.zStart,
    zStep: 1,
    shadow: input.shadow,
    washOpacity: 0,
    allowCanvasClip: true,
  };
}

const THUMBNAIL_SHADOW = customShadow([
  { dx: 10, dy: 20, blur: 20, opacity: 0.22, color: "#111111" },
]);

const THUMBNAIL_CARD_WIDTH = 420;
const THUMBNAIL_CARD_HEIGHT = THUMBNAIL_CARD_WIDTH * A4_PORTRAIT_HEIGHT_FACTOR;

const THUMBNAIL_1 = {
  id: "a4-portrait-thumbnail-1",
  templateNumber: 1,
  version: APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  outputName: "thumbnail.jpg",
  kind: "thumbnail",
  canvas: THUMBNAIL_CANVAS,
  slideAspectRatio: APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO,
  axisAngle: 0,
  backgroundId: "a4-portrait-thumbnail-diagonal",
  logo: THUMBNAIL_LOGO,
  titleBox: {
    left: 300,
    top: 36,
    width: 650,
    height: 60,
    fontSize: 34,
    color: "#27313a",
    align: "right",
  },
  rails: [],
  fixedSlots: [
    support({
      id: "left",
      x: 305 - THUMBNAIL_CARD_WIDTH / 2,
      y: 520 - THUMBNAIL_CARD_HEIGHT / 2,
      width: THUMBNAIL_CARD_WIDTH,
      priority: 1,
      z: 10,
      shadow: THUMBNAIL_SHADOW,
    }),
    support({
      id: "right",
      x: 775 - THUMBNAIL_CARD_WIDTH / 2,
      y: 520 - THUMBNAIL_CARD_HEIGHT / 2,
      width: THUMBNAIL_CARD_WIDTH,
      priority: 0,
      z: 11,
      shadow: THUMBNAIL_SHADOW,
    }),
  ],
  edgeAlignments: [
    { slotIds: ["left", "right"], edges: ["top", "bottom"] },
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4PortraitTemplateSpec;

const BODY_1_ANGLE = -10;
const BODY_1_CARD_WIDTH = 355;
const BODY_1_HORIZONTAL_STEP = 410;
const BODY_1_SHADOW = customShadow([
  { dx: 12, dy: 18, blur: 17, opacity: 0.2, color: "#111111" },
]);

/*
 * The approved draft rounded every horizontal 410 px step to a -70 px rise,
 * which bent each row by 2.29 px and then 4.59 px. Keep the first recorded
 * anchors (475,255 and 355,780), but derive every other centre from the shared
 * -10 degree rail. The physical top-row start is one exact rail step before
 * the retained (475,255) anchor.
 */
const BODY_1_RISE = BODY_1_HORIZONTAL_STEP * Math.tan((BODY_1_ANGLE * Math.PI) / 180);

const BODY_1_FLATLAY = {
  id: "a4-portrait-body-1-flatlay",
  templateNumber: 3,
  version: APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  outputName: "short-main.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO,
  axisAngle: BODY_1_ANGLE,
  backgroundId: "a4-portrait-flatlay",
  logo: {
    ...BODY_LOGO,
    left: 32,
    top: 12,
    width: 75,
  },
  rails: [
    rail({
      id: "top",
      centerX: 65,
      centerY: 255 - BODY_1_RISE,
      cardWidth: BODY_1_CARD_WIDTH,
      horizontalStep: BODY_1_HORIZONTAL_STEP,
      angle: BODY_1_ANGLE,
      priorities: [6, 0, 2, 4],
      zStart: 10,
      shadow: BODY_1_SHADOW,
    }),
    rail({
      id: "bottom",
      centerX: 355,
      centerY: 780,
      cardWidth: BODY_1_CARD_WIDTH,
      horizontalStep: BODY_1_HORIZONTAL_STEP,
      angle: BODY_1_ANGLE,
      priorities: [1, 3, 5],
      zStart: 20,
      shadow: BODY_1_SHADOW,
    }),
  ],
  fixedSlots: [],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4PortraitTemplateSpec;

const BODY_2_TRIPTYCH = {
  id: "a4-portrait-body-2-triptych",
  templateNumber: 4,
  version: APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  outputName: "short-detail-1.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO,
  axisAngle: 0,
  backgroundId: "corridor-light",
  logo: BODY_LOGO,
  rails: [],
  fixedSlots: [
    support({ id: "left", x: 90, y: 145, width: 350, priority: 1, z: 10 }),
    hero({ x: 555, y: 72, width: 490, priority: 0, z: 100 }),
    support({ id: "right", x: 1160, y: 145, width: 350, priority: 2, z: 11 }),
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4PortraitTemplateSpec;

const BODY_3_GRID = {
  id: "a4-portrait-body-3-grid",
  templateNumber: 5,
  version: APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  outputName: "short-detail-2.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO,
  axisAngle: 0,
  backgroundId: "stage-radial",
  logo: {
    ...BODY_LOGO,
    left: 32,
    top: 24,
  },
  rails: [],
  fixedSlots: [
    support({ id: "left-1", x: 75, y: 216, width: 330, priority: 0, z: 10 }),
    support({ id: "left-2", x: 445, y: 216, width: 330, priority: 1, z: 11 }),
    support({ id: "right-1", x: 815, y: 216, width: 330, priority: 2, z: 12 }),
    support({ id: "right-2", x: 1185, y: 216, width: 330, priority: 3, z: 13 }),
  ],
  edgeAlignments: [
    {
      slotIds: ["left-1", "left-2", "right-1", "right-2"],
      edges: ["top", "bottom"],
    },
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4PortraitTemplateSpec;

const BODY_4_WIDTH_AXIS = { x: 405, y: -130 } as const;
const BODY_4_CARD_WIDTH = Math.hypot(BODY_4_WIDTH_AXIS.x, BODY_4_WIDTH_AXIS.y);
const BODY_4_ANGLE = (Math.atan2(BODY_4_WIDTH_AXIS.y, BODY_4_WIDTH_AXIS.x) * 180) / Math.PI;

const BODY_4_STUDIO = {
  id: "a4-portrait-body-4-studio",
  templateNumber: 6,
  version: APPROVED_A4_PORTRAIT_TEMPLATE_VERSION,
  outputName: "short-detail-3.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_PORTRAIT_SLIDE_ASPECT_RATIO,
  // Both approved quads are true rotated A4 rectangles, so one shared axis is
  // sufficient. No per-pixel perspective transform belongs in this template.
  axisAngle: BODY_4_ANGLE,
  backgroundId: "a4-portrait-dark-wood",
  logo: {
    ...BODY_LOGO,
    width: 95,
  },
  rails: [],
  fixedSlots: [
    support({
      id: "back-right",
      x: 737,
      y: 156.703704,
      width: BODY_4_CARD_WIDTH,
      priority: 0,
      z: 10,
      shadow: customShadow([
        { dx: 7, dy: 10, blur: 18, opacity: 0.23, color: "#111820" },
        { dx: 2, dy: 3, blur: 5, opacity: 0.36, color: "#111820" },
      ]),
    }),
    support({
      id: "front-left",
      x: 275,
      y: 305,
      width: BODY_4_CARD_WIDTH,
      priority: 1,
      z: 20,
      shadow: customShadow([
        { dx: 8, dy: 12, blur: 22, opacity: 0.27, color: "#111820" },
        { dx: 2, dy: 4, blur: 6, opacity: 0.4, color: "#111820" },
      ]),
    }),
  ],
  edgeAlignments: [
    { slotIds: ["back-right", "front-left"], edges: ["top", "bottom"] },
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4PortraitTemplateSpec;

export const APPROVED_A4_PORTRAIT_TEMPLATES = {
  "a4-portrait-thumbnail-1": THUMBNAIL_1,
  "a4-portrait-body-1-flatlay": BODY_1_FLATLAY,
  "a4-portrait-body-2-triptych": BODY_2_TRIPTYCH,
  "a4-portrait-body-3-grid": BODY_3_GRID,
  "a4-portrait-body-4-studio": BODY_4_STUDIO,
} as const satisfies Readonly<
  Record<ApprovedA4PortraitTemplateId, ApprovedA4PortraitTemplateSpec>
>;

export const APPROVED_A4_PORTRAIT_TEMPLATE_LIST = [
  APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-thumbnail-1"],
  APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-1-flatlay"],
  APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-2-triptych"],
  APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-3-grid"],
  APPROVED_A4_PORTRAIT_TEMPLATES["a4-portrait-body-4-studio"],
] as const;

export const APPROVED_A4_PORTRAIT_BODY_TEMPLATE_LIST =
  APPROVED_A4_PORTRAIT_TEMPLATE_LIST.filter((template) => template.kind === "body");

export function getApprovedA4PortraitMockupTemplate(
  templateId: ApprovedA4PortraitTemplateId,
) {
  return APPROVED_A4_PORTRAIT_TEMPLATES[templateId];
}
