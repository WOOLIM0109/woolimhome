import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { Socket } from "node:net";
import {
  approveLocalRedactionSlide,
  getLocalRedactionSlide,
  readSafeRedactedSlide,
  renderLocalRedactionSlide,
  saveLocalRedactionSlide,
} from "./redaction-service.ts";
import {
  confirmLocalMockupTitle,
  getLocalMockupReview,
  getLocalMockupTitleReview,
  getVerifiedProductionMockupDescriptor,
  initializeLocalMockups,
  readLocalMockupImage,
  readLocalMockupTitleImage,
  renderLocalMockups,
  renderLocalMockupTitle,
  requestLocalMockupSlide,
  saveLocalMockupAssignments,
  saveLocalMockupTitle,
} from "./mockup-service.ts";
import type { LocalMockupReview } from "./mockup-types.ts";
import type {
  RedactionException,
  RedactionRect,
  RedactionRegion,
  RedactionReview,
  RedactionState,
  RedactionManualResolution,
} from "./redaction-types.ts";
import { PREPARATION_WORK_SCHEMA_VERSION } from "./work-store.ts";
import type { LocalPreparationReviewCallbacks, PreparationReviewView, PreparationReviewBuild, PreparationVisualDecision, PreparationReviewApplyInput } from "./preparation-review-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const REVIEW_ARTIFACT_PATTERN = /^(preview|highres):([1-9]\d*)$/;
const COOKIE_PREFIX = "woolim_review_session";
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_POST_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const REDACTION_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  email: "이메일",
  contact: "연락처",
  identifier: "식별번호",
  account: "계좌 정보",
  authentication: "인증·보안 정보",
  address: "주소",
  name: "이름",
  amount: "금액",
  internal_detail: "내부 정보",
  qr: "QR 코드",
  barcode: "바코드",
  signature: "서명·직인",
  image_review: "사진 속 정보",
  chart_review: "차트 속 정보",
  object_review: "검사하기 어려운 개체",
});
const REDACTION_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  EMAIL_PATTERN_REQUIRES_OPAQUE_REDACTION: "이메일로 보이는 정보는 불투명하게 가려야 합니다.",
  CONTACT_PATTERN_REQUIRES_OPAQUE_REDACTION: "전화번호로 보이는 정보는 불투명하게 가려야 합니다.",
  IDENTIFIER_PATTERN_REQUIRES_OPAQUE_REDACTION: "개인·사업자 식별번호로 보이는 정보는 불투명하게 가려야 합니다.",
  ACCOUNT_PATTERN_REQUIRES_OPAQUE_REDACTION: "계좌 정보로 보이는 내용은 불투명하게 가려야 합니다.",
  AUTHENTICATION_PATTERN_REQUIRES_OPAQUE_REDACTION: "인증·보안 정보로 보이는 내용은 불투명하게 가려야 합니다.",
  ADDRESS_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION: "주소는 불투명하게 가리거나 공개 예외 사유를 기록해야 합니다.",
  NAME_REQUIRES_LOCAL_DISCLOSURE_REVIEW: "이름 공개가 가능한지 직접 확인해 주세요.",
  AMOUNT_REQUIRES_LOCAL_DISCLOSURE_REVIEW: "금액 공개가 가능한지 직접 확인해 주세요.",
  INTERNAL_DETAIL_REQUIRES_LOCAL_DISCLOSURE_REVIEW: "내부 정보 공개가 가능한지 직접 확인해 주세요.",
  QR_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION: "QR 코드는 불투명하게 가리거나 공개 예외 사유를 기록해야 합니다.",
  BARCODE_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION: "바코드는 불투명하게 가리거나 공개 예외 사유를 기록해야 합니다.",
  SIGNATURE_REQUIRES_OPAQUE_REDACTION_OR_EXCEPTION: "서명·직인은 불투명하게 가리거나 공개 예외 사유를 기록해야 합니다.",
  IMAGE_CONTENT_REQUIRES_LOCAL_REVIEW: "사진 속 이름·번호·문구를 확대해 직접 확인해 주세요.",
  CHART_LABELS_REQUIRE_LOCAL_REVIEW: "차트의 이름·수치·라벨을 확대해 직접 확인해 주세요.",
  UNINSPECTABLE_OBJECT_REQUIRES_LOCAL_REVIEW: "자동 검사하기 어려운 개체이므로 원본에서 직접 확인해 주세요.",
});
const REDACTION_WARNING_LABELS: Readonly<Record<string, string>> = Object.freeze({
  PIXEL_CONTENT_REQUIRES_HIGH_RESOLUTION_LOCAL_REVIEW: "사진·도형 속 내용을 포함해 고해상도 원본을 직접 확인하세요.",
  CANDIDATE_GEOMETRY_REQUIRES_LOCAL_REVIEW: "자동으로 잡은 가림 위치가 정확한지 확대해 확인하세요.",
  HIGH_REQUIRED_REDACTION_COVERAGE_REPLACEMENT_REVIEW: "필수 가림 범위가 넓습니다. 디자인을 유지하기 어렵다면 장표를 교체하세요.",
  HIGH_REVIEW_COVERAGE_REPLACEMENT_REVIEW: "확인할 범위가 넓습니다. 디자인을 유지하기 어렵다면 장표를 교체하세요.",
});

type JsonRecord = Record<string, unknown>;
type ReviewStatus = "selected" | "reserve" | "excluded" | "pending";

type LedgerArtifact = {
  key: string;
  relativePath: string;
  sha256: string;
  bytes: number;
};

type LedgerSnapshot = {
  inspection: unknown;
  selection: unknown;
  artifacts: Map<string, LedgerArtifact>;
};

type SafeIssue = { code: string; detail: string };

type ReviewSlide = {
  sourceSlideNumber: number;
  title: string;
  hidden: boolean;
  status: ReviewStatus;
  reasons: string[];
  missingFonts: string[];
  previewUrl: string | null;
  highresUrl: string | null;
};

type ReviewModel = {
  aspect: string;
  totalSlides: number;
  width: number | null;
  height: number | null;
  issues: SafeIssue[];
  slides: ReviewSlide[];
  counts: Record<ReviewStatus, number>;
};

export class LocalReviewServerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalReviewServerError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new LocalReviewServerError(code, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeRelativePath(value: unknown) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    fail("INVALID_LEDGER", "검토 이미지 경로가 올바르지 않습니다.");
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    fail("INVALID_LEDGER", "검토 이미지의 절대 경로는 허용되지 않습니다.");
  }
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("INVALID_LEDGER", "검토 이미지 경로가 작업 폴더를 벗어났습니다.");
  }
  if (segments.some((segment) => /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment))) {
    fail("INVALID_LEDGER", "검토 이미지 경로에 안전하지 않은 문자가 있습니다.");
  }
  return segments.join("/");
}

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function assertRealDirectory(value: string, label: string) {
  const info = await lstat(value);
  if (info.isSymbolicLink() || !info.isDirectory()) fail("UNSAFE_PATH", `${label} 폴더가 안전하지 않습니다.`);
}

async function assertNoLinks(root: string, relativePath: string, leafMustBeFile: boolean) {
  await assertRealDirectory(root, "작업");
  const segments = relativePath.replaceAll("\\", "/").split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) fail("UNSAFE_PATH", "심볼릭 링크를 통한 검토 파일 접근은 허용되지 않습니다.");
    const leaf = index === segments.length - 1;
    if (!leaf && !info.isDirectory()) fail("UNSAFE_PATH", "검토 파일의 상위 경로가 폴더가 아닙니다.");
    if (leaf && leafMustBeFile && (!info.isFile() || info.nlink > 1)) {
      fail("UNSAFE_PATH", "검토 대상은 단일 일반 파일이어야 합니다.");
    }
  }
  const resolved = await realpath(current);
  if (!isInside(root, resolved)) fail("UNSAFE_PATH", "검토 파일이 작업 폴더를 벗어났습니다.");
  return current;
}

async function readJsonInside(root: string, relativePath: string) {
  const filePath = await assertNoLinks(root, relativePath, true);
  const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1 || info.size > MAX_STATE_BYTES) {
      fail("INVALID_LEDGER", "검토 기록 파일 크기 또는 형식이 올바르지 않습니다.");
    }
    try {
      return JSON.parse(await handle.readFile("utf8")) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) fail("INVALID_LEDGER", "검토 기록 JSON을 읽을 수 없습니다.");
      throw error;
    }
  } finally {
    await handle.close();
  }
}

async function readLedger(root: string, buildId: string): Promise<LedgerSnapshot> {
  const work = await readJsonInside(root, "work.json");
  if (!isRecord(work)
    || work.schemaVersion !== PREPARATION_WORK_SCHEMA_VERSION
    || typeof work.workId !== "string"
    || !Array.isArray(work.buildIds)
    || !work.buildIds.includes(buildId)) {
    fail("BUILD_NOT_FOUND", "등록된 로컬 검토 작업을 찾지 못했습니다.");
  }
  const build = await readJsonInside(root, `builds/${buildId}/record.json`);
  if (!isRecord(build)
    || build.schemaVersion !== PREPARATION_WORK_SCHEMA_VERSION
    || build.buildId !== buildId
    || build.workId !== work.workId
    || !isRecord(build.stages)
    || !isRecord(build.artifacts)) {
    fail("INVALID_LEDGER", "로컬 검토 기록의 작업 식별자가 일치하지 않습니다.");
  }
  const artifacts = new Map<string, LedgerArtifact>();
  for (const [key, raw] of Object.entries(build.artifacts)) {
    const match = REVIEW_ARTIFACT_PATTERN.exec(key);
    if (!match) continue;
    if (!isRecord(raw)
      || raw.key !== key
      || typeof raw.relativePath !== "string"
      || typeof raw.sha256 !== "string"
      || !SHA256_PATTERN.test(raw.sha256)
      || !Number.isSafeInteger(raw.bytes)
      || Number(raw.bytes) < PNG_SIGNATURE.length
      || Number(raw.bytes) > MAX_IMAGE_BYTES) {
      fail("INVALID_LEDGER", `검토 이미지 ${key}의 기록이 올바르지 않습니다.`);
    }
    const relativePath = normalizeRelativePath(raw.relativePath);
    if (!relativePath.toLowerCase().endsWith(".png")) {
      fail("INVALID_LEDGER", "로컬 검토 화면에는 등록된 PNG만 표시할 수 있습니다.");
    }
    artifacts.set(key, {
      key,
      relativePath,
      sha256: raw.sha256.toLowerCase(),
      bytes: Number(raw.bytes),
    });
  }
  const sourceStage = isRecord(build.stages.source_inspection) ? build.stages.source_inspection : null;
  const selectionStage = isRecord(build.stages.slide_selection) ? build.stages.slide_selection : null;
  return {
    inspection: sourceStage?.data ?? null,
    selection: selectionStage?.data ?? null,
    artifacts,
  };
}

function safeIssues(value: unknown): SafeIssue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (typeof entry === "string") {
      const detail = safeString(entry);
      return detail ? [{ code: "NOTICE", detail }] : [];
    }
    if (!isRecord(entry)) return [];
    const code = safeString(entry.code, 80) || "NOTICE";
    const detail = safeString(entry.detail ?? entry.message ?? entry.reason);
    return detail ? [{ code, detail }] : [];
  });
}

function reasonStrings(value: unknown): string[] {
  if (typeof value === "string") return safeString(value) ? [safeString(value)] : [];
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry) => {
    if (typeof entry === "string") return safeString(entry) ? [safeString(entry)] : [];
    if (!isRecord(entry)) return [];
    const reason = safeString(entry.detail ?? entry.message ?? entry.reason ?? entry.code);
    return reason ? [reason] : [];
  });
}

function normalizedStatus(value: unknown): ReviewStatus | null {
  const status = safeString(value, 40).toLowerCase().replaceAll("-", "_");
  if (["selected", "select", "선정", "선택"].includes(status)) return "selected";
  if (["reserve", "reserved", "backup", "예비"].includes(status)) return "reserve";
  if (["excluded", "exclude", "rejected", "on_hold", "hold", "제외", "보류"].includes(status)) {
    return "excluded";
  }
  if (["candidate", "pending", "후보", "미선정"].includes(status)) return "pending";
  return null;
}

type SelectionDecision = { status: ReviewStatus; reasons: string[] };

function selectionNumber(value: unknown) {
  if (typeof value === "number") return positiveInteger(value);
  if (!isRecord(value)) return null;
  return positiveInteger(value.sourceSlideNumber ?? value.slideNumber ?? value.number);
}

function selectionReasons(value: unknown) {
  if (!isRecord(value)) return [];
  return reasonStrings(value.reasons ?? value.reason ?? value.issues ?? value.detail);
}

function selectionMap(raw: unknown) {
  const result = new Map<number, SelectionDecision>();
  if (!isRecord(raw)) return result;
  const directRows = [raw.slides, raw.decisions].find(Array.isArray);
  if (Array.isArray(directRows)) {
    for (const row of directRows.slice(0, 1_000)) {
      const number = selectionNumber(row);
      const status = isRecord(row)
        ? normalizedStatus(row.status ?? row.disposition ?? row.decision ?? row.role)
        : null;
      if (number && status) result.set(number, { status, reasons: selectionReasons(row) });
    }
  }
  const groups: Array<[ReviewStatus, unknown[]]> = [
    ["selected", [raw.selectedSlides, raw.selected]],
    ["reserve", [raw.reserveSlides, raw.reservedSlides, raw.reserves, raw.reserve, raw.backups]],
    ["excluded", [raw.excludedSlides, raw.excluded, raw.onHoldSlides]],
  ];
  for (const [status, candidates] of groups) {
    const values = candidates.find(Array.isArray);
    if (!Array.isArray(values)) continue;
    for (const value of values.slice(0, 1_000)) {
      const number = selectionNumber(value);
      if (number) result.set(number, { status, reasons: [...new Set([...(result.get(number)?.reasons ?? []), ...selectionReasons(value)])] });
    }
  }
  return result;
}

function inspectionRecord(raw: unknown) {
  if (!isRecord(raw)) return {};
  return isRecord(raw.inspection) ? raw.inspection : raw;
}

function artifactUrl(key: string) {
  return `/artifact/${encodeURIComponent(key)}`;
}

function buildReviewModel(snapshot: LedgerSnapshot): ReviewModel {
  const inspection = inspectionRecord(snapshot.inspection);
  const decisions = selectionMap(snapshot.selection);
  const slides = new Map<number, ReviewSlide>();
  const inspectedSlides = Array.isArray(inspection.slides) ? inspection.slides.slice(0, 1_000) : [];
  for (const raw of inspectedSlides) {
    if (!isRecord(raw)) continue;
    const sourceSlideNumber = positiveInteger(raw.sourceSlideNumber);
    if (!sourceSlideNumber) continue;
    const decision = decisions.get(sourceSlideNumber);
    const issues = safeIssues(raw.issues);
    const reasons = [...(decision?.reasons ?? []), ...issues.map((issue) => issue.detail)];
    slides.set(sourceSlideNumber, {
      sourceSlideNumber,
      title: safeString(raw.title, 300),
      hidden: raw.hidden === true,
      status: decision?.status ?? "pending",
      reasons: [...new Set(reasons)].slice(0, 20),
      missingFonts: Array.isArray(raw.missingFonts)
        ? raw.missingFonts.map((font) => safeString(font, 120)).filter(Boolean).slice(0, 30)
        : [],
      previewUrl: snapshot.artifacts.has(`preview:${sourceSlideNumber}`)
        ? artifactUrl(`preview:${sourceSlideNumber}`)
        : null,
      highresUrl: snapshot.artifacts.has(`highres:${sourceSlideNumber}`)
        ? artifactUrl(`highres:${sourceSlideNumber}`)
        : null,
    });
  }
  for (const key of snapshot.artifacts.keys()) {
    const match = REVIEW_ARTIFACT_PATTERN.exec(key)!;
    const sourceSlideNumber = Number(match[2]);
    const existing = slides.get(sourceSlideNumber);
    const decision = decisions.get(sourceSlideNumber);
    if (existing) {
      if (match[1] === "preview") existing.previewUrl = artifactUrl(key);
      else existing.highresUrl = artifactUrl(key);
      continue;
    }
    slides.set(sourceSlideNumber, {
      sourceSlideNumber,
      title: "",
      hidden: false,
      status: decision?.status ?? "pending",
      reasons: decision?.reasons ?? [],
      missingFonts: [],
      previewUrl: match[1] === "preview" ? artifactUrl(key) : null,
      highresUrl: match[1] === "highres" ? artifactUrl(key) : null,
    });
  }
  for (const [sourceSlideNumber, decision] of decisions) {
    const slide = slides.get(sourceSlideNumber);
    if (slide) {
      slide.status = decision.status;
      slide.reasons = [...new Set([...decision.reasons, ...slide.reasons])].slice(0, 20);
    }
  }
  const ordered = [...slides.values()].sort((left, right) => left.sourceSlideNumber - right.sourceSlideNumber);
  const counts: ReviewModel["counts"] = { selected: 0, reserve: 0, excluded: 0, pending: 0 };
  for (const slide of ordered) counts[slide.status] += 1;
  const globalSelectionIssues = isRecord(snapshot.selection)
    ? reasonStrings(snapshot.selection.holds).map((detail) => ({ code: "SELECTION_HOLD", detail }))
    : [];
  return {
    aspect: safeString(inspection.aspect, 60) || "확인 중",
    totalSlides: positiveInteger(inspection.totalSlides) ?? ordered.length,
    width: finiteNumber(inspection.width),
    height: finiteNumber(inspection.height),
    issues: [...safeIssues(inspection.issues), ...globalSelectionIssues],
    slides: ordered,
    counts,
  };
}

const STATUS_LABEL: Record<ReviewStatus, string> = {
  selected: "선정",
  reserve: "예비",
  excluded: "제외·보류",
  pending: "미선정",
};

function renderHtml(model: ReviewModel, preparationReview = false) {
  const issueList = model.issues.length
    ? `<ul class="notices">${model.issues.map((issue) => `<li><b>${escapeHtml(issue.code)}</b> ${escapeHtml(issue.detail)}</li>`).join("")}</ul>`
    : "";
  const cards = model.slides.map((slide) => {
    const imageUrl = slide.previewUrl ?? slide.highresUrl;
    const reasons = slide.reasons.length
      ? `<ul class="reasons">${slide.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
      : "<p class=\"muted\">기록된 사유 없음</p>";
    const fonts = slide.missingFonts.length
      ? `<p class="font-warning">누락 글꼴: ${escapeHtml(slide.missingFonts.join(", "))}</p>`
      : "";
    const editor = slide.highresUrl && (slide.status === "selected" || slide.status === "reserve")
      ? `<a class="edit-link" href="/editor/${slide.sourceSlideNumber}">가림 편집</a>`
      : "";
    return `<article class="card status-${slide.status}">
      <div class="card-head"><strong>${slide.sourceSlideNumber}번</strong><span>${STATUS_LABEL[slide.status]}</span></div>
      ${imageUrl ? `<a href="${escapeHtml(slide.highresUrl ?? imageUrl)}" aria-label="${slide.sourceSlideNumber}번 장표 크게 보기"><img src="${escapeHtml(imageUrl)}" alt="${slide.sourceSlideNumber}번 장표 로컬 미리보기"></a>` : "<div class=\"image-missing\">미리보기 없음</div>"}
      <h2>${escapeHtml(slide.title || `${slide.sourceSlideNumber}번 장표`)}</h2>
      ${slide.hidden ? "<p class=\"font-warning\">숨김 장표</p>" : ""}
      ${fonts}${reasons}
      <p class="asset-state">${slide.previewUrl ? "저해상도 있음" : "저해상도 없음"} · ${slide.highresUrl ? "고해상도 있음" : "고해상도 없음"}</p>
      ${editor}
    </article>`;
  }).join("");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>울림 로컬 장표 검토</title><link rel="stylesheet" href="/style.css"></head>
<body><header class="top"><div><p class="privacy">로컬 확인 전용 · 업로드 안 함</p><h1>장표 선정 검토</h1>
<p>${escapeHtml(model.aspect)} · 원본 ${model.totalSlides}장${model.width && model.height ? ` · ${escapeHtml(model.width)} × ${escapeHtml(model.height)} pt` : ""}</p></div>
<div class="top-actions"><p class="step-note">선정·예비 장표의 고해상도 원본만 가림 편집할 수 있습니다.</p>${preparationReview ? '<a class="mockup-link" href="/preparation">규격·추상 그래픽 직접 검수</a>' : ''}<a class="mockup-link" href="/mockups">목업 배정·미리보기</a></div></header>
<section class="summary" aria-label="선정 현황"><b>선정 ${model.counts.selected}</b><b>예비 ${model.counts.reserve}</b><b>제외·보류 ${model.counts.excluded}</b><b>미선정 ${model.counts.pending}</b></section>
${issueList}<main class="gallery">${cards || "<p class=\"empty\">아직 표시할 장표가 없습니다.</p>"}</main>
<footer>원본과 편집 기록은 이 PC의 작업 폴더 안에만 남습니다. 가림 편집은 버튼을 누른 뒤 저장할 때만 기록됩니다.</footer></body></html>`;
}

function renderEditorHtml(sourceSlideNumber: number) {
  const highresUrl = artifactUrl(`highres:${sourceSlideNumber}`);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sourceSlideNumber}번 장표 가림 편집</title><link rel="stylesheet" href="/style.css"></head>
<body class="editor-page" data-source-slide-number="${sourceSlideNumber}">
<header class="editor-header"><div><p class="privacy">로컬 확인 전용 · 업로드 안 함</p><h1>${sourceSlideNumber}번 장표 가림 편집</h1></div><a class="back-link" href="/">선정표로 돌아가기</a></header>
<p id="editor-status" class="editor-status" role="status" aria-live="polite">편집 기록을 불러오는 중입니다…</p>
<main class="editor-layout">
  <section class="viewer-panel" aria-label="고해상도 원본 편집 화면">
    <div class="viewer-toolbar"><strong id="slide-label">원본 ${sourceSlideNumber}번</strong><button id="fit-image" type="button">화면 맞춤</button><label for="zoom">확대</label><input id="zoom" type="range" min="10" max="400" step="1" value="100"><output id="zoom-label" for="zoom">확대 100% · 실제크기</output></div>
    <div class="image-scroller"><div id="image-stage" class="image-stage"><img id="source-image" src="${escapeHtml(highresUrl)}" alt="${sourceSlideNumber}번 원본 장표"><div id="redaction-overlay" class="redaction-overlay" aria-label="가림 영역 편집판"></div></div></div>
    <div class="compare-controls" aria-label="적용 전후 비교"><strong>비교</strong><label><input id="compare-before" type="radio" name="compare" value="before" checked> 적용 전</label><label><input id="compare-after" type="radio" name="compare" value="after" disabled> 적용 후</label></div>
    <p class="viewer-warning">장표 번호와 확대율을 확인하며 작은 글씨·QR·사진 속 정보까지 직접 살펴보세요. 목업의 기울어진 좌표가 아닌 원본 좌표에 가림을 지정합니다.</p>
  </section>
  <aside class="editor-sidebar">
    <section class="editor-section"><h2>1. 가림 영역</h2><div class="button-row"><label for="mask-mode">새 영역 방식</label><select id="mask-mode"><option value="opaque">불투명 가림</option><option value="blur">강한 흐림</option></select><button id="add-region" type="button" aria-pressed="false">사각형 영역 추가</button></div><div class="button-row"><button id="undo" type="button" disabled>실행 취소</button><button id="redo" type="button" disabled>다시 실행</button></div><ol id="region-list" class="editor-list"></ol></section>
    <section class="editor-section"><h2>2. 자동 확인 후보</h2><p class="section-help">후보마다 가림을 적용하거나, 공개를 허용한 사람·대상·사유를 남겨야 합니다. 필수 후보는 불투명 가림만 허용됩니다.</p><ul id="redaction-warnings" class="redaction-warnings" hidden></ul><ol id="candidate-list" class="editor-list"></ol></section>
    <section class="editor-section"><h2>3. 원본 수동 확인</h2><label class="field"><span>검토자</span><input id="reviewer" type="text" maxlength="100" autocomplete="name"></label><label class="check"><input id="original-inspected" type="checkbox"> 자동 탐지되지 않은 이름·숫자·QR·사진 속 정보까지 고해상도 원본에서 확대 확인함</label><label class="check"><input type="checkbox" data-manual-check> 작은 이름·숫자·QR·사진 속 글자를 확인함</label><label class="check"><input type="checkbox" data-manual-check> 제목·도형까지 불필요하게 가리지 않았는지 확인함</label><label class="check"><input type="checkbox" data-manual-check> 넓은 가림 뒤에도 디자인을 보여 줄 수 있는지 확인함</label><fieldset class="layout-choice"><legend>이 장표를 계속 사용합니까?</legend><label><input type="radio" name="layout-decision" value="keep"> 가림 후에도 사용 가능</label><label><input type="radio" name="layout-decision" value="replace"> 디자인 훼손·부적합으로 교체 필요</label></fieldset><p id="replacement-notice" class="replacement-notice" hidden>교체 필요로 저장하면 이 장표는 블러본 승인 대신 후보표의 예비 장표로 교체해야 합니다.</p><button id="save-redaction" class="primary-action" type="button">가림·검토 기록 저장</button></section>
    <section class="editor-section"><h2>4. 블러본 확인·승인</h2><p class="section-help">저장 후 블러본 만들기를 직접 누르세요. 자동 생성·자동 승인은 하지 않습니다.</p><button id="render-redaction" type="button" disabled>저장 내용으로 블러본 만들기</button><label class="check"><input id="output-inspected" type="checkbox"> 적용 후 화면을 확대해 다시 확인함</label><button id="approve-redaction" class="primary-action" type="button" disabled>확인한 블러본 승인</button></section>
  </aside>
</main>
<dialog id="exception-dialog" class="exception-dialog"><h2>공개 예외 기록</h2><p>대상: <strong id="exception-target"></strong></p><label class="field"><span>공개를 허용한 사람</span><input id="exception-actor" type="text" maxlength="100"></label><label class="field"><span>구체적인 공개 사유</span><textarea id="exception-reason" maxlength="500" rows="5"></textarea></label><p class="section-help">예외를 저장하면 이 대상의 가림 영역은 제거되며, 사람과 사유가 기록됩니다.</p><div class="button-row"><button id="exception-cancel" type="button">취소</button><button id="exception-save" class="primary-action" type="button">예외 기록</button></div></dialog>
<script type="module" src="/redaction-editor-client.mjs"></script></body></html>`;
}

function renderMockupHtml(productionBridge = false, preparationReview = false) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>로컬 목업 배정·미리보기</title><link rel="stylesheet" href="/style.css"></head>
<body class="mockup-page">
<header class="mockup-header"><div><p class="privacy">${productionBridge ? "로컬 편집 · 명시적으로 보낸 후보만 관리자 검토 대기 · 자동 활성화 안 함" : "로컬 확인 전용 · 업로드·활성화 안 함"}</p><h1>목업 배정·미리보기</h1><p>승인된 5개 템플릿의 좌표·각도·로고는 이 화면에서 바뀌지 않습니다.</p></div><div class="top-actions">${preparationReview ? '<a class="back-link" href="/preparation">규격·추상 그래픽 직접 검수</a>' : ''}<a class="back-link" href="/">장표 선정표로 돌아가기</a></div></header>
<p id="mockup-status" class="editor-status" role="status" aria-live="polite">로컬 목업 기록을 불러오는 중입니다…</p>
<section class="mockup-controls" aria-label="목업 작업 설정">
  <label class="field title-field"><span>승인할 작업물명</span><input id="mockup-title" type="text" maxlength="200" autocomplete="off" placeholder="문서 내용을 확인한 정확한 작업물명"></label>
  <label class="check title-confirm"><input id="mockup-title-confirmed" type="checkbox"> 업체명만 보고 추측하지 않고 이 작업물명을 직접 확인함</label>
  <p id="minimum-slides" class="minimum-note"></p>
  <div class="mockup-actions"><button id="initialize-mockups" class="primary-action" type="button" disabled>배정 만들기</button><button id="save-assignments" type="button" hidden disabled>배정표 저장</button><button id="render-draft" type="button" disabled>초안 만들기 · 0.5배</button><button id="render-final" class="primary-action" type="button" disabled>최종본 만들기 · 1배</button><label class="debug-toggle"><input id="show-debug" type="checkbox"> 검사용 슬롯·원본 번호·기준선 보기</label></div>
  <p class="local-only-note">버튼을 누른 작업만 PC 내부에 기록됩니다. 새 장표 준비 요청은 아직 자동 처리와 연결되지 않았으며 기록만 남기고 워커 실행·외부 전송은 하지 않습니다.</p>
</section>
<section class="thumbnail-title-editor" aria-labelledby="thumbnail-title-heading">
  <div class="panel-heading"><div><h2 id="thumbnail-title-heading">썸네일 제목만 편집</h2><p class="section-help">메인 제목은 크게, 브랜드명은 작게 표시합니다. 입력만으로 저장·제작되지 않습니다.</p></div><span class="template-lock">내지·장표 배정 유지</span></div>
  <p class="local-only-note">${productionBridge ? "제목 편집·로컬 확정만으로는 운영에 반영되지 않습니다. 아래 별도 전송 버튼과 관리자 최종 승인 전까지 기존 완성본·본문·FAQ·게시글 제목·발행 정보는 유지됩니다." : "로컬 확인 전용입니다. 기존 5개 완성본·본문·FAQ·게시글 제목·발행 정보는 변경하지 않고, 발행·업로드와 연결하지 않습니다."}</p>
  <p id="thumbnail-title-status" class="editor-status" role="status" aria-live="polite">제목 편집 상태를 불러오는 중입니다…</p>
  <div class="thumbnail-title-fields">
    <label class="field"><span>메인 제목 · 작업물 종류</span><input id="thumbnail-main-title" type="text" maxlength="40" autocomplete="off" placeholder="예: 행사 대행 제안서" disabled><small>한 줄로 읽히는 짧은 제목을 입력해 주세요. 너무 길면 제작 전에 알려드립니다.</small></label>
    <label class="field"><span>보조 제목 · 브랜드명(선택)</span><input id="thumbnail-sub-title" type="text" maxlength="60" autocomplete="off" placeholder="예: 광양시민의 날" disabled><small>작게 표시할 문구입니다. 숨기면 썸네일에 노출되지 않습니다.</small></label>
    <label class="check"><input id="thumbnail-show-sub" type="checkbox" disabled> 보조 제목 표시</label>
  </div>
  <div class="mockup-actions thumbnail-title-actions"><button id="save-thumbnail-title" type="button" disabled>제목 저장</button><button id="preview-thumbnail-title" type="button" disabled>제목 초안 미리보기</button><button id="render-thumbnail-title" type="button" disabled>제목 최종본 만들기</button><button id="refresh-thumbnail-title" type="button" disabled>최신 상태 다시 확인</button></div>
  <div class="thumbnail-title-previews"><article><h3>수정 중인 제목 후보</h3><div id="thumbnail-title-candidate" class="thumbnail-title-frame"></div></article><article><h3>이전에 로컬 확정한 썸네일</h3><div id="thumbnail-title-active" class="thumbnail-title-frame"></div></article></div>
  <div class="thumbnail-title-confirm"><label class="check"><input id="thumbnail-title-inspected" type="checkbox" disabled> 현재 제목 최종본을 열어 잘림·오탈자·브랜드 노출을 확인함</label><button id="confirm-thumbnail-title" class="primary-action" type="button" disabled>이 제목으로 로컬 확정</button></div>
  <p class="section-help">확정 전에는 이전 확정본이 유지됩니다. 아래의 기존 5개 목업은 제목 편집과 별도로 보존됩니다.</p>
</section>
${productionBridge ? `<section id="production-bridge" class="thumbnail-title-editor" aria-labelledby="production-bridge-heading">
<h2 id="production-bridge-heading">관리자 최종 검토용 후보</h2>
<p class="section-help">현재 승인된 가림·슬롯·제목으로 완성한 5장을 확인한 뒤에만 보냅니다. 이 전송은 발행이나 운영 이미지 교체가 아닙니다. 관리자 화면에서 별도 최종 승인이 필요합니다.</p>
<div class="mockup-actions"><button id="production-preview" type="button">보낼 최종 5장 확인</button></div>
<p id="production-status" role="status" aria-live="polite">자동으로 전송하지 않습니다. 최종 5장 확인 버튼을 눌러 주세요.</p>
<div id="production-images" class="mockup-boards"></div>
<label class="check"><input id="production-inspected" type="checkbox" disabled> 표시된 최종 5장을 열어 제목·가림·슬롯을 확인했으며 관리자 최종 검토용으로 보냄</label>
<button id="production-stage" class="primary-action" type="button" disabled>관리자에 최종 검토용 보내기</button>
</section>` : ""}
<main class="mockup-workspace">
  <section class="candidate-panel"><h2>사용 가능한 장표</h2><p class="section-help">가림 승인이 끝난 블러본만 슬롯에 넣을 수 있습니다.</p><div id="mockup-candidates" class="mockup-candidates"></div></section>
  <section class="board-panel"><div class="panel-heading"><div><h2>5개 승인 목업 배정표</h2><p class="section-help">같은 목업 안에서 같은 장표를 두 번 쓰면 중복으로 막힙니다. 다른 목업에서 다시 쓰는 것은 허용됩니다.</p></div><span class="template-lock">템플릿 기하 잠금</span></div><div id="mockup-boards" class="mockup-boards"></div></section>
  <section class="request-panel"><h2>새 장표 준비 요청</h2><p class="section-help">현재 빌드의 원본 장표만 요청할 수 있으며, 이 화면에서는 실행하지 않습니다.</p><ol id="preparation-requests" class="request-list"></ol></section>
</main>
<dialog id="mockup-preview-dialog" class="mockup-preview-dialog"><div class="dialog-heading"><h2 id="mockup-preview-title">목업 크게 보기</h2><button id="mockup-preview-close" type="button">닫기</button></div><div class="mockup-preview-scroll"><img id="mockup-preview-image" alt=""></div></dialog>
<dialog id="preparation-request-dialog" class="exception-dialog"><h2>새 장표 준비 요청</h2><p>대상: <strong id="preparation-request-target"></strong></p><label class="field"><span>필요한 이유</span><textarea id="preparation-request-reason" maxlength="500" rows="5" placeholder="예: 가림 후 디자인이 무너져 대체 장표가 필요함"></textarea></label><p class="section-help">자동 처리와 아직 연결되지 않았습니다. 로컬 요청 기록만 저장하며 워커를 시작하거나 자료를 전송하지 않습니다.</p><div class="button-row"><button id="preparation-request-cancel" type="button">취소</button><button id="preparation-request-save" class="primary-action" type="button">로컬 요청 기록</button></div></dialog>
<script type="module" src="/mockup-editor-client.mjs"></script>${productionBridge ? '<script type="module" src="/production-bridge-client.mjs"></script>' : ""}</body></html>`;
}

const STYLES = `
:root{font-family:Arial,"Malgun Gothic",sans-serif;color:#202124;background:#f5f6f8}*{box-sizing:border-box}body{margin:0;padding:24px}button,input,select,textarea{font:inherit}.top,.editor-header{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;max-width:1400px;margin:auto}.top h1,.editor-header h1{margin:4px 0;font-size:28px}.top p,.editor-header p{margin:4px 0;color:#59636e}.privacy{font-weight:800;color:#e85d24!important}.step-note{max-width:360px!important;padding:10px 13px;border-radius:10px;background:#fff;border:1px solid #dfe3e8}.summary{max-width:1400px;margin:18px auto;display:flex;gap:8px;flex-wrap:wrap}.summary b{background:#fff;border:1px solid #dfe3e8;border-radius:999px;padding:8px 12px}.notices{max-width:1400px;margin:0 auto 16px;padding:12px 28px;background:#fff7e8;border:1px solid #f1cf90;border-radius:12px}.gallery{max-width:1400px;margin:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(245px,1fr));gap:14px}.card{background:#fff;border:1px solid #dfe3e8;border-top:5px solid #9aa0a6;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px #28334212}.status-selected{border-top-color:#11a36a}.status-reserve{border-top-color:#4274e8}.status-excluded{border-top-color:#d65555}.card-head{display:flex;justify-content:space-between;padding:10px 12px}.card-head span{font-weight:800}.card img,.image-missing{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#edf0f3}.image-missing{display:grid;place-items:center;color:#7a838d}.card h2{font-size:15px;line-height:1.4;margin:12px}.reasons{font-size:13px;line-height:1.45;margin:0 12px 12px;padding-left:18px}.muted,.font-warning,.asset-state{font-size:12px;margin:8px 12px}.muted,.asset-state{color:#727b84}.font-warning{color:#b4462c;font-weight:700}.edit-link,.back-link{display:inline-block;margin:0 12px 14px;padding:9px 12px;border-radius:8px;background:#202124;color:#fff;text-decoration:none;font-weight:800}.back-link{margin:0}.empty,footer{max-width:1400px;margin:24px auto;color:#68717a}footer{font-size:12px}
.editor-page{padding:18px}.editor-status{position:sticky;top:0;z-index:20;max-width:1600px;margin:14px auto;padding:10px 14px;border:1px solid #cfd5dc;border-radius:10px;background:#fff}.editor-status[data-kind="error"]{background:#fff0ef;border-color:#df8a82;color:#a3291e}.editor-status[data-kind="success"]{background:#ebf8f1;border-color:#82cda5;color:#12663d}.editor-status[data-kind="pending"]{background:#fff7e8;border-color:#e9c87f}.editor-layout{max-width:1600px;min-width:0;margin:auto;display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:16px;align-items:start}.viewer-panel,.editor-section{min-width:0;background:#fff;border:1px solid #dfe3e8;border-radius:12px;box-shadow:0 3px 12px #2833420d}.viewer-panel{overflow:hidden}.viewer-toolbar{position:relative;z-index:12;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-bottom:1px solid #dfe3e8;flex-wrap:wrap}.viewer-toolbar strong{margin-right:auto}.viewer-toolbar button{border:1px solid #cbd1d8;border-radius:7px;padding:6px 9px;background:#fff;color:#202124;font-weight:700}.viewer-toolbar output{min-width:160px;font-weight:800}.image-scroller{overflow:auto;max-height:calc(100vh - 190px);padding:20px;background:#cfd4da}.image-stage{position:relative;width:100%;min-width:0;margin:auto;background:#fff;box-shadow:0 12px 32px #20212445}.image-stage img{display:block;width:100%;height:auto}.redaction-overlay{position:absolute;inset:0;touch-action:none;cursor:crosshair}.redaction-overlay[hidden]{display:none}.candidate-box,.region-box{position:absolute}.candidate-box{border:2px dashed #e34040;background:#e340401a;pointer-events:none}.region-box{border:2px solid #1c63d5;background:#1c63d526;cursor:move}.region-box.mode-opaque{border-color:#202124;background:#20212442}.region-box-label{position:absolute;left:0;top:0;transform:translateY(-100%);padding:2px 5px;background:#202124;color:#fff;font-size:11px}.resize-handle{position:absolute;right:-7px;bottom:-7px;width:15px;height:15px;border:2px solid #fff;background:#1c63d5;cursor:nwse-resize}.compare-controls{display:flex;gap:14px;align-items:center;padding:12px 16px;border-top:1px solid #dfe3e8;flex-wrap:wrap}.viewer-warning{margin:0;padding:0 16px 16px;color:#67511a;font-size:13px;line-height:1.5}.editor-sidebar{min-width:0;display:grid;gap:12px}.editor-section{padding:14px;overflow-wrap:anywhere}.editor-section h2{margin:0 0 10px;font-size:17px}.section-help,.empty-list{color:#66717d;font-size:13px;line-height:1.45}.redaction-warnings{margin:8px 0;padding:9px 9px 9px 28px;border-radius:8px;background:#fff0ef;color:#a3291e;font-size:13px;line-height:1.45;overflow-wrap:anywhere}.button-row,.row-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:8px 0}.button-row button,.button-row select,.editor-section>button,.small-button{max-width:100%;border:1px solid #cbd1d8;border-radius:8px;padding:8px 10px;background:#fff;color:#202124;font-weight:700;white-space:normal}.button-row button:disabled,.editor-section>button:disabled{color:#949ba3;background:#eef0f2}.primary-action,.small-button.primary{background:#202124!important;color:#fff!important;border-color:#202124!important}.small-button.danger{color:#a3291e;border-color:#d79a95}.editor-list{min-width:0;display:grid;gap:8px;margin:10px 0 0;padding:0;list-style:none}.candidate-row,.region-row{min-width:0;padding:10px;border:1px solid #e0e4e8;border-radius:8px}.candidate-heading{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.candidate-heading .required,.candidate-heading .optional{font-size:11px;padding:2px 5px;border-radius:5px}.candidate-heading .required{background:#ffe2df;color:#a3291e}.candidate-heading .optional{background:#e8effc;color:#2754a2}.candidate-reason{margin:6px 0;font-size:12px;line-height:1.4;overflow-wrap:anywhere}.resolved-label{color:#11643b;font-size:12px;font-weight:800}.unresolved-label{color:#a3291e;font-size:12px;font-weight:800}.region-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.region-name{flex:1;min-width:100px;font-size:13px;font-weight:700}.region-mode{max-width:100%;padding:6px}.field{display:grid;min-width:0;gap:5px;margin:9px 0;font-size:13px;font-weight:700}.field input,.field textarea{min-width:0;width:100%;padding:8px;border:1px solid #bdc5ce;border-radius:7px}.check,.layout-choice label{display:block;margin:9px 0;font-size:13px;line-height:1.4}.layout-choice{min-width:0;margin:12px 0;border:1px solid #d8dde3;border-radius:8px}.layout-choice legend{max-width:100%;font-size:13px;font-weight:800}.replacement-notice{padding:9px;border-radius:8px;background:#fff0ef;color:#a3291e;font-size:13px;line-height:1.4}.exception-dialog{width:min(520px,calc(100vw - 32px));border:0;border-radius:12px;box-shadow:0 20px 60px #0006}.exception-dialog::backdrop{background:#0007}.exception-dialog h2{margin-top:0}
.top-actions{display:grid;justify-items:end;gap:8px}.mockup-link{display:inline-block;padding:9px 12px;border-radius:8px;background:#e85d24;color:#fff;text-decoration:none;font-weight:800}.mockup-page{padding:18px}.mockup-header{max-width:1600px;margin:auto;display:flex;gap:20px;align-items:flex-start;justify-content:space-between}.mockup-header h1{margin:4px 0;font-size:28px}.mockup-header p{margin:4px 0;color:#59636e}.mockup-controls,.candidate-panel,.board-panel,.request-panel{max-width:1600px;min-width:0;margin:14px auto;padding:16px;background:#fff;border:1px solid #dfe3e8;border-radius:12px;box-shadow:0 3px 12px #2833420d}.mockup-controls{display:grid;grid-template-columns:minmax(240px,1fr) minmax(260px,1fr);gap:8px 18px;align-items:end}.title-field{margin:0}.title-confirm{margin:0}.minimum-note,.local-only-note{margin:2px 0;color:#66717d;font-size:13px}.mockup-actions{grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mockup-actions button{border:1px solid #cbd1d8;border-radius:8px;padding:9px 12px;background:#fff;font-weight:800}.mockup-actions button:disabled{color:#949ba3;background:#eef0f2}.debug-toggle{margin-left:auto;font-size:13px}.local-only-note{grid-column:1/-1}.mockup-workspace{max-width:1600px;margin:auto}.candidate-panel h2,.board-panel h2,.request-panel h2{margin:0 0 6px;font-size:20px}.mockup-candidates{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.mockup-candidate{min-width:0;display:grid;gap:7px;padding:10px;border:1px solid #dfe3e8;border-radius:9px;overflow-wrap:anywhere}.mockup-candidate img,.candidate-placeholder{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#edf0f3;border-radius:6px}.candidate-placeholder{display:grid;place-items:center;padding:10px;text-align:center;color:#727b84;font-size:12px}.candidate-title{font-size:13px}.candidate-status{font-size:12px;font-weight:800;color:#11643b}.candidate-needs_redaction .candidate-status,.candidate-needs_preparation .candidate-status{color:#a3291e}.candidate-note{margin:0;color:#66717d;font-size:12px}.panel-heading,.mockup-board-head,.dialog-heading{display:flex;gap:12px;align-items:center;justify-content:space-between}.template-lock{padding:4px 7px;border-radius:6px;background:#eef0f2;color:#59636e;font-size:11px;font-weight:800}.mockup-boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.mockup-board{min-width:0;padding:12px;border:1px solid #dfe3e8;border-radius:10px;background:#fafbfc}.mockup-board.board-blocked{border-color:#d65555;background:#fff8f7}.mockup-board-head h2{margin:0;font-size:16px}.mockup-board-image{position:relative;margin:10px 0;background:#e9edf1;border-radius:8px;overflow:hidden}.mockup-board-image img,.mockup-placeholder{display:block;width:100%;aspect-ratio:16/10;object-fit:contain}.mockup-placeholder{display:grid;place-items:center;color:#727b84}.image-enlarge{position:absolute;right:8px;bottom:8px;border:0;border-radius:7px;padding:7px 9px;background:#202124;color:#fff;font-weight:800}.board-image-actions{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:7px 0;font-size:12px}.image-kind{color:#66717d;font-weight:800}.download-link{color:#1c5fc4;font-weight:800}.mockup-slots{display:grid;gap:7px}.mockup-slot{min-width:0;display:grid;grid-template-columns:minmax(105px,.7fr) minmax(0,1.3fr);gap:7px;align-items:center}.mockup-slot select{min-width:0;width:100%;padding:7px;border:1px solid #bdc5ce;border-radius:7px}.slot-label{font-size:12px;font-weight:800;overflow-wrap:anywhere}.duplicate-slot select{border-color:#d65555;background:#fff0ef}.duplicate-label{grid-column:1/-1;color:#a3291e;font-size:11px}.board-hold{margin:8px 0 0;padding:7px;border-radius:6px;background:#fff0ef;color:#a3291e;font-size:12px;overflow-wrap:anywhere}.request-list{display:grid;gap:7px;margin:0;padding-left:20px}.request-list li{padding:6px}.request-list span{display:block;margin-top:3px;color:#66717d;font-size:12px}.mockup-preview-dialog{width:min(1500px,calc(100vw - 24px));height:min(94vh,1000px);padding:14px;border:0;border-radius:12px;box-shadow:0 20px 70px #0007}.mockup-preview-dialog::backdrop{background:#0009}.dialog-heading h2{margin:0;font-size:18px}.dialog-heading button{border:1px solid #cbd1d8;border-radius:7px;padding:7px 10px;background:#fff}.mockup-preview-scroll{height:calc(100% - 45px);margin-top:10px;overflow:auto;background:#cfd4da}.mockup-preview-scroll img{display:block;max-width:none;margin:auto}
.thumbnail-title-editor{max-width:1600px;margin:14px auto;padding:18px;background:#fff;border:1px solid #e8c8b8;border-radius:12px;box-shadow:0 3px 12px #2833420d}.thumbnail-title-editor h2{margin:0 0 6px;font-size:20px}.thumbnail-title-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px}.thumbnail-title-fields .field{min-width:0;margin:0}.thumbnail-title-fields small{font-size:12px;color:#66717d}.thumbnail-title-fields>.check{grid-column:1/-1}.thumbnail-title-actions{margin:12px 0}.thumbnail-title-previews{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.thumbnail-title-previews article{min-width:0}.thumbnail-title-previews h3{margin:6px 0;font-size:15px}.thumbnail-title-frame{min-height:170px;padding:12px;background:#f3f4f6;border:1px solid #dfe3e8;border-radius:10px;display:flex;flex-direction:column;align-items:center;gap:8px}.thumbnail-title-frame img{display:block;width:min(100%,360px);height:auto;aspect-ratio:1;object-fit:contain}.thumbnail-title-frame p{color:#66717d;font-size:13px;margin:8px 0;text-align:center}.thumbnail-title-frame button{padding:7px 10px;border:1px solid #cbd1d8;border-radius:7px;background:#fff}.thumbnail-title-confirm{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:14px 0}.thumbnail-title-confirm button{padding:10px 14px;border:1px solid #d95018;border-radius:8px;font-weight:800}.thumbnail-title-confirm button:disabled{background:#eef0f2;color:#949ba3;border-color:#cbd1d8}
@media(max-width:1050px){.editor-layout{grid-template-columns:minmax(0,1fr)}.image-scroller{max-height:70vh}.editor-sidebar{grid-template-columns:repeat(2,minmax(0,1fr))}.mockup-controls{grid-template-columns:minmax(0,1fr)}}@media(max-width:680px){body,.editor-page,.mockup-page{padding:10px}.top,.editor-header,.mockup-header{display:block}.top-actions{justify-items:start}.step-note{margin-top:12px!important}.editor-sidebar{grid-template-columns:minmax(0,1fr)}.image-scroller{padding:8px}.debug-toggle{width:100%;margin-left:0}.mockup-slot{grid-template-columns:minmax(0,1fr)}.duplicate-label{grid-column:auto}.thumbnail-title-fields,.thumbnail-title-previews{grid-template-columns:minmax(0,1fr)}.thumbnail-title-editor .panel-heading{align-items:flex-start}.thumbnail-title-confirm{display:grid}}
`;

function securityHeaders(contentType: string) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": contentType,
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'self'; connect-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; worker-src 'none'; media-src 'none'; manifest-src 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function send(response: ServerResponse, status: number, contentType: string, body: string | Buffer, extra = {}) {
  const length = Buffer.isBuffer(body) ? body.byteLength : Buffer.byteLength(body);
  response.writeHead(status, {
    ...securityHeaders(contentType),
    "Content-Length": String(length),
    ...extra,
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown, extra = {}) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(value), extra);
}

function exactHeader(request: IncomingMessage, headerName: string) {
  const lower = headerName.toLowerCase();
  const values = request.rawHeaders.flatMap((value, index, headers) => (
    index % 2 === 0 && value.toLowerCase() === lower ? [headers[index + 1] ?? ""] : []
  ));
  return values.length === 1 ? values[0] : null;
}

function assertOnlyKeys(value: JsonRecord, keys: readonly string[]) {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("INVALID_BODY", "요청에 허용되지 않은 항목이 있습니다.");
}

function boundedText(value: unknown, maximum: number, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum
    || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
    || (!allowEmpty && !value.trim())) {
    fail("INVALID_BODY", "입력한 글자 항목이 올바르지 않습니다.");
  }
  return value;
}

function bodyRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail("INVALID_BODY", "수정 버전이 올바르지 않습니다.");
  return Number(value);
}

function bodyRect(value: unknown): RedactionRect {
  if (!isRecord(value)) fail("INVALID_BODY", "가림 좌표가 올바르지 않습니다.");
  assertOnlyKeys(value, ["x", "y", "width", "height"]);
  const numbers = [value.x, value.y, value.width, value.height];
  if (!numbers.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    || Number(value.x) < 0 || Number(value.y) < 0 || Number(value.width) <= 0 || Number(value.height) <= 0
    || Number(value.x) + Number(value.width) > 1.0000001
    || Number(value.y) + Number(value.height) > 1.0000001) {
    fail("INVALID_BODY", "가림 좌표가 이미지 범위를 벗어났습니다.");
  }
  return { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) };
}

function bodyRegions(value: unknown): RedactionRegion[] {
  if (!Array.isArray(value) || value.length > 500) fail("INVALID_BODY", "가림 영역 수가 올바르지 않습니다.");
  return value.map((entry) => {
    if (!isRecord(entry)) fail("INVALID_BODY", "가림 영역 형식이 올바르지 않습니다.");
    assertOnlyKeys(entry, ["id", "candidateId", "rect", "mode"]);
    const id = boundedText(entry.id, 100);
    const candidateId = entry.candidateId === undefined ? undefined : boundedText(entry.candidateId, 100);
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(id)
      || (candidateId !== undefined && !/^[a-zA-Z0-9:_-]{1,100}$/.test(candidateId))
      || (entry.mode !== "opaque" && entry.mode !== "blur")) {
      fail("INVALID_BODY", "가림 영역 식별자나 방식이 올바르지 않습니다.");
    }
    return { id, ...(candidateId ? { candidateId } : {}), rect: bodyRect(entry.rect), mode: entry.mode };
  });
}

function bodyExceptions(value: unknown): RedactionException[] {
  if (!Array.isArray(value) || value.length > 500) fail("INVALID_BODY", "공개 예외 수가 올바르지 않습니다.");
  return value.map((entry) => {
    if (!isRecord(entry)) fail("INVALID_BODY", "공개 예외 형식이 올바르지 않습니다.");
    assertOnlyKeys(entry, ["candidateId", "actor", "reason"]);
    const candidateId = boundedText(entry.candidateId, 100);
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(candidateId)) fail("INVALID_BODY", "공개 예외 대상이 올바르지 않습니다.");
    return {
      candidateId,
      actor: boundedText(entry.actor, 100),
      reason: boundedText(entry.reason, 500),
    };
  });
}

function bodyReview(value: unknown): RedactionReview {
  if (!isRecord(value)) fail("INVALID_BODY", "원본 검토 기록이 올바르지 않습니다.");
  assertOnlyKeys(value, ["reviewer", "originalInspected", "layoutAcceptable"]);
  if (typeof value.originalInspected !== "boolean" || typeof value.layoutAcceptable !== "boolean") {
    fail("INVALID_BODY", "원본 검토 선택이 올바르지 않습니다.");
  }
  return {
    reviewer: boundedText(value.reviewer, 100, true),
    originalInspected: value.originalInspected,
    layoutAcceptable: value.layoutAcceptable,
  };
}

async function readPostJson(request: IncomingMessage) {
  const contentType = exactHeader(request, "content-type");
  if (contentType?.toLowerCase() !== "application/json") fail("INVALID_BODY", "JSON 요청만 허용됩니다.");
  const declaredLength = exactHeader(request, "content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_POST_BYTES)) {
    fail("BODY_TOO_LARGE", "편집 요청이 허용된 크기를 넘었습니다.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_POST_BYTES) fail("BODY_TOO_LARGE", "편집 요청이 허용된 크기를 넘었습니다.");
    chunks.push(buffer);
  }
  if (!total) fail("INVALID_BODY", "편집 요청 내용이 없습니다.");
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!isRecord(parsed)) fail("INVALID_BODY", "편집 요청 JSON이 올바르지 않습니다.");
    return parsed;
  } catch (error) {
    if (error instanceof LocalReviewServerError) throw error;
    fail("INVALID_BODY", "편집 요청 JSON이 올바르지 않습니다.");
  }
}

function bodyMockupTitle(value: unknown) {
  return boundedText(value, 200).trim();
}

function bodyMockupBoards(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) fail("INVALID_BODY", "목업 배정표 수가 올바르지 않습니다.");
  return value.map((board) => {
    if (!isRecord(board)) fail("INVALID_BODY", "목업 배정표 형식이 올바르지 않습니다.");
    assertOnlyKeys(board, ["templateId", "slots"]);
    const templateId = boundedText(board.templateId, 100);
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(templateId) || !Array.isArray(board.slots) || board.slots.length > 50) {
      fail("INVALID_BODY", "목업 템플릿 또는 슬롯 목록이 올바르지 않습니다.");
    }
    return {
      templateId,
      slots: board.slots.map((slot) => {
        if (!isRecord(slot)) fail("INVALID_BODY", "목업 슬롯 형식이 올바르지 않습니다.");
        assertOnlyKeys(slot, ["slotId", "sourceSlideNumber"]);
        const slotId = boundedText(slot.slotId, 100);
        const sourceSlideNumber = slot.sourceSlideNumber;
        if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(slotId)
          || (sourceSlideNumber !== null && (!Number.isSafeInteger(sourceSlideNumber) || Number(sourceSlideNumber) < 1))) {
          fail("INVALID_BODY", "목업 슬롯의 장표 번호가 올바르지 않습니다.");
        }
        return { slotId, sourceSlideNumber: sourceSlideNumber === null ? null : Number(sourceSlideNumber) };
      }),
    };
  });
}

function bodyMockupTemplateIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail("INVALID_BODY", "목업 템플릿 목록이 올바르지 않습니다.");
  const templateIds = value.map((entry) => boundedText(entry, 100));
  if (new Set(templateIds).size !== templateIds.length
    || templateIds.some((entry) => !/^[a-z0-9][a-z0-9-]{0,99}$/.test(entry))) {
    fail("INVALID_BODY", "목업 템플릿 목록이 올바르지 않습니다.");
  }
  return templateIds;
}

function publicMockupReview(review: LocalMockupReview) {
  const holdText = (hold: string) => {
    if (hold === "MOCKUP_NOT_INITIALIZED") return "아직 배정표를 만들지 않았습니다.";
    if (hold.startsWith("EMPTY_SLOT:")) return "비어 있는 슬롯이 있습니다.";
    if (hold.startsWith("SLIDE_NOT_APPROVED:")) return "가림 승인이 끝나지 않은 장표가 배정돼 있습니다.";
    if (hold.startsWith("REDACTION_CHANGED:")) return "배정 후 가림본이 바뀌어 다시 저장해야 합니다.";
    if (hold.startsWith("DUPLICATE_SLIDE:") || hold.startsWith("DUPLICATE_IMAGE:")) return "같은 목업 안에 중복 장표가 있습니다.";
    return "목업 제작 전에 확인할 항목이 있습니다.";
  };
  const image = (record: LocalMockupReview["boards"][number]["draft"]) => record ? {
    sha256: record.sha256,
    width: record.width,
    height: record.height,
    createdAt: safeString(record.createdAt, 100),
  } : null;
  return {
    aspectClass: safeString(review.aspectClass, 30),
    minimum: review.minimum,
    ...(review.sourceFitNotice ? { sourceFitNotice: safeString(review.sourceFitNotice, 300) } : {}),
    revision: review.revision,
    title: safeString(review.title, 200),
    state: review.state,
    candidates: review.candidates.map((candidate) => ({
      sourceSlideNumber: candidate.sourceSlideNumber,
      title: safeString(candidate.title, 160),
      status: candidate.status,
      ...(candidate.imageHash && SHA256_PATTERN.test(candidate.imageHash) ? { imageHash: candidate.imageHash } : {}),
      ...(candidate.reason ? {
        reason: candidate.status === "needs_redaction"
          ? "가림본을 확인하고 승인해야 합니다."
          : "고해상도 장표를 준비해야 합니다.",
      } : {}),
    })),
    boards: review.boards.map((board) => ({
      templateId: board.templateId,
      label: safeString(board.label, 100),
      slots: board.slots.map((slot) => ({
        slotId: slot.slotId,
        position: slot.position,
        role: slot.role === "hero" ? "중앙·대표" : "보조",
        sourceSlideNumber: slot.sourceSlideNumber,
      })),
      holds: [...new Set(board.holds.map(holdText))],
      draft: image(board.draft),
      final: image(board.final),
    })),
    requests: review.requests.map((request) => ({
      sourceSlideNumber: request.sourceSlideNumber,
      reason: safeString(request.reason, 500),
      createdAt: safeString(request.createdAt, 100),
      status: request.status,
    })),
    visualReview: review.visualReview,
    activeSetUnchanged: review.activeSetUnchanged,
  };
}

function publicMockupTitleReview(review: Awaited<ReturnType<typeof getLocalMockupTitleReview>>) {
  const title = (value: typeof review.title) => ({
    main: safeString(value.main, 40),
    sub: safeString(value.sub, 60),
    showSub: value.showSub === true,
    style: "bold" as const,
  });
  const image = (value: typeof review.draft) => value && SHA256_PATTERN.test(value.sha256) ? {
    sha256: value.sha256,
    width: value.width,
    height: value.height,
    scale: value.scale,
  } : null;
  return {
    available: review.available,
    revision: review.revision,
    baseFingerprint: review.baseFingerprint,
    legacyTitle: safeString(review.legacyTitle, 200),
    title: title(review.title),
    stale: review.stale,
    holds: review.holds.map(() => "현재 장표 배정·가림 승인 또는 이전 제작 상태를 확인해야 합니다."),
    draft: image(review.draft),
    final: image(review.final),
    active: image(review.active),
    activeTitle: review.activeTitle ? title(review.activeTitle) : null,
    legacyFinalAvailable: review.legacyFinalAvailable,
    localOnly: true,
  };
}

function publicRedactionState(state: RedactionState) {
  const blocksRendering = (warning: string) => /TRUNCATED|INCOMPLETE|UNSUPPORTED|UNRESOLVED/.test(warning);
  const warningText = (warning: string) => blocksRendering(warning)
    ? "원본의 일부 내용을/좌표를 확정하지 못했습니다. 이 장표는 보류되며 교체 또는 원본 정리 후 재변환이 필요합니다."
    : REDACTION_WARNING_LABELS[warning] ?? "자동 검사 알림이 있습니다. 고해상도 원본을 직접 확인하세요.";
  const categoryText = (category: string) => REDACTION_CATEGORY_LABELS[category] ?? "직접 확인 대상";
  const reasonText = (reason: string) => REDACTION_REASON_LABELS[reason]
    ?? "자동으로 분류하지 못한 항목입니다. 고해상도 원본에서 직접 확인해 주세요.";
  return {
    version: state.version,
    ruleVersion: safeString(state.ruleVersion, 100),
    sourceSlideNumber: state.sourceSlideNumber,
    sourceHash: state.sourceHash,
    slideContentHash: state.slideContentHash,
    imageHash: state.imageHash,
    width: state.width,
    height: state.height,
    revision: state.revision,
    renderBlocked: state.warnings.some(blocksRendering),
    uncertainties: (state.uncertainties ?? []).map((item) => ({
      id: item.id, candidateId: item.candidateId, code: item.code, rect: item.rect,
    })),
    manualResolutions: (state.manualResolutions ?? []).map((item) => ({
      uncertaintyId: item.uncertaintyId, decision: item.decision,
      actor: safeString(item.actor, 100), reason: safeString(item.reason, 500),
      inspectedAtActualSize: item.inspectedAtActualSize, reviewedRevision: item.reviewedRevision,
      sourceHash: item.sourceHash, slideContentHash: item.slideContentHash, imageHash: item.imageHash,
      uncertaintyHash: item.uncertaintyHash, editHash: item.editHash,
      ...(item.regionId ? { regionId: item.regionId } : {}),
    })),
    candidates: state.candidates.map((candidate) => ({
      id: candidate.id,
      rect: candidate.rect,
      category: categoryText(candidate.category),
      required: candidate.required,
      reason: reasonText(candidate.reason),
    })),
    warnings: [...new Set(state.warnings.map(warningText).filter(Boolean))],
    regions: state.regions.map((region) => ({
      id: region.id,
      ...(region.candidateId ? { candidateId: region.candidateId } : {}),
      rect: region.rect,
      mode: region.mode,
    })),
    exceptions: state.exceptions.map((exception) => ({
      candidateId: exception.candidateId,
      actor: safeString(exception.actor, 100),
      reason: safeString(exception.reason, 500),
    })),
    review: {
      reviewer: safeString(state.review.reviewer, 100),
      originalInspected: state.review.originalInspected,
      layoutAcceptable: state.review.layoutAcceptable,
    },
    status: state.status,
    output: state.output ? {
      sha256: state.output.sha256,
      width: state.output.width,
      height: state.output.height,
      checks: state.output.checks,
      createdAt: state.output.createdAt,
      approvedAt: state.output.approvedAt,
      approvedBy: state.output.approvedBy ? safeString(state.output.approvedBy, 100) : null,
    } : null,
  };
}

function redactionError(error: unknown) {
  const rawCode = error instanceof Error
    ? (("code" in error && typeof error.code === "string" ? error.code : error.message).split(":", 1)[0])
    : "";
  if (rawCode === "BODY_TOO_LARGE") return { status: 413, error: "편집 요청이 허용된 크기를 넘었습니다." };
  if (rawCode === "INVALID_BODY") return { status: 400, error: "편집 요청 내용이 올바르지 않습니다." };
  if (rawCode === "REDACTION_REVISION_CONFLICT") return { status: 409, error: "다른 편집 내용이 먼저 저장됐습니다. 화면을 다시 열어 확인해 주세요." };
  if (["MANUAL_REDACTION_REVIEW_STALE_OR_INVALID", "MANUAL_REDACTION_REVIEW_REVISION_CONFLICT"].includes(rawCode)) {
    return { status: 409, error: "확대 검토 이후 원본이나 가림 영역이 바뀌었습니다. 해당 항목을 다시 확인해 주세요." };
  }
  if (["INVALID_MANUAL_REDACTION_REVIEWS", "INVALID_REDACTION_UNCERTAINTY", "INVALID_REDACTION_UNCERTAINTIES"].includes(rawCode)) {
    return { status: 400, error: "애매한 영역의 검토자·사유·확대 확인 및 가림 위치 기록을 다시 확인해 주세요." };
  }
  if (rawCode === "REDACTION_NOT_INITIALIZED") return { status: 409, error: "이 장표의 가림 후보 준비가 아직 끝나지 않았습니다." };
  if (["REDACTION_BUILD_NOT_CURRENT", "REDACTION_PREPARATION_INCOMPLETE", "REDACTION_SLIDE_NOT_SELECTED",
    "REDACTION_HIGHRES_MISSING", "REDACTION_STATE_STALE", "REDACTION_STATE_CORRUPT", "REDACTION_SOURCE_CHANGED",
    "REDACTED_OUTPUT_NOT_APPROVED", "REDACTED_OUTPUT_CHANGED", "OUTPUT_REVIEW_REQUIRED"].includes(rawCode)
    || rawCode === "EDITOR_NOT_AVAILABLE" || rawCode.includes("LOCK")) {
    return { status: 409, error: "현재 장표 상태를 안전하게 편집할 수 없습니다. 선정표와 작업 상태를 다시 확인해 주세요." };
  }
  if (rawCode.startsWith("INVALID_") || rawCode.startsWith("PUBLIC_") || rawCode.startsWith("REQUIRED_")) {
    return { status: 400, error: "가림 영역 또는 공개 예외 기록을 다시 확인해 주세요." };
  }
  if (rawCode.startsWith("REDACTION_REVIEW_REQUIRED")) {
    return { status: 409, error: "미해결 가림 후보와 원본 검토 항목을 모두 확인해 주세요." };
  }
  return { status: 500, error: "로컬 가림 작업을 안전하게 처리하지 못했습니다." };
}

function mockupError(error: unknown) {
  const rawCode = error instanceof Error
    ? (("code" in error && typeof error.code === "string" ? error.code : error.message).split(":", 1)[0])
    : "";
  if (rawCode === "BODY_TOO_LARGE") return { status: 413, error: "목업 요청이 허용된 크기를 넘었습니다." };
  if (rawCode === "INVALID_BODY") return { status: 400, error: "목업 요청 내용을 다시 확인해 주세요." };
  if (rawCode === "MOCKUP_TITLE_REQUIRED") return { status: 400, error: "크게 표시할 메인 제목을 입력해 주세요." };
  if (rawCode === "MOCKUP_TITLE_TOO_WIDE") return { status: 400, error: "제목이 안전한 영역을 넘습니다. 문구를 조금 짧게 줄여 주시거나 보조 제목 표시를 꺼 주세요. 기존 완성본은 유지됩니다." };
  if (rawCode === "MOCKUP_TITLE_UNSUPPORTED_GLYPH") return { status: 400, error: "현재 글꼴로 표시할 수 없는 문자가 있습니다. 이모지·특수문자를 확인해 주세요." };
  if (["MOCKUP_TITLE_INVALID", "MOCKUP_TITLE_INVALID_CHARACTER"].includes(rawCode)) return { status: 400, error: "제목의 길이·줄바꿈·특수문자를 확인해 주세요. 메인과 보조 제목은 각각 한 줄입니다." };
  if (["MOCKUP_TITLE_REVISION_CONFLICT", "MOCKUP_TITLE_BASE_CONFLICT", "MOCKUP_TITLE_BASE_CHANGED", "MOCKUP_TITLE_STALE"].includes(rawCode)) return { status: 409, error: "다른 편집 또는 장표 변경이 먼저 저장됐습니다. 입력 문구는 유지됩니다. 최신 상태를 다시 확인해 주세요." };
  if (rawCode === "MOCKUP_TITLE_DRAFT_REQUIRED") return { status: 409, error: "현재 제목으로 초안 미리보기를 먼저 만들어 주세요." };
  if (["MOCKUP_TITLE_FINAL_REQUIRED", "MOCKUP_TITLE_CONFIRMATION_REQUIRED", "MOCKUP_TITLE_FINAL_MISMATCH"].includes(rawCode)) return { status: 409, error: "현재 제목의 최종본을 열어 확인한 뒤 로컬 확정해 주세요." };
  if (rawCode === "MOCKUP_WORK_TITLE_REQUIRED") return { status: 400, error: "문서 내용을 확인한 정확한 작업물명을 입력해 주세요." };
  if (rawCode === "MOCKUP_REVISION_CONFLICT") return { status: 409, error: "다른 배정 내용이 먼저 저장됐습니다. 화면을 다시 열어 확인해 주세요." };
  if (rawCode === "MOCKUP_ASSIGNMENT_HELD") return { status: 409, error: "비어 있거나 중복되거나 가림 승인이 끝나지 않은 슬롯이 있어 목업을 만들 수 없습니다." };
  if (rawCode === "MOCKUP_DRAFT_REQUIRED") return { status: 409, error: "같은 배정표로 저해상도 초안을 먼저 만들어 확인해 주세요." };
  if (rawCode === "MOCKUP_NOT_INITIALIZED") return { status: 409, error: "작업물명을 확인하고 배정 만들기를 먼저 눌러 주세요." };
  if (rawCode === "MOCKUP_ASPECT_UNSUPPORTED") return { status: 409, error: "이 원본 규격에 등록된 승인 목업 세트가 없습니다." };
  if (rawCode === "MOCKUP_INVALID_PREPARATION_REQUEST") return { status: 400, error: "준비할 원본 장표와 구체적인 사유를 다시 확인해 주세요." };
  if (rawCode.startsWith("MOCKUP_INVALID_")) return { status: 400, error: "목업 배정 또는 제작 요청을 다시 확인해 주세요." };
  if (rawCode.startsWith("MOCKUP_") || rawCode.includes("LOCK")) {
    return { status: 409, error: "현재 로컬 작업 상태로 목업을 안전하게 처리할 수 없습니다. 장표 선정·가림 상태를 다시 확인해 주세요." };
  }
  return { status: 500, error: "로컬 목업 작업을 안전하게 처리하지 못했습니다." };
}

function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionCookie(request: IncomingMessage, cookieName: string) {
  const values = request.rawHeaders.flatMap((value, index, headers) => (
    index % 2 === 0 && value.toLowerCase() === "cookie" ? [headers[index + 1] ?? ""] : []
  ));
  if (values.length === 0) return { present: false, value: null } as const;
  if (values.length !== 1) return { present: true, value: null } as const;
  const matches = values[0].split(";").map((part) => part.trim()).filter((part) => (
    part.startsWith(`${cookieName}=`)
  ));
  if (matches.length === 0) return { present: false, value: null } as const;
  return matches.length === 1
    ? { present: true, value: matches[0].slice(cookieName.length + 1) } as const
    : { present: true, value: null } as const;
}

function exactHost(request: IncomingMessage, expectedHost: string) {
  const hosts = request.rawHeaders.flatMap((value, index, headers) => (
    index % 2 === 0 && value.toLowerCase() === "host" ? [headers[index + 1] ?? ""] : []
  ));
  return hosts.length === 1 && hosts[0] === expectedHost;
}

function isDirectNavigation(request: IncomingMessage) {
  return request.headers["sec-fetch-site"] === "none"
    && request.headers["sec-fetch-mode"] === "navigate";
}

function isSameOriginFetch(request: IncomingMessage) {
  return request.headers["sec-fetch-site"] === "same-origin";
}

async function readVerifiedPng(root: string, buildId: string, artifact: LedgerArtifact) {
  const artifactRootRelative = `builds/${buildId}/artifacts`;
  const artifactRoot = path.join(root, ...artifactRootRelative.split("/"));
  await assertNoLinks(root, artifactRootRelative, false);
  const candidate = await assertNoLinks(artifactRoot, artifact.relativePath, true);
  if (!isInside(artifactRoot, candidate)) fail("UNSAFE_PATH", "검토 이미지가 제작 폴더를 벗어났습니다.");
  const handle = await open(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1 || info.size !== artifact.bytes || info.size > MAX_IMAGE_BYTES) {
      fail("STALE_ARTIFACT", "검토 이미지의 크기가 완료 기록과 다릅니다.");
    }
    const buffer = await handle.readFile();
    if (buffer.length !== artifact.bytes
      || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      || createHash("sha256").update(buffer).digest("hex") !== artifact.sha256) {
      fail("STALE_ARTIFACT", "검토 이미지의 지문이 완료 기록과 다릅니다.");
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

function editableSlide(snapshot: LedgerSnapshot, sourceSlideNumber: number) {
  const slide = buildReviewModel(snapshot).slides.find((entry) => entry.sourceSlideNumber === sourceSlideNumber);
  return slide && (slide.status === "selected" || slide.status === "reserve") && slide.highresUrl
    ? slide
    : null;
}

async function assertEditableSlide(root: string, buildId: string, sourceSlideNumber: number) {
  if (!editableSlide(await readLedger(root, buildId), sourceSlideNumber)) {
    fail("EDITOR_NOT_AVAILABLE", "선정·예비 장표의 등록된 고해상도 이미지에서만 편집할 수 있습니다.");
  }
}

function redactionApiRoute(pathname: string) {
  const match = /^\/api\/redaction\/([1-9]\d*)(?:\/(save|render|approve))?$/.exec(pathname);
  if (!match) return null;
  const sourceSlideNumber = Number(match[1]);
  return Number.isSafeInteger(sourceSlideNumber)
    ? { sourceSlideNumber, action: match[2] ?? "read" }
    : null;
}

function mockupApiRoute(pathname: string) {
  const match = /^\/api\/mockups(?:\/(initialize|save|render|request))?$/.exec(pathname);
  return match ? { action: match[1] ?? "read" } : null;
}

function mockupTitleApiRoute(pathname: string) {
  const match = /^\/api\/mockups\/title(?:\/(save|render|confirm))?$/.exec(pathname);
  return match ? { action: match[1] ?? "read" } : null;
}

async function handleMockupTitlePost(input: {
  request: IncomingMessage;
  root: string;
  buildId: string;
  action: string;
}) {
  const body = await readPostJson(input.request);
  const identity = { root: input.root, buildId: input.buildId };
  const expectedBaseFingerprint = boundedText(body.expectedBaseFingerprint, 64);
  if (!SHA256_PATTERN.test(expectedBaseFingerprint)) fail("INVALID_BODY", "제목 편집 기준이 올바르지 않습니다.");
  if (input.action === "save") {
    assertOnlyKeys(body, ["expectedRevision", "expectedBaseFingerprint", "title"]);
    if (!body.title || typeof body.title !== "object" || Array.isArray(body.title)) fail("INVALID_BODY", "제목 형식이 올바르지 않습니다.");
    assertOnlyKeys(body.title as Record<string, unknown>, ["main", "sub", "showSub", "style"]);
    return saveLocalMockupTitle({
      ...identity,
      expectedRevision: body.expectedRevision === null ? null : bodyRevision(body.expectedRevision),
      expectedBaseFingerprint,
      title: body.title,
    });
  }
  if (input.action === "render") {
    assertOnlyKeys(body, ["expectedRevision", "expectedBaseFingerprint", "scale"]);
    if (body.scale !== 0.5 && body.scale !== 1) fail("INVALID_BODY", "제목 제작 배율이 올바르지 않습니다.");
    return renderLocalMockupTitle({ ...identity, expectedRevision: bodyRevision(body.expectedRevision), expectedBaseFingerprint, scale: body.scale });
  }
  if (input.action === "confirm") {
    assertOnlyKeys(body, ["expectedRevision", "expectedBaseFingerprint", "expectedFinalHash", "visualConfirmed"]);
    const expectedFinalHash = boundedText(body.expectedFinalHash, 64);
    if (!SHA256_PATTERN.test(expectedFinalHash) || body.visualConfirmed !== true) fail("INVALID_BODY", "최종 제목 확인 기록이 올바르지 않습니다.");
    return confirmLocalMockupTitle({ ...identity, expectedRevision: bodyRevision(body.expectedRevision), expectedBaseFingerprint, expectedFinalHash, visualConfirmed: true });
  }
  fail("INVALID_BODY", "허용되지 않은 제목 편집 동작입니다.");
}

async function handleRedactionPost(input: {
  request: IncomingMessage;
  root: string;
  buildId: string;
  sourceSlideNumber: number;
  action: string;
}) {
  await assertEditableSlide(input.root, input.buildId, input.sourceSlideNumber);
  const body = await readPostJson(input.request);
  const identity = { root: input.root, buildId: input.buildId, sourceSlideNumber: input.sourceSlideNumber };
  if (input.action === "save") {
    assertOnlyKeys(body, ["expectedRevision", "regions", "exceptions", "review", "manualResolutions"]);
    if (body.manualResolutions !== undefined && (!Array.isArray(body.manualResolutions) || body.manualResolutions.length > 500)) {
      fail("INVALID_BODY", "수동 검토 항목의 형식이나 개수가 올바르지 않습니다.");
    }
    return saveLocalRedactionSlide({
      ...identity,
      expectedRevision: bodyRevision(body.expectedRevision),
      regions: bodyRegions(body.regions),
      exceptions: bodyExceptions(body.exceptions),
      review: bodyReview(body.review),
      ...(body.manualResolutions === undefined ? {} : { manualResolutions: body.manualResolutions as RedactionManualResolution[] }),
    });
  }
  if (input.action === "render") {
    assertOnlyKeys(body, ["expectedRevision"]);
    return renderLocalRedactionSlide({ ...identity, expectedRevision: bodyRevision(body.expectedRevision) });
  }
  if (input.action === "approve") {
    assertOnlyKeys(body, ["expectedRevision", "outputHash", "reviewer", "outputInspected"]);
    const outputHash = boundedText(body.outputHash, 64);
    if (!SHA256_PATTERN.test(outputHash) || body.outputInspected !== true) {
      fail("INVALID_BODY", "블러본 확인 기록이 올바르지 않습니다.");
    }
    return approveLocalRedactionSlide({
      ...identity,
      expectedRevision: bodyRevision(body.expectedRevision),
      outputHash: outputHash.toLowerCase(),
      reviewer: boundedText(body.reviewer, 100),
      outputInspected: true,
    });
  }
  fail("INVALID_BODY", "허용되지 않은 편집 동작입니다.");
}

async function handleMockupPost(input: {
  request: IncomingMessage;
  root: string;
  buildId: string;
  action: string;
}) {
  const body = await readPostJson(input.request);
  const identity = { root: input.root, buildId: input.buildId };
  if (input.action === "initialize") {
    assertOnlyKeys(body, ["title"]);
    return initializeLocalMockups({ ...identity, title: bodyMockupTitle(body.title) });
  }
  if (input.action === "save") {
    assertOnlyKeys(body, ["expectedRevision", "title", "boards"]);
    return saveLocalMockupAssignments({
      ...identity,
      expectedRevision: bodyRevision(body.expectedRevision),
      title: bodyMockupTitle(body.title),
      boards: bodyMockupBoards(body.boards),
    });
  }
  if (input.action === "render") {
    assertOnlyKeys(body, ["expectedRevision", "scale", "templateIds"]);
    if (body.scale !== 0.5 && body.scale !== 1) fail("INVALID_BODY", "목업 제작 배율이 올바르지 않습니다.");
    return renderLocalMockups({
      ...identity,
      expectedRevision: bodyRevision(body.expectedRevision),
      scale: body.scale,
      templateIds: bodyMockupTemplateIds(body.templateIds),
    });
  }
  if (input.action === "request") {
    assertOnlyKeys(body, ["expectedRevision", "sourceSlideNumber", "reason"]);
    if (!Number.isSafeInteger(body.sourceSlideNumber) || Number(body.sourceSlideNumber) < 1) {
      fail("INVALID_BODY", "준비할 원본 장표 번호가 올바르지 않습니다.");
    }
    return requestLocalMockupSlide({
      ...identity,
      expectedRevision: bodyRevision(body.expectedRevision),
      sourceSlideNumber: Number(body.sourceSlideNumber),
      reason: boundedText(body.reason, 500).trim(),
    });
  }
  fail("INVALID_BODY", "허용되지 않은 목업 동작입니다.");
}

export type StartLocalReviewServerInput = Readonly<{
  root: string;
  buildId: string;
  preparationReview?: LocalPreparationReviewCallbacks;
  productionBridge?: Readonly<{
    sessionId: string;
    workItemId: string;
    /** Trusted worker transport: must reverify the expected snapshot under its
     * store lock and authorize the remote destination. Never browser credentials. */
    stage: (expectedSnapshotHash: string) => Promise<{ sessionId: string; staged: true }>;
  }>;
}>;

function renderPreparationHtml() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>규격·추상 그래픽 직접 검수</title><link rel="stylesheet" href="/style.css"></head><body class="mockup-page"><header class="mockup-header"><div><p class="privacy">원본 확인은 이 PC 안에서만 · 자동 승인·업로드 안 함</p><h1>규격·추상 그래픽 직접 검수</h1><p>원본을 실제 크기로 확인한 항목만 기록합니다. 블러·개인정보 검수와 공개 승인은 이후 별도입니다.</p></div><a class="back-link" href="/">장표 선정표로 돌아가기</a></header><p id="preparation-status" class="editor-status" role="status" aria-live="polite">준비 상태 확인 중…</p><section class="mockup-controls"><div><strong id="preparation-source"></strong><p>사용자 지정 세로는 A4 세로와 비율 차이 3% 이내일 때만 흰색 여백으로 연결합니다. 원본 비율·내용을 늘이거나 자르지 않습니다.</p></div><button id="preparation-refresh" type="button">상태 새로고침</button></section><section id="preparation-source-choice" class="candidate-panel"></section><main id="preparation-artwork" class="candidate-panel"></main><section class="request-panel"><button id="preparation-apply" class="primary-action" type="button" disabled>직접 확인한 항목으로 다시 준비</button><p>입력 중 자동 저장·AI 요청 없음. 다른 보류 사유는 자동 해제하지 않습니다.</p><a id="preparation-next" class="mockup-link" hidden target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">새로 준비된 장표 검토 열기</a></section><dialog id="preparation-image-dialog" class="mockup-preview-dialog"><div class="dialog-heading"><h2 id="preparation-image-label">원본 실제 크기 확인</h2><button id="preparation-image-close" type="button">닫기</button></div><div id="preparation-image-scroll" class="mockup-preview-scroll"></div></dialog><script type="module" src="/preparation-review-client.mjs"></script></body></html>`;
}
function preparationBuild(value: unknown, expectedBuildId: string): PreparationReviewBuild {
  if (!isRecord(value)) fail("INVALID_BODY", "준비 기준이 필요합니다.");
  assertOnlyKeys(value, ["buildId", "revision", "sourceHash"]);
  if (value.buildId !== expectedBuildId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || typeof value.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceHash)) fail("INVALID_BODY", "준비 기준이 올바르지 않습니다.");
  return { buildId: expectedBuildId, revision: Number(value.revision), sourceHash: value.sourceHash };
}
function preparationDecision(value: unknown, extra: "kind" | "classification"): PreparationVisualDecision {
  if (!isRecord(value)) fail("INVALID_BODY", "직접 확인 기록이 필요합니다.");
  assertOnlyKeys(value, ["sourceSlideNumber", "slideContentHash", "previewHash", "imageHash", "inspectedAtActualSize", "reason", extra]);
  if (!positiveInteger(value.sourceSlideNumber) || Number(value.sourceSlideNumber) > 500
    || ![value.slideContentHash,value.previewHash,value.imageHash].every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))
    || value.inspectedAtActualSize !== true || typeof value.reason !== "string" || value.reason.trim().length < 10
    || value.reason.length > 500 || /[\x00-\x1f\x7f]/.test(value.reason)
    || value[extra] !== (extra === "kind" ? "custom_portrait_to_a4" : "abstract_graphic")) fail("INVALID_BODY", "원본 확인·해시·구체적인 사유를 확인해 주세요.");
  return { sourceSlideNumber: Number(value.sourceSlideNumber), slideContentHash: String(value.slideContentHash), previewHash: String(value.previewHash),
    imageHash: String(value.imageHash), inspectedAtActualSize: true, reason: value.reason.trim() };
}
function publicPreparationReview(view: PreparationReviewView, buildId: string) {
  preparationBuild({ buildId:view.buildId,revision:view.revision,sourceHash:view.sourceHash },buildId);
  if (view.version !== 1 || view.localOnly !== true || !UUID_PATTERN.test(view.workId) || !Array.isArray(view.slides) || view.slides.length > 500
    || !Number.isFinite(view.source.width) || !Number.isFinite(view.source.height) || view.source.width <= 0 || view.source.height <= 0) fail("PREPARATION_REVIEW_INVALID", "검수 상태가 올바르지 않습니다.");
  const numbers = new Set<number>();
  const slides = view.slides.map(slide => {
    if (!positiveInteger(slide.sourceSlideNumber) || numbers.has(slide.sourceSlideNumber) || !/^[a-f0-9]{64}$/.test(slide.slideContentHash)
      || (slide.previewHash !== null && !/^[a-f0-9]{64}$/.test(slide.previewHash))) fail("PREPARATION_REVIEW_INVALID", "장표 검수 상태가 올바르지 않습니다.");
    numbers.add(slide.sourceSlideNumber);
    if (slide.evidence && (!/^[a-f0-9]{64}$/.test(slide.evidence.imageHash) || !positiveInteger(slide.evidence.width)
      || !positiveInteger(slide.evidence.height) || slide.evidence.width*slide.evidence.height > 12_000_000)) fail("PREPARATION_REVIEW_INVALID", "원본 증거 이미지가 올바르지 않습니다.");
    return { sourceSlideNumber:slide.sourceSlideNumber,slideContentHash:slide.slideContentHash,previewHash:slide.previewHash,
      evidence:slide.evidence ? {imageHash:slide.evidence.imageHash,width:slide.evidence.width,height:slide.evidence.height,
        url:`/preparation-image/${view.revision}/${view.sourceHash}/${slide.sourceSlideNumber}/${slide.evidence.imageHash}`} : null,
      artworkEligible:slide.artworkEligible===true,artworkReviewed:slide.artworkReviewed===true,reasons:slide.reasons.map(v=>safeString(v,500)).slice(0,20) };
  });
  return {version:1,workId:view.workId,buildId:view.buildId,revision:view.revision,sourceHash:view.sourceHash,
    source:{width:view.source.width,height:view.source.height,aspect:safeString(view.source.aspect,60),pageSizeVariant:safeString(view.source.pageSizeVariant,60)},
    customPortrait:{allowed:view.customPortrait.allowed===true,currentChoice:view.customPortrait.currentChoice===true,
      reviewSlideNumber:positiveInteger(view.customPortrait.reviewSlideNumber),reason:safeString(view.customPortrait.reason,500)},
    slides,holds:view.holds.map(v=>safeString(v,500)).slice(0,30),localOnly:true};
}
function preparationError(error: unknown) {
  const code = error instanceof Error ? (("code" in error && typeof error.code === "string" ? error.code : error.message).split(":",1)[0]) : "";
  return { status:code==="BODY_TOO_LARGE"?413:code==="INVALID_BODY"?400:409,
    error:code==="INVALID_BODY"?"원본 확대 확인·선택·사유와 요청 형식을 확인해 주세요.":code==="BODY_TOO_LARGE"?"검수 요청이 허용된 크기를 넘었습니다.":
      "원본·준비 상태가 바뀌었거나 증거가 아직 준비되지 않았습니다. 입력 사유는 유지됩니다. 최신 상태에서 원본을 다시 확인해 주세요. 자동 재시도하지 않습니다." };
}
function preparationLaunchUrl(value: unknown) {
  if(typeof value!=="string")return null;
  try { const url=new URL(value);return url.protocol==="http:" && url.hostname==="127.0.0.1" && Boolean(url.port) && !url.username && !url.password && !url.search && !url.hash
    && /^\/launch\/[a-f0-9]{64}$/.test(url.pathname) ? url.href : null; } catch {return null;}
}

export type LocalReviewServerHandle = Readonly<{
  url: string;
  launchUrl?: string;
  /** Reissue only the bridge navigation credential, not the editing cookies. */
  issueLaunchUrl?: () => string;
  close: () => Promise<void>;
}>;

export async function startLocalReviewServer(
  input: StartLocalReviewServerInput,
): Promise<LocalReviewServerHandle> {
  if (!path.isAbsolute(input.root)) fail("UNSAFE_ROOT", "로컬 검토 작업 폴더는 절대 경로여야 합니다.");
  if (!UUID_PATTERN.test(input.buildId)) fail("INVALID_BUILD_ID", "buildId는 UUID여야 합니다.");
  const bridge = input.productionBridge;
  const preparation = input.preparationReview;
  if (preparation && [preparation.get,preparation.prepareEvidence,preparation.readEvidence,preparation.apply].some(callback=>typeof callback!=="function")) fail("INVALID_PREPARATION_REVIEW", "준비 검수 연결이 올바르지 않습니다.");
  if (bridge && (!UUID_PATTERN.test(bridge.sessionId) || !UUID_PATTERN.test(bridge.workItemId)
    || typeof bridge.stage !== "function")) fail("INVALID_PRODUCTION_BRIDGE", "관리자 검토 연결 정보가 올바르지 않습니다.");
  await assertRealDirectory(input.root, "작업");
  const root = await realpath(input.root);
  await readLedger(root, input.buildId);
  const editorClient = await readFile(new URL("./redaction-editor-client.mjs", import.meta.url));
  const mockupClient = await readFile(new URL("./mockup-editor-client.mjs", import.meta.url));
  const productionClient = bridge ? await readFile(new URL("./production-bridge-client.mjs", import.meta.url)) : null;
  const preparationClient = preparation ? await readFile(new URL("./preparation-review-client.mjs", import.meta.url)) : null;
  if (preparationClient && preparationClient.length > 128 * 1024) fail("INVALID_EDITOR_ASSET", "준비 검수 화면이 올바르지 않습니다.");
  if (editorClient.length > 1024 * 1024) fail("INVALID_EDITOR_ASSET", "로컬 편집 화면 파일이 올바르지 않습니다.");
  if (mockupClient.length > 1024 * 1024) fail("INVALID_EDITOR_ASSET", "로컬 목업 화면 파일이 올바르지 않습니다.");
  if (productionClient && productionClient.length > 128 * 1024) fail("INVALID_EDITOR_ASSET", "관리자 검토 화면 파일이 올바르지 않습니다.");

  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  let cookieName = "";
  let launchCookieName = "";
  const launchCookieToken = bridge ? randomBytes(32).toString("base64url") : "";
  let expectedHost = "";
  let origin = "";
  let closed = false;
  let launchToken = bridge ? randomBytes(32).toString("hex") : null;
  let launchExpiresAt = Date.now() + 15 * 60 * 1000;
  let launchUsed = false;
  let launchLandingUntil = 0;
  let staging = false;
  let preparationBusy = false;
  let preparationApplied = false;
  let stagedHash: string | null = null;
  const sockets = new Set<Socket>();
  let mockupTail: Promise<unknown> = Promise.resolve();
  const serializeMockup = <T>(operation: () => Promise<T>) => {
    const current = mockupTail.then(operation, operation);
    mockupTail = current.then(() => undefined, () => undefined);
    return current;
  };

  const server = createServer(async (request, response) => {
    let pathname = "";
    try {
      if (!expectedHost || !exactHost(request, expectedHost)) {
        send(response, 403, "text/plain; charset=utf-8", "접근이 거부되었습니다.");
        return;
      }
      const requestOrigin = request.headers.origin;
      const requestUrl = new URL(request.url ?? "/", origin);
      pathname = requestUrl.pathname;
      if (requestUrl.origin !== origin || requestUrl.search || requestUrl.hash) {
        send(response, 404, "text/plain; charset=utf-8", "요청한 로컬 검토 항목이 없습니다.");
        return;
      }
      if (requestUrl.pathname.startsWith("/launch/")) {
        const supplied = requestUrl.pathname.slice("/launch/".length);
        if (!bridge || !launchToken || launchUsed || Date.now() >= launchExpiresAt
          || request.method !== "GET" || !/^[a-f0-9]{64}$/.test(supplied)
          || !sameToken(supplied, launchToken) || exactHeader(request, "sec-fetch-mode") !== "navigate"
          || exactHeader(request, "sec-fetch-dest") !== "document") {
          send(response, 403, "text/plain; charset=utf-8", "관리자 화면에서 새 로컬 검토 연결을 열어 주세요.");
          return;
        }
        // Consume synchronously before any asynchronous work. Cross-site access
        // is allowed only here, never for scripts, images, fetch or POST.
        launchUsed = true;
        launchLandingUntil = Date.now() + 30_000;
        send(response, 303, "text/plain; charset=utf-8", "로컬 검토 화면으로 이동합니다.", {
          Location: "/", "Set-Cookie": `${launchCookieName}=${launchCookieToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=30`,
        });
        return;
      }
      const launchCookie = launchCookieName ? sessionCookie(request, launchCookieName) : null;
      if (bridge && request.method === "GET" && requestUrl.pathname === "/" && launchLandingUntil > Date.now()
        && launchCookie?.value && sameToken(launchCookie.value, launchCookieToken)
        && exactHeader(request, "sec-fetch-mode") === "navigate" && exactHeader(request, "sec-fetch-dest") === "document") {
        // Strict cookies may be withheld along a cross-site redirect chain.
        // Exchange the one-use, 30-second Lax bootstrap for the normal Strict
        // session at the clean root URL, then erase the bootstrap credential.
        launchLandingUntil = 0;
        const model = buildReviewModel(await readLedger(root, input.buildId));
        send(response, 200, "text/html; charset=utf-8", renderHtml(model,Boolean(preparation)), {
          "Set-Cookie": [`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,
            `${launchCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`],
        });
        return;
      }
      if (typeof requestOrigin === "string" && requestOrigin !== origin) {
        send(response, 403, "text/plain; charset=utf-8", "접근이 거부되었습니다.");
        return;
      }
      const suppliedCookie = sessionCookie(request, cookieName);
      const authenticated = suppliedCookie.value !== null && sameToken(suppliedCookie.value, token);
      if (!authenticated) {
        if (request.method !== "GET" || requestUrl.pathname !== "/" || suppliedCookie.present || !isDirectNavigation(request)) {
          send(response, 401, "text/plain; charset=utf-8", "먼저 로컬 검토 주소를 직접 열어 주세요.");
          return;
        }
        const model = buildReviewModel(await readLedger(root, input.buildId));
        send(response, 200, "text/html; charset=utf-8", renderHtml(model,Boolean(preparation)), {
          "Set-Cookie": `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,
        });
        return;
      }
      if (request.method === "GET") {
        if (!(isSameOriginFetch(request) || (requestUrl.pathname === "/" && isDirectNavigation(request)))) {
          send(response, 403, "text/plain; charset=utf-8", "동일 출처의 로컬 화면에서만 볼 수 있습니다.");
          return;
        }
        if (requestUrl.pathname === "/") {
          launchLandingUntil = 0;
          const model = buildReviewModel(await readLedger(root, input.buildId));
          send(response, 200, "text/html; charset=utf-8", renderHtml(model,Boolean(preparation)));
          return;
        }
        if (requestUrl.pathname === "/style.css") {
          send(response, 200, "text/css; charset=utf-8", STYLES);
          return;
        }
        if (requestUrl.pathname === "/redaction-editor-client.mjs") {
          send(response, 200, "text/javascript; charset=utf-8", editorClient);
          return;
        }
        if (requestUrl.pathname === "/mockup-editor-client.mjs") {
          send(response, 200, "text/javascript; charset=utf-8", mockupClient);
          return;
        }
        if (preparation && requestUrl.pathname === "/preparation") { send(response,200,"text/html; charset=utf-8",renderPreparationHtml());return; }
        if (preparation && preparationClient && requestUrl.pathname === "/preparation-review-client.mjs") { send(response,200,"text/javascript; charset=utf-8",preparationClient);return; }
        if (preparation && requestUrl.pathname === "/api/preparation-review") {
          const view=await serializeMockup(()=>preparation.get());sendJson(response,200,{csrfToken,review:publicPreparationReview(view,input.buildId)});return;
        }
        const preparationImage=/^\/preparation-image\/(0|[1-9]\d*)\/([a-f0-9]{64})\/([1-9]\d*)\/([a-f0-9]{64})$/.exec(requestUrl.pathname);
        if(preparation && preparationImage){
          const expectedCurrentBuild=preparationBuild({buildId:input.buildId,revision:Number(preparationImage[1]),sourceHash:preparationImage[2]},input.buildId);
          const sourceSlideNumber=Number(preparationImage[3]);
          if(!positiveInteger(sourceSlideNumber)||sourceSlideNumber>500)fail("INVALID_BODY","원본 장표 번호가 올바르지 않습니다.");
          const png=await serializeMockup(()=>preparation.readEvidence({expectedCurrentBuild,sourceSlideNumber,imageHash:preparationImage[4]}));
          if(!Buffer.isBuffer(png)||png.length>MAX_IMAGE_BYTES||!png.subarray(0,8).equals(PNG_SIGNATURE)||createHash("sha256").update(png).digest("hex")!==preparationImage[4])fail("STALE_ARTIFACT","원본 검수 이미지가 바뀌었습니다.");
          send(response,200,"image/png",png);return;
        }
        if (bridge && productionClient && requestUrl.pathname === "/production-bridge-client.mjs") {
          send(response, 200, "text/javascript; charset=utf-8", productionClient);
          return;
        }
        if (bridge && requestUrl.pathname === "/api/production/preview") {
          const preview = await serializeMockup(() => getVerifiedProductionMockupDescriptor({ root, buildId: input.buildId }, { mode: "full" }));
          sendJson(response, 200, { csrfToken, ...preview });
          return;
        }
        if (requestUrl.pathname === "/api/review") {
          const model = buildReviewModel(await readLedger(root, input.buildId));
          sendJson(response, 200, model);
          return;
        }
        if (requestUrl.pathname === "/mockups") {
          send(response, 200, "text/html; charset=utf-8", renderMockupHtml(Boolean(bridge),Boolean(preparation)));
          return;
        }
        if (requestUrl.pathname === "/api/mockups") {
          const review = await serializeMockup(() => getLocalMockupReview({ root, buildId: input.buildId }));
          sendJson(response, 200, { csrfToken, review: publicMockupReview(review) });
          return;
        }
        if (requestUrl.pathname === "/api/mockups/title") {
          const review = await serializeMockup(() => getLocalMockupTitleReview({ root, buildId: input.buildId }));
          sendJson(response, 200, { csrfToken, review: publicMockupTitleReview(review) });
          return;
        }
        const titleImageMatch = /^\/mockup-title-image\/(draft|final|active)\/([0-9a-f]{64})$/.exec(requestUrl.pathname);
        if (titleImageMatch) {
          const png = await serializeMockup(() => readLocalMockupTitleImage({
            root,
            buildId: input.buildId,
            kind: titleImageMatch[1] as "draft" | "final" | "active",
            expectedHash: titleImageMatch[2],
          }));
          if (createHash("sha256").update(png).digest("hex") !== titleImageMatch[2]) fail("STALE_ARTIFACT", "제목 이미지가 화면 요청 뒤 변경됐습니다.");
          send(response, 200, "image/png", png);
          return;
        }
        const editorMatch = /^\/editor\/([1-9]\d*)$/.exec(requestUrl.pathname);
        if (editorMatch) {
          const sourceSlideNumber = Number(editorMatch[1]);
          await assertEditableSlide(root, input.buildId, sourceSlideNumber);
          send(response, 200, "text/html; charset=utf-8", renderEditorHtml(sourceSlideNumber));
          return;
        }
        const apiRoute = redactionApiRoute(requestUrl.pathname);
        if (apiRoute?.action === "read") {
          await assertEditableSlide(root, input.buildId, apiRoute.sourceSlideNumber);
          const state = await getLocalRedactionSlide({ root, buildId: input.buildId, sourceSlideNumber: apiRoute.sourceSlideNumber });
          sendJson(response, 200, { csrfToken, state: publicRedactionState(state) });
          return;
        }
        const redactedMatch = /^\/redacted\/([1-9]\d*)\/([0-9a-f]{64})$/.exec(requestUrl.pathname);
        if (redactedMatch) {
          const sourceSlideNumber = Number(redactedMatch[1]);
          await assertEditableSlide(root, input.buildId, sourceSlideNumber);
          const identity = { root, buildId: input.buildId, sourceSlideNumber };
          const state = await getLocalRedactionSlide(identity);
          if (!state.output || state.output.sha256 !== redactedMatch[2]) {
            send(response, 404, "text/plain; charset=utf-8", "검토할 블러본이 없습니다.");
            return;
          }
          send(response, 200, "image/png", await readSafeRedactedSlide(identity, { allowUnapproved: true }));
          return;
        }
        const sourceMatch = /^\/mockup-source\/([1-9]\d*)\/([0-9a-f]{64})$/.exec(requestUrl.pathname);
        if (sourceMatch) {
          const sourceSlideNumber = Number(sourceMatch[1]);
          const png = await serializeMockup(async () => {
            const review = await getLocalMockupReview({ root, buildId: input.buildId });
            const candidate = review.candidates.find((entry) => entry.sourceSlideNumber === sourceSlideNumber);
            if (candidate?.status !== "approved" || candidate.imageHash !== sourceMatch[2]) {
              return null;
            }
            const bytes = await readSafeRedactedSlide({ root, buildId: input.buildId, sourceSlideNumber });
            if (createHash("sha256").update(bytes).digest("hex") !== sourceMatch[2]) {
              fail("STALE_ARTIFACT", "승인 블러본이 화면 요청 뒤 변경됐습니다.");
            }
            return bytes;
          });
          if (!png) {
            send(response, 404, "text/plain; charset=utf-8", "사용할 수 있는 승인 블러본이 없습니다.");
            return;
          }
          send(response, 200, "image/png", png);
          return;
        }
        const mockupImageMatch = /^\/mockup-image\/([a-z0-9][a-z0-9-]{0,99})\/(draft|final)\/([0-9a-f]{64})(?:\/(debug|download))?$/.exec(requestUrl.pathname);
        if (mockupImageMatch) {
          const [, templateId, kind, expectedHash, mode] = mockupImageMatch;
          if (mode === "download" && kind !== "final") {
            send(response, 404, "text/plain; charset=utf-8", "내려받을 최종 목업이 없습니다.");
            return;
          }
          const png = await serializeMockup(async () => {
            const review = await getLocalMockupReview({ root, buildId: input.buildId });
            const board = review.boards.find((entry) => entry.templateId === templateId);
            const record = kind === "draft" ? board?.draft : board?.final;
            if (!record || record.sha256 !== expectedHash) {
              return null;
            }
            const bytes = await readLocalMockupImage({
              root,
              buildId: input.buildId,
              templateId,
              scale: kind === "draft" ? 0.5 : 1,
              debug: mode === "debug",
            });
            const servedHash = createHash("sha256").update(bytes).digest("hex");
            const currentHash = mode === "debug" ? record.debugHash : record.sha256;
            if (servedHash !== currentHash) fail("STALE_ARTIFACT", "목업 이미지가 화면 요청 뒤 변경됐습니다.");
            return bytes;
          });
          if (!png) {
            send(response, 404, "text/plain; charset=utf-8", "현재 배정표로 만든 목업이 없습니다.");
            return;
          }
          send(response, 200, "image/png", png, mode === "download"
            ? { "Content-Disposition": `attachment; filename="${templateId}.png"` }
            : undefined);
          return;
        }
        if (requestUrl.pathname.startsWith("/artifact/")) {
          const encoded = requestUrl.pathname.slice("/artifact/".length);
          let key = "";
          try {
            key = decodeURIComponent(encoded);
          } catch {
            send(response, 404, "text/plain; charset=utf-8", "검토 이미지가 없습니다.");
            return;
          }
          if (!REVIEW_ARTIFACT_PATTERN.test(key) || encodeURIComponent(key) !== encoded) {
            send(response, 404, "text/plain; charset=utf-8", "검토 이미지가 없습니다.");
            return;
          }
          const snapshot = await readLedger(root, input.buildId);
          const artifact = snapshot.artifacts.get(key);
          if (!artifact) {
            send(response, 404, "text/plain; charset=utf-8", "검토 이미지가 없습니다.");
            return;
          }
          send(response, 200, "image/png", await readVerifiedPng(root, input.buildId, artifact));
          return;
        }
        send(response, 404, "text/plain; charset=utf-8", "요청한 로컬 검토 항목이 없습니다.");
        return;
      }
      if (request.method === "POST") {
        if (preparation && ["/api/preparation-review/evidence","/api/preparation-review/apply"].includes(requestUrl.pathname)) {
          const csrf=exactHeader(request,"x-woolim-csrf");
          if(!isSameOriginFetch(request)||requestOrigin!==origin||!csrf||!sameToken(csrf,csrfToken)){sendJson(response,403,{error:"동일 출처의 로컬 검수 화면에서 다시 시도해 주세요."});return;}
          if(preparationBusy||preparationApplied||staging||stagedHash){sendJson(response,409,{error:"이미 준비 중이거나 완료된 검수입니다. 새로 준비된 장표 화면에서 확인해 주세요."});return;}
          preparationBusy=true;
          try{
            const body=await readPostJson(request),expectedCurrentBuild=preparationBuild(body.expectedCurrentBuild,input.buildId);
            if(requestUrl.pathname.endsWith("/evidence")){
              assertOnlyKeys(body,["expectedCurrentBuild","slideNumbers"]);
              if(!Array.isArray(body.slideNumbers)||body.slideNumbers.length<1||body.slideNumbers.length>8||new Set(body.slideNumbers).size!==body.slideNumbers.length||body.slideNumbers.some(n=>!positiveInteger(n)||Number(n)>500))fail("INVALID_BODY","원본 장표 번호가 올바르지 않습니다.");
              const view=await serializeMockup(()=>preparation.prepareEvidence({expectedCurrentBuild,slideNumbers:body.slideNumbers as number[]}));
              sendJson(response,200,{review:publicPreparationReview(view,input.buildId)});
            }else{
              assertOnlyKeys(body,["expectedCurrentBuild","sourceFormatChoice","artworkReviews"]);
              if(!Array.isArray(body.artworkReviews)||body.artworkReviews.length>500)fail("INVALID_BODY","추상 그래픽 확인 기록이 올바르지 않습니다.");
              const artworkReviews=body.artworkReviews.map(row=>({...preparationDecision(row,"classification"),classification:"abstract_graphic" as const}));
              if(new Set(artworkReviews.map(row=>row.sourceSlideNumber)).size!==artworkReviews.length)fail("INVALID_BODY","장표 확인 기록이 중복되었습니다.");
              const sourceFormatChoice=body.sourceFormatChoice===undefined?undefined:{...preparationDecision(body.sourceFormatChoice,"kind"),kind:"custom_portrait_to_a4" as const};
              if(!sourceFormatChoice&&!artworkReviews.length)fail("INVALID_BODY","직접 확인한 항목을 선택해 주세요.");
              const applyInput:PreparationReviewApplyInput={expectedCurrentBuild,artworkReviews,...(sourceFormatChoice?{sourceFormatChoice}:{})};
              const result=await serializeMockup(()=>preparation.apply(applyInput)),launchUrl=preparationLaunchUrl(result.launchUrl);
              if(result.applied!==true||!UUID_PATTERN.test(result.buildId)||!launchUrl)fail("PREPARATION_RESULT_INVALID","새 검수 연결을 확인하지 못했습니다.");
              preparationApplied=true;sendJson(response,200,{applied:true,buildId:result.buildId,launchUrl});
            }
          }catch(error){const safe=preparationError(error);sendJson(response,safe.status,{error:safe.error});}finally{preparationBusy=false;}
          return;
        }
        if (bridge && requestUrl.pathname === "/api/production/stage") {
          const csrf = exactHeader(request, "x-woolim-csrf");
          if (!isSameOriginFetch(request) || requestOrigin !== origin || !csrf || !sameToken(csrf, csrfToken)) {
            sendJson(response, 403, { error: "동일 출처의 로컬 편집 화면에서 다시 시도해 주세요." });
            return;
          }
          try {
            const body = await readPostJson(request);
            assertOnlyKeys(body, ["expectedSnapshotHash", "outputInspected"]);
            if (typeof body.expectedSnapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedSnapshotHash)
              || body.outputInspected !== true) fail("INVALID_BODY", "최종 5장 확인 기록이 필요합니다.");
            if (staging || (stagedHash && stagedHash !== body.expectedSnapshotHash)) {
              sendJson(response, 409, { error: "이미 전송 중이거나 전송한 검토입니다. 관리자 화면에서 상태를 확인해 주세요." });
              return;
            }
            if (stagedHash === body.expectedSnapshotHash) {
              sendJson(response, 200, { sessionId: bridge.sessionId, staged: true });
              return;
            }
            staging = true;
            try {
              const expectedSnapshotHash = body.expectedSnapshotHash;
              await serializeMockup(async () => {
                const current = await getVerifiedProductionMockupDescriptor({ root, buildId: input.buildId }, { mode: "full" });
                if (current.snapshotHash !== expectedSnapshotHash) fail("PRODUCTION_SNAPSHOT_STALE", "검토 후보가 변경됐습니다.");
                // The trusted callback owns locked re-verification during actual
                // transport; do not recursively acquire its store lock here.
                const result = await bridge.stage(expectedSnapshotHash);
                if (result?.sessionId !== bridge.sessionId || result.staged !== true) {
                  fail("PRODUCTION_STAGE_RESULT_INVALID", "관리자 검토 전송을 확인하지 못했습니다.");
                }
              });
              stagedHash = expectedSnapshotHash;
              sendJson(response, 200, { sessionId: bridge.sessionId, staged: true });
            } finally { staging = false; }
          } catch (error) {
            const raw = error instanceof Error ? (("code" in error && typeof error.code === "string" ? error.code : error.message).split(":", 1)[0]) : "";
            const status = raw === "BODY_TOO_LARGE" ? 413 : raw === "INVALID_BODY" ? 400
              : raw.startsWith("PRODUCTION_SNAPSHOT_") || raw.startsWith("MOCKUP_") ? 409 : 500;
            sendJson(response, status, { error: status === 409 ? "확인 이후 목업이 바뀌었거나 미완료입니다. 최종 5장을 다시 확인해 주세요."
              : status === 400 ? "최종 5장 확인과 전송 요청 내용을 확인해 주세요."
              : "관리자 검토용 전송을 완료하지 못했습니다. 기존 운영 이미지는 그대로이며 자동 재시도하지 않습니다." });
          }
          return;
        }
        const apiRoute = redactionApiRoute(requestUrl.pathname);
        const mockupRoute = mockupApiRoute(requestUrl.pathname);
        const titleRoute = mockupTitleApiRoute(requestUrl.pathname);
        if ((!apiRoute || apiRoute.action === "read") && (!mockupRoute || mockupRoute.action === "read") && (!titleRoute || titleRoute.action === "read")) {
          if (requestUrl.pathname === "/api/review" || apiRoute?.action === "read" || mockupRoute?.action === "read" || titleRoute?.action === "read") {
            send(response, 405, "text/plain; charset=utf-8", "이 항목은 GET 요청만 허용합니다.", { Allow: "GET" });
          } else {
            send(response, 404, "text/plain; charset=utf-8", "요청한 로컬 검토 항목이 없습니다.");
          }
          return;
        }
        const csrf = exactHeader(request, "x-woolim-csrf");
        if (!isSameOriginFetch(request) || requestOrigin !== origin || !csrf || !sameToken(csrf, csrfToken)) {
          sendJson(response, 403, { error: "동일 출처의 로컬 편집 화면에서 다시 시도해 주세요." });
          return;
        }
        try {
          if (titleRoute && titleRoute.action !== "read") {
            const review = await serializeMockup(() => handleMockupTitlePost({ request, root, buildId: input.buildId, action: titleRoute.action }));
            sendJson(response, 200, { review: publicMockupTitleReview(review) });
          } else if (mockupRoute && mockupRoute.action !== "read") {
            const review = await serializeMockup(() => handleMockupPost({
              request,
              root,
              buildId: input.buildId,
              action: mockupRoute.action,
            }));
            sendJson(response, 200, { review: publicMockupReview(review) });
          } else if (apiRoute && apiRoute.action !== "read") {
            const state = await handleRedactionPost({ request, root, buildId: input.buildId, ...apiRoute });
            sendJson(response, 200, { state: publicRedactionState(state) });
          }
        } catch (error) {
          const safe = mockupRoute || titleRoute ? mockupError(error) : redactionError(error);
          sendJson(response, safe.status, { error: safe.error });
        }
        return;
      }
      send(response, 405, "text/plain; charset=utf-8", "허용되지 않은 요청 방식입니다.", { Allow: "GET, POST" });
    } catch (error) {
      const status = error instanceof LocalReviewServerError
        && ["STALE_ARTIFACT", "INVALID_LEDGER", "UNSAFE_PATH", "EDITOR_NOT_AVAILABLE"].includes(error.code)
        ? 409
        : 500;
      if (!response.headersSent && pathname.startsWith("/api/")) {
        const safe = pathname.startsWith("/api/preparation-review") ? preparationError(error) : pathname.startsWith("/api/production/") ? { status: 409, error: "현재 확정된 최종 5장을 준비하지 못했습니다. 장표·가림·제목 확정을 다시 확인해 주세요." }
          : pathname.startsWith("/api/mockups") ? mockupError(error) : redactionError(error);
        sendJson(response, safe.status, { error: safe.error });
      } else if (!response.headersSent) send(response, status, "text/plain; charset=utf-8", "로컬 검토 자료를 안전하게 읽지 못했습니다.");
      else response.destroy();
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 2_000;
  server.maxRequestsPerSocket = 100;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fail("UNSAFE_BIND", "로컬 검토 서버가 IPv4 루프백에 연결되지 않았습니다.");
  }
  expectedHost = `127.0.0.1:${address.port}`;
  origin = `http://${expectedHost}`;
  cookieName = `${COOKIE_PREFIX}_${address.port}_${randomBytes(6).toString("hex")}`;
  launchCookieName = bridge ? `${cookieName}_launch` : "";

  return {
    url: `${origin}/`,
    ...(launchToken ? { launchUrl: `${origin}/launch/${launchToken}` } : {}),
    ...(bridge ? { issueLaunchUrl: () => {
      if (closed) fail("LOCAL_REVIEW_CLOSED", "종료된 로컬 검수 연결입니다.");
      launchToken=randomBytes(32).toString("hex");launchExpiresAt=Date.now()+15*60*1000;launchUsed=false;launchLandingUntil=0;
      return `${origin}/launch/${launchToken}`;
    } } : {}),
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
