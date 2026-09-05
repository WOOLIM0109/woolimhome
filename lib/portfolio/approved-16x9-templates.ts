/**
 * Approved 16:9 portfolio mockup geometry.
 *
 * This module intentionally contains data and coordinate expansion only. It
 * does not read customer slides, render images, or embed preview assets.
 */

export const APPROVED_16X9_TEMPLATE_VERSION = "approved-16x9-v1" as const;
export const APPROVED_16X9_TEMPLATE_SUITE_ID = "approved-16x9-suite" as const;

export const APPROVED_16X9_SLIDE_ASPECT_RATIO = 16 / 9;

export type ApprovedMockupTemplateId =
  | "thumbnail-1"
  | "body-3-perspective"
  | "body-4-corridor"
  | "body-5-grid"
  | "body-6-lattice";

export type ApprovedMockupOutputName =
  | "thumbnail.jpg"
  | "short-main.jpg"
  | "short-detail-1.jpg"
  | "short-detail-2.jpg"
  | "short-detail-3.jpg";

export type ApprovedMockupBackgroundId =
  | "thumbnail-light"
  | "stage-radial"
  | "corridor-light"
  | "grid-light";

export type ApprovedMockupLayer =
  | "background"
  | "support-shadow"
  | "support"
  | "focus-shadow"
  | "hero"
  | "logo";

export type ApprovedMockupSlotRole = "hero" | "support";

export type ApprovedMockupShadow =
  | Readonly<{ kind: "support"; strength: number }>
  | Readonly<{ kind: "focus" }>;

export type ApprovedMockupCanvas = Readonly<{
  width: number;
  height: number;
}>;

export type ApprovedMockupLogoSpec = Readonly<{
  assetPath: "/images/woolim-logo-cropped.png";
  left: number;
  top: number;
  width: number;
  z: number;
}>;

export type ApprovedMockupBackgroundSpec =
  | Readonly<{
      kind: "linear-gradient";
      from: string;
      to: string;
      vector: Readonly<{ x1: number; y1: number; x2: number; y2: number }>;
    }>
  | Readonly<{
      kind: "radial-gradient";
      center: Readonly<{ x: number; y: number }>;
      radius: number;
      stops: readonly Readonly<{ offset: number; color: string }>[];
    }>;

export type ApprovedMockupFixedSlotSpec = Readonly<{
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: ApprovedMockupSlotRole;
  /** Lower numbers receive source slides first when fewer slides are available. */
  priority: number;
  z: number;
  shadow: ApprovedMockupShadow;
  washOpacity: number;
  allowCanvasClip: boolean;
}>;

export type ApprovedMockupRailSpec = Readonly<{
  id: string;
  start: Readonly<{ x: number; y: number }>;
  cardWidth: number;
  gap: number;
  count: number;
  role: "support";
  /** One priority per physical rail position, from left to right. */
  priorities: readonly number[];
  zStart: number;
  zStep: number;
  shadow: ApprovedMockupShadow;
  washOpacity: number;
  allowCanvasClip: boolean;
}>;

export type ApprovedMockupTemplateSpec = Readonly<{
  id: ApprovedMockupTemplateId;
  templateNumber: 1 | 3 | 4 | 5 | 6;
  version: typeof APPROVED_16X9_TEMPLATE_VERSION;
  outputName: ApprovedMockupOutputName;
  kind: "thumbnail" | "body";
  canvas: ApprovedMockupCanvas;
  slideAspectRatio: typeof APPROVED_16X9_SLIDE_ASPECT_RATIO;
  /** Every card edge in the template inherits this angle. */
  axisAngle: number;
  backgroundId: ApprovedMockupBackgroundId;
  logo: ApprovedMockupLogoSpec;
  rails: readonly ApprovedMockupRailSpec[];
  fixedSlots: readonly ApprovedMockupFixedSlotSpec[];
  layerOrder: readonly ApprovedMockupLayer[];
}>;

export type ResolvedApprovedMockupSlot = Readonly<{
  id: string;
  source: "rail" | "fixed";
  railId?: string;
  railIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  role: ApprovedMockupSlotRole;
  priority: number;
  z: number;
  shadow: ApprovedMockupShadow;
  washOpacity: number;
  allowCanvasClip: boolean;
}>;

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

const DEFAULT_BODY_LOGO = {
  assetPath: "/images/woolim-logo-cropped.png",
  left: 48,
  top: 38,
  width: 110,
  z: 1_000,
} as const satisfies ApprovedMockupLogoSpec;

export const APPROVED_16X9_BACKGROUNDS = {
  "thumbnail-light": {
    kind: "linear-gradient",
    from: "#f6f8f9",
    to: "#e4eaed",
    vector: { x1: 0, y1: 0, x2: 1, y2: 1 },
  },
  "stage-radial": {
    kind: "radial-gradient",
    center: { x: 0.53, y: 0.43 },
    radius: 0.72,
    stops: [
      { offset: 0, color: "#f8f8f8" },
      { offset: 0.58, color: "#d8dadd" },
      { offset: 1, color: "#aeb1b5" },
    ],
  },
  "corridor-light": {
    kind: "linear-gradient",
    from: "#f6f8f9",
    to: "#e4eaed",
    vector: { x1: 0, y1: 0, x2: 1, y2: 1 },
  },
  "grid-light": {
    kind: "radial-gradient",
    center: { x: 0.5, y: 0.42 },
    radius: 0.72,
    stops: [
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "#f0f2f4" },
    ],
  },
} as const satisfies Readonly<Record<ApprovedMockupBackgroundId, ApprovedMockupBackgroundSpec>>;

/**
 * Expands one rail using the template's single shared axis angle. Keeping the
 * angle outside the rail prevents one row (or the hero card) from bending away
 * from the approved diagonal.
 */
export function expandApprovedMockupRail(
  rail: ApprovedMockupRailSpec,
  axisAngle: number,
  slideAspectRatio = APPROVED_16X9_SLIDE_ASPECT_RATIO,
): ResolvedApprovedMockupSlot[] {
  if (rail.priorities.length !== rail.count) {
    throw new Error(
      `Mockup rail ${rail.id} has ${rail.count} slots but ${rail.priorities.length} priorities.`,
    );
  }

  const radians = (axisAngle * Math.PI) / 180;
  const stepX = (rail.cardWidth + rail.gap) * Math.cos(radians);
  const stepY = (rail.cardWidth + rail.gap) * Math.sin(radians);
  const height = rail.cardWidth / slideAspectRatio;

  return Array.from({ length: rail.count }, (_, railIndex) => ({
    id: `${rail.id}-${railIndex + 1}`,
    source: "rail" as const,
    railId: rail.id,
    railIndex,
    x: rail.start.x + railIndex * stepX,
    y: rail.start.y + railIndex * stepY,
    width: rail.cardWidth,
    height,
    angle: axisAngle,
    role: rail.role,
    priority: rail.priorities[railIndex],
    z: rail.zStart + railIndex * rail.zStep,
    shadow: rail.shadow,
    washOpacity: rail.washOpacity,
    allowCanvasClip: rail.allowCanvasClip,
  }));
}

export function resolveApprovedMockupSlots(
  template: ApprovedMockupTemplateSpec,
): ResolvedApprovedMockupSlot[] {
  const railSlots = template.rails.flatMap((rail) =>
    expandApprovedMockupRail(rail, template.axisAngle, template.slideAspectRatio),
  );
  const fixedSlots = template.fixedSlots.map((slot) => ({
    ...slot,
    source: "fixed" as const,
    angle: template.axisAngle,
  }));

  return [...railSlots, ...fixedSlots].sort(
    (left, right) => left.priority - right.priority || left.z - right.z || left.id.localeCompare(right.id),
  );
}

const THUMBNAIL_1 = {
  id: "thumbnail-1",
  templateNumber: 1,
  version: APPROVED_16X9_TEMPLATE_VERSION,
  outputName: "thumbnail.jpg",
  kind: "thumbnail",
  canvas: THUMBNAIL_CANVAS,
  slideAspectRatio: APPROVED_16X9_SLIDE_ASPECT_RATIO,
  axisAngle: -9,
  backgroundId: "thumbnail-light",
  logo: {
    assetPath: "/images/woolim-logo-cropped.png",
    left: 42,
    top: 34,
    width: 95,
    z: 1_000,
  },
  rails: [
    {
      id: "top",
      start: { x: -150, y: 190 },
      cardWidth: 430,
      gap: 35,
      count: 3,
      role: "support",
      priorities: [3, 1, 5],
      zStart: 10,
      zStep: 1,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0.16,
      allowCanvasClip: true,
    },
    {
      id: "bottom",
      start: { x: -110, y: 835 },
      cardWidth: 450,
      gap: 35,
      count: 3,
      role: "support",
      priorities: [6, 2, 4],
      zStart: 20,
      zStep: 1,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0.16,
      allowCanvasClip: true,
    },
  ],
  fixedSlots: [
    {
      id: "hero",
      x: 100,
      y: 345,
      width: 820,
      height: 461.25,
      role: "hero",
      priority: 0,
      z: 100,
      shadow: { kind: "focus" },
      washOpacity: 0,
      allowCanvasClip: false,
    },
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedMockupTemplateSpec;

const BODY_3_PERSPECTIVE = {
  id: "body-3-perspective",
  templateNumber: 3,
  version: APPROVED_16X9_TEMPLATE_VERSION,
  outputName: "short-main.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_16X9_SLIDE_ASPECT_RATIO,
  axisAngle: -10,
  backgroundId: "stage-radial",
  logo: DEFAULT_BODY_LOGO,
  rails: [
    {
      id: "back",
      start: { x: -180, y: 230 },
      cardWidth: 560,
      gap: 70,
      count: 3,
      role: "support",
      priorities: [3, 1, 5],
      zStart: 10,
      zStep: 1,
      shadow: { kind: "support", strength: 1.05 },
      washOpacity: 0,
      allowCanvasClip: true,
    },
    {
      id: "front",
      start: { x: -220, y: 710 },
      cardWidth: 600,
      gap: 55,
      count: 3,
      role: "support",
      priorities: [6, 2, 4],
      zStart: 20,
      zStep: 1,
      shadow: { kind: "support", strength: 1.05 },
      washOpacity: 0,
      allowCanvasClip: true,
    },
  ],
  fixedSlots: [
    {
      id: "hero",
      x: 373,
      y: 291,
      width: 860,
      height: 483.75,
      role: "hero",
      priority: 0,
      z: 100,
      shadow: { kind: "focus" },
      washOpacity: 0,
      allowCanvasClip: false,
    },
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedMockupTemplateSpec;

const BODY_4_CORRIDOR = {
  id: "body-4-corridor",
  templateNumber: 4,
  version: APPROVED_16X9_TEMPLATE_VERSION,
  outputName: "short-detail-1.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_16X9_SLIDE_ASPECT_RATIO,
  axisAngle: -13,
  backgroundId: "corridor-light",
  logo: DEFAULT_BODY_LOGO,
  rails: [
    {
      id: "top",
      start: { x: -170, y: 210 },
      cardWidth: 600,
      gap: 30,
      count: 3,
      role: "support",
      priorities: [2, 0, 4],
      zStart: 10,
      zStep: 1,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: true,
    },
    {
      id: "bottom",
      start: { x: -285, y: 690 },
      cardWidth: 600,
      gap: 30,
      count: 4,
      role: "support",
      priorities: [6, 1, 3, 5],
      zStart: 20,
      zStep: 1,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: true,
    },
  ],
  fixedSlots: [],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedMockupTemplateSpec;

const BODY_5_GRID = {
  id: "body-5-grid",
  templateNumber: 5,
  version: APPROVED_16X9_TEMPLATE_VERSION,
  outputName: "short-detail-2.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_16X9_SLIDE_ASPECT_RATIO,
  axisAngle: 0,
  backgroundId: "grid-light",
  logo: {
    ...DEFAULT_BODY_LOGO,
    left: 32,
    top: 24,
  },
  rails: [],
  fixedSlots: [
    {
      id: "top-left",
      x: 156,
      y: 79,
      width: 624,
      height: 351,
      role: "support",
      priority: 0,
      z: 10,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: false,
    },
    {
      id: "top-right",
      x: 820,
      y: 79,
      width: 624,
      height: 351,
      role: "support",
      priority: 1,
      z: 11,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: false,
    },
    {
      id: "bottom-left",
      x: 156,
      y: 470,
      width: 624,
      height: 351,
      role: "support",
      priority: 2,
      z: 12,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: false,
    },
    {
      id: "bottom-right",
      x: 820,
      y: 470,
      width: 624,
      height: 351,
      role: "support",
      priority: 3,
      z: 13,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: false,
    },
  ],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedMockupTemplateSpec;

const BODY_6_LATTICE = {
  id: "body-6-lattice",
  templateNumber: 6,
  version: APPROVED_16X9_TEMPLATE_VERSION,
  outputName: "short-detail-3.jpg",
  kind: "body",
  canvas: BODY_CANVAS,
  slideAspectRatio: APPROVED_16X9_SLIDE_ASPECT_RATIO,
  axisAngle: -20,
  // Deliberately shared with template 4 so both stay on the approved light background.
  backgroundId: "corridor-light",
  logo: DEFAULT_BODY_LOGO,
  rails: [
    {
      id: "top",
      start: { x: -80, y: 260 },
      cardWidth: 720,
      gap: 36,
      count: 3,
      role: "support",
      priorities: [6, 1, 7],
      zStart: 10,
      zStep: 1,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: true,
    },
    {
      id: "middle",
      start: { x: -98.3, y: 736 },
      cardWidth: 720,
      gap: 36,
      count: 3,
      role: "support",
      priorities: [3, 0, 4],
      zStart: 20,
      zStep: 1,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: true,
    },
    {
      id: "bottom",
      // The first physical card in the approved preview is completely below
      // the canvas. Start at the next visible position so no source slide is
      // recorded in a slot that contributes zero pixels.
      start: { x: 593.8076213141468, y: 953.3327716457945 },
      cardWidth: 720,
      gap: 36,
      count: 2,
      role: "support",
      priorities: [2, 5],
      zStart: 30,
      zStep: 1,
      shadow: { kind: "support", strength: 1 },
      washOpacity: 0,
      allowCanvasClip: true,
    },
  ],
  fixedSlots: [],
  layerOrder: DEFAULT_LAYER_ORDER,
} as const satisfies ApprovedMockupTemplateSpec;

export const APPROVED_16X9_TEMPLATES = {
  "thumbnail-1": THUMBNAIL_1,
  "body-3-perspective": BODY_3_PERSPECTIVE,
  "body-4-corridor": BODY_4_CORRIDOR,
  "body-5-grid": BODY_5_GRID,
  "body-6-lattice": BODY_6_LATTICE,
} as const satisfies Readonly<Record<ApprovedMockupTemplateId, ApprovedMockupTemplateSpec>>;

export const APPROVED_16X9_TEMPLATE_LIST = [
  APPROVED_16X9_TEMPLATES["thumbnail-1"],
  APPROVED_16X9_TEMPLATES["body-3-perspective"],
  APPROVED_16X9_TEMPLATES["body-4-corridor"],
  APPROVED_16X9_TEMPLATES["body-5-grid"],
  APPROVED_16X9_TEMPLATES["body-6-lattice"],
] as const;

export const APPROVED_16X9_BODY_TEMPLATE_LIST = APPROVED_16X9_TEMPLATE_LIST.filter(
  (template) => template.kind === "body",
);

export function getApprovedMockupTemplate(
  templateId: ApprovedMockupTemplateId,
): ApprovedMockupTemplateSpec {
  return APPROVED_16X9_TEMPLATES[templateId];
}

export function getApprovedMockupSlotsInPriorityOrder(
  templateId: ApprovedMockupTemplateId,
): ResolvedApprovedMockupSlot[] {
  return resolveApprovedMockupSlots(getApprovedMockupTemplate(templateId));
}
