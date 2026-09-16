import {
  resolveApprovedMockupSlots,
  type ApprovedMockupTemplateSpec,
  type ResolvedApprovedMockupSlot,
} from "./approved-16x9-templates.ts";

type Point = Readonly<{ x: number; y: number }>;
type AnyTemplate = ApprovedMockupTemplateSpec<string, string, number>;

export function approvedSlotPolygon(slot: ResolvedApprovedMockupSlot): Point[] {
  const radians = slot.angle * Math.PI / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  const vx = -uy;
  const vy = ux;
  return [
    { x: slot.x, y: slot.y },
    { x: slot.x + slot.width * ux, y: slot.y + slot.width * uy },
    { x: slot.x + slot.width * ux + slot.height * vx, y: slot.y + slot.width * uy + slot.height * vy },
    { x: slot.x + slot.height * vx, y: slot.y + slot.height * vy },
  ];
}

function polygonArea(points: readonly Point[]) {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function clipPolygon(points: readonly Point[], axis: "x" | "y", boundary: number, upper: boolean) {
  const inside = (point: Point) => upper ? point[axis] <= boundary : point[axis] >= boundary;
  const result: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (inside(start) !== inside(end)) {
      const t = (boundary - start[axis]) / (end[axis] - start[axis]);
      result.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    }
    if (inside(end)) result.push(end);
  }
  return result;
}

function visibleArea(points: readonly Point[], width: number, height: number) {
  let clipped = clipPolygon(points, "x", 0, false);
  clipped = clipPolygon(clipped, "x", width, true);
  clipped = clipPolygon(clipped, "y", 0, false);
  return polygonArea(clipPolygon(clipped, "y", height, true));
}

function lineDistance(point: Point, from: Point, to: Point) {
  return Math.abs((to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x))
    / Math.hypot(to.x - from.x, to.y - from.y);
}

/** Measures alignment independently of the image compositor, including collinearity. */
export function inspectApprovedTemplateGeometry(template: AnyTemplate) {
  const errors: string[] = [];
  const slots = resolveApprovedMockupSlots(template);
  const epsilon = 1e-5;
  if (!Number.isFinite(template.axisAngle) || !Number.isFinite(template.slideAspectRatio)
    || template.slideAspectRatio <= 0 || template.canvas.width <= 0 || template.canvas.height <= 0) {
    errors.push("템플릿 각도·규격·캔버스가 유효하지 않습니다.");
  }
  if (new Set(slots.map((slot) => slot.id)).size !== slots.length) errors.push("슬롯 ID 중복");
  if (slots.some((slot, index) => slot.priority !== index)) errors.push("슬롯 우선순위 누락 또는 중복");
  const measurements = slots.map((slot) => {
    const polygon = approvedSlotPolygon(slot);
    if (![slot.x, slot.y, slot.width, slot.height, slot.angle].every(Number.isFinite)
      || slot.width <= 0 || slot.height <= 0) errors.push(`${slot.id}: 유효하지 않은 좌표`);
    const aspectRelativeError = Math.abs(slot.width / slot.height / template.slideAspectRatio - 1);
    if (!Number.isFinite(aspectRelativeError) || aspectRelativeError > 1e-8) errors.push(`${slot.id}: 원본 규격 불일치`);
    if (slot.angle !== template.axisAngle) errors.push(`${slot.id}: 공통 대각선 각도 불일치`);
    const visibleRatio = visibleArea(polygon, template.canvas.width, template.canvas.height) / (slot.width * slot.height);
    const clipped = polygon.some((point) => point.x < -epsilon || point.y < -epsilon
      || point.x > template.canvas.width + epsilon || point.y > template.canvas.height + epsilon);
    if (!(visibleRatio > 0)) errors.push(`${slot.id}: 화면에 보이지 않는 슬롯`);
    if (clipped && !slot.allowCanvasClip) errors.push(`${slot.id}: 승인되지 않은 화면 잘림`);
    return { slotId: slot.id, polygon, visibleRatio, clipped, aspectRelativeError };
  });

  const alignments: { id: string; edge: "top" | "bottom"; deviationPx: number }[] = [];
  const groups = [
    ...template.rails.map((rail) => ({ id: rail.id, slotIds: slots.filter((slot) => slot.railId === rail.id).map((slot) => slot.id), edges: ["top", "bottom"] as const })),
    ...(template.edgeAlignments || []).map((group, index) => ({ id: `fixed-${index + 1}`, ...group })),
  ];
  for (const group of groups) {
    const cards = group.slotIds.map((id) => measurements.find((slot) => slot.slotId === id));
    if (cards.some((card) => !card)) {
      errors.push(`${group.id}: 기준선에 없는 슬롯이 지정됐습니다.`);
      continue;
    }
    if (cards.length < 2) continue;
    for (const edge of group.edges) {
      const [a, b] = edge === "top" ? [0, 1] : [3, 2];
      const first = cards[0]!;
      const deviationPx = Math.max(...cards.flatMap((card) => [a, b].map((i) => (
        lineDistance(card!.polygon[i], first.polygon[a], first.polygon[b])
      ))));
      alignments.push({ id: group.id, edge, deviationPx });
      if (!Number.isFinite(deviationPx) || deviationPx > epsilon) {
        errors.push(`${group.id}/${edge}: 윗변·아랫변 직선 연결 불일치 (${deviationPx.toFixed(4)}px)`);
      }
    }
  }
  return { templateId: template.id, passed: errors.length === 0, errors, slots: measurements, alignments };
}
