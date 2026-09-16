/**
 * Approved A4-landscape portfolio mockup geometry.
 *
 * These records are the smart-object-style source of truth. Only slide image
 * buffers are replaced at render time; canvas size, coordinates, angles,
 * shadows, logo position, background, and layer order stay locked.
 */

import { APPROVED_MOCKUP_DEFAULT_TITLE_BOX } from "./approved-16x9-templates.ts";
import type {
  ApprovedMockupFixedSlotSpec,
  ApprovedMockupLayer,
  ApprovedMockupLogoSpec,
  ApprovedMockupRailSpec,
  ApprovedMockupTemplateSpec,
} from "./approved-16x9-templates.ts";

export const APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION = "approved-a4-landscape-v1" as const;
export const APPROVED_A4_LANDSCAPE_TEMPLATE_SUITE_ID = "approved-a4-landscape-suite" as const;
export const APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO = Math.SQRT2;

export type ApprovedA4LandscapeTemplateId =
  | "a4-landscape-thumbnail-1"
  | "a4-landscape-body-3-stage"
  | "a4-landscape-body-4-corridor"
  | "a4-landscape-body-5-grid"
  | "a4-landscape-body-6-lattice";

type ApprovedA4LandscapeTemplateSpec = ApprovedMockupTemplateSpec<
  ApprovedA4LandscapeTemplateId,
  typeof APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
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
  width: 95,
  z: 1_000,
} as const satisfies ApprovedMockupLogoSpec;

const BODY_LOGO = {
  assetPath: "/images/woolim-logo-cropped.png",
  left: 48,
  top: 38,
  width: 110,
  z: 1_000,
} as const satisfies ApprovedMockupLogoSpec;

function support(
  id: string,
  x: number,
  y: number,
  width: number,
  priority: number,
  z: number,
): ApprovedMockupFixedSlotSpec {
  return {
    id,
    x,
    y,
    width,
    height: width / APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
    role: "support",
    priority,
    z,
    shadow: { kind: "support", strength: 1 },
    washOpacity: 0,
    allowCanvasClip: false,
  };
}

function hero(x: number, y: number, width: number): ApprovedMockupFixedSlotSpec {
  return {
    id: "hero",
    x,
    y,
    width,
    height: width / APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
    role: "hero",
    priority: 0,
    z: 100,
    shadow: { kind: "focus" },
    washOpacity: 0,
    allowCanvasClip: false,
  };
}

function rail(input: {
  id: string;
  x: number;
  y: number;
  cardWidth: number;
  gap: number;
  priorities: readonly number[];
  zStart: number;
  washOpacity?: number;
}): ApprovedMockupRailSpec {
  return {
    id: input.id,
    start: { x: input.x, y: input.y },
    cardWidth: input.cardWidth,
    gap: input.gap,
    count: input.priorities.length,
    role: "support",
    priorities: input.priorities,
    zStart: input.zStart,
    zStep: 1,
    shadow: { kind: "support", strength: 1 },
    washOpacity: input.washOpacity || 0,
    allowCanvasClip: true,
  };
}

const THUMBNAIL_1 = {
  id: "a4-landscape-thumbnail-1",
  templateNumber: 1,
  version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  outputName: "thumbnail.jpg",
  kind: "thumbnail",
  titleBox: APPROVED_MOCKUP_DEFAULT_TITLE_BOX,
  canvas: THUMBNAIL_CANVAS,
  slideAspectRatio: APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
  axisAngle: -8,
  backgroundId: "thumbnail-light",
  logo: THUMBNAIL_LOGO,
  rails: [
    rail({
      id: "top",
      x: -160,
      y: 215,
      cardWidth: 390,
      gap: 45,
      priorities: [3, 1, 5],
      zStart: 10,
      washOpacity: 0.16,
    }),
    rail({
      id: "bottom",
      x: -120,
      y: 845,
      cardWidth: 410,
      gap: 45,
      priorities: [6, 2, 4],
      zStart: 20,
      washOpacity: 0.16,
    }),
  ],
  fixedSlots: [hero(155, 340, 770)],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4LandscapeTemplateSpec;

const BODY_3_STAGE = {
  id: "a4-landscape-body-3-stage",
  templateNumber: 3,
  version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  outputName: "short-main.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
  axisAngle: -9,
  backgroundId: "stage-radial",
  logo: BODY_LOGO,
  rails: [
    rail({
      id: "back",
      x: -180,
      y: 255,
      cardWidth: 520,
      gap: 50,
      priorities: [3, 1, 5],
      zStart: 10,
    }),
    rail({
      id: "front",
      x: -250,
      y: 760,
      cardWidth: 560,
      gap: 45,
      priorities: [6, 2, 4],
      zStart: 20,
    }),
  ],
  fixedSlots: [hero(400, 230, 800)],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4LandscapeTemplateSpec;

const BODY_4_CORRIDOR = {
  id: "a4-landscape-body-4-corridor",
  templateNumber: 4,
  version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  outputName: "short-detail-1.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
  axisAngle: -12,
  backgroundId: "corridor-light",
  logo: BODY_LOGO,
  rails: [
    rail({
      id: "top",
      x: -130,
      y: 280,
      cardWidth: 500,
      gap: 30,
      priorities: [2, 0, 4],
      zStart: 10,
    }),
    rail({
      id: "bottom",
      x: -220,
      y: 750,
      cardWidth: 500,
      gap: 30,
      priorities: [6, 1, 3, 5],
      zStart: 20,
    }),
  ],
  fixedSlots: [],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4LandscapeTemplateSpec;

const BODY_5_GRID = {
  id: "a4-landscape-body-5-grid",
  templateNumber: 5,
  version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  outputName: "short-detail-2.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
  axisAngle: 0,
  backgroundId: "grid-light",
  logo: { ...BODY_LOGO, left: 32, top: 24 },
  rails: [],
  fixedSlots: [
    support("top-left", 200, 45, 560, 0, 10),
    support("top-right", 840, 45, 560, 1, 11),
    support("bottom-left", 200, 460, 560, 2, 12),
    support("bottom-right", 840, 460, 560, 3, 13),
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4LandscapeTemplateSpec;

const BODY_6_LATTICE = {
  id: "a4-landscape-body-6-lattice",
  templateNumber: 6,
  version: APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
  outputName: "short-detail-3.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_A4_LANDSCAPE_SLIDE_ASPECT_RATIO,
  axisAngle: -18,
  backgroundId: "corridor-light",
  logo: BODY_LOGO,
  rails: [
    rail({
      id: "top",
      x: -120,
      y: 290,
      cardWidth: 600,
      gap: 50,
      priorities: [4, 0, 5],
      zStart: 10,
    }),
    rail({
      id: "middle",
      x: -190,
      y: 780,
      cardWidth: 600,
      gap: 50,
      priorities: [3, 1, 2],
      zStart: 20,
    }),
  ],
  fixedSlots: [],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedA4LandscapeTemplateSpec;

export const APPROVED_A4_LANDSCAPE_TEMPLATES = {
  "a4-landscape-thumbnail-1": THUMBNAIL_1,
  "a4-landscape-body-3-stage": BODY_3_STAGE,
  "a4-landscape-body-4-corridor": BODY_4_CORRIDOR,
  "a4-landscape-body-5-grid": BODY_5_GRID,
  "a4-landscape-body-6-lattice": BODY_6_LATTICE,
} as const satisfies Readonly<Record<ApprovedA4LandscapeTemplateId, ApprovedA4LandscapeTemplateSpec>>;

export const APPROVED_A4_LANDSCAPE_TEMPLATE_LIST = [
  APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-thumbnail-1"],
  APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-3-stage"],
  APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-4-corridor"],
  APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-5-grid"],
  APPROVED_A4_LANDSCAPE_TEMPLATES["a4-landscape-body-6-lattice"],
] as const;

export const APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_LIST =
  APPROVED_A4_LANDSCAPE_TEMPLATE_LIST.filter((template) => template.kind === "body");

export function getApprovedA4LandscapeMockupTemplate(
  templateId: ApprovedA4LandscapeTemplateId,
) {
  return APPROVED_A4_LANDSCAPE_TEMPLATES[templateId];
}
