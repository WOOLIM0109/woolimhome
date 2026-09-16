"use strict";

const slideNumber = Number(document.body.dataset.sourceSlideNumber);
const sourceImage = document.querySelector("#source-image");
const overlay = document.querySelector("#redaction-overlay");
const imageStage = document.querySelector("#image-stage");
const imageScroller = document.querySelector(".image-scroller");
const statusNode = document.querySelector("#editor-status");
const candidateList = document.querySelector("#candidate-list");
const warningList = document.querySelector("#redaction-warnings");
const regionList = document.querySelector("#region-list");
const zoomInput = document.querySelector("#zoom");
const zoomLabel = document.querySelector("#zoom-label");
const fitButton = document.querySelector("#fit-image");
const modeInput = document.querySelector("#mask-mode");
const addButton = document.querySelector("#add-region");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const saveButton = document.querySelector("#save-redaction");
const renderButton = document.querySelector("#render-redaction");
const approveButton = document.querySelector("#approve-redaction");
const reviewerInput = document.querySelector("#reviewer");
const originalInspectedInput = document.querySelector("#original-inspected");
const outputInspectedInput = document.querySelector("#output-inspected");
const afterCompareInput = document.querySelector("#compare-after");
const beforeCompareInput = document.querySelector("#compare-before");
const replacementNotice = document.querySelector("#replacement-notice");
const exceptionDialog = document.querySelector("#exception-dialog");
const exceptionTarget = document.querySelector("#exception-target");
const exceptionActor = document.querySelector("#exception-actor");
const exceptionReason = document.querySelector("#exception-reason");
const exceptionSave = document.querySelector("#exception-save");
const exceptionCancel = document.querySelector("#exception-cancel");

let csrfToken = "";
let state = null;
let regions = [];
let exceptions = [];
let manualResolutions = [];
let inspectedUncertaintyId = null;
let dirty = false;
let addMode = false;
let drag = null;
let exceptionCandidateId = null;
const undoStack = [];
const redoStack = [];

function setStatus(message, kind = "info") {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

function markReviewDirty() {
  if (!state) return;
  dirty = true;
  manualResolutions = [];
  inspectedUncertaintyId = null;
  showBefore();
  renderAll();
  setStatus("검토 기록이 바뀌었습니다. 먼저 저장해 주세요.", "pending");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function id() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function setZoomPercent(value) {
  const zoom = clamp(Math.round(Number(value) || 100), 10, 400);
  zoomInput.value = String(zoom);
  const sourceWidth = Number(state?.width);
  if (Number.isFinite(sourceWidth) && sourceWidth > 0) {
    imageStage.style.width = `${Math.max(1, Math.round(sourceWidth * zoom / 100))}px`;
  }
  zoomLabel.textContent = `확대 ${zoom}% · 100%=실제크기`;
}

function fitImage() {
  if (!state || !Number.isFinite(state.width) || state.width <= 0) return;
  const style = getComputedStyle(imageScroller);
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const availableWidth = Math.max(1, imageScroller.clientWidth - padding);
  setZoomPercent(Math.min(100, Math.floor(availableWidth / state.width * 100)));
}

function validRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= 1.0000001 && rect.y + rect.height <= 1.0000001;
}

function covers(outer, inner) {
  const epsilon = 0.0000001;
  return outer.x <= inner.x + epsilon && outer.y <= inner.y + epsilon
    && outer.x + outer.width >= inner.x + inner.width - epsilon
    && outer.y + outer.height >= inner.y + inner.height - epsilon;
}

function currentSnapshot() {
  return JSON.stringify({ regions, exceptions });
}

function restoreSnapshot(snapshot) {
  const value = JSON.parse(snapshot);
  regions = value.regions;
  exceptions = value.exceptions;
  manualResolutions = [];
  inspectedUncertaintyId = null;
  dirty = true;
  showBefore();
  renderAll();
}

function beginMutation() {
  undoStack.push(currentSnapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

function finishMutation(message) {
  dirty = true;
  manualResolutions = [];
  inspectedUncertaintyId = null;
  showBefore();
  renderAll();
  setStatus(message, "pending");
}

function candidateById(candidateId) {
  return state?.candidates.find((candidate) => candidate.id === candidateId) ?? null;
}

function candidateResolved(candidate) {
  const uncertainties = (state.uncertainties ?? []).filter((entry) => entry.candidateId === candidate.id);
  if (uncertainties.length && uncertainties.every((entry) => manualResolutions.some((resolution) =>
    resolution.uncertaintyId === entry.id && resolution.decision === "non_sensitive_confirmed"))) return true;
  if (exceptions.some((entry) => entry.candidateId === candidate.id && entry.actor.trim() && entry.reason.trim())) {
    return true;
  }
  return regions.some((region) => region.candidateId === candidate.id
    && covers(region.rect, candidate.rect) && (!candidate.required || region.mode === "opaque"));
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(label, onClick, className = "small-button") {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function renderCandidates() {
  warningList.replaceChildren();
  for (const warning of state.warnings ?? []) warningList.append(element("li", "", warning));
  warningList.hidden = warningList.childElementCount === 0;
  candidateList.replaceChildren();
  if (!state.candidates.length) {
    candidateList.append(element("p", "empty-list", "자동 가림 후보가 없습니다. 원본을 확대해 직접 확인해 주세요."));
    return;
  }
  for (const candidate of state.candidates) {
    const row = element("li", "candidate-row");
    const heading = element("strong", "candidate-heading", candidate.category || "확인 대상");
    heading.append(element("span", candidate.required ? "required" : "optional", candidate.required ? "필수 불투명" : "일반 후보"));
    row.append(heading, element("p", "candidate-reason", candidate.reason || "원본에서 직접 확인 필요"));
    const exception = exceptions.find((entry) => entry.candidateId === candidate.id);
    const candidateRegion = regions.find((region) => region.candidateId === candidate.id);
    const actions = element("div", "row-actions");
    if (exception) {
      actions.append(element("span", "resolved-label", `공개 예외 · ${exception.actor}`));
      actions.append(actionButton("예외 기록 수정", () => openException(candidate)));
      actions.append(actionButton("다시 가리기", () => acceptCandidate(candidate)));
    } else if (candidateRegion && candidateResolved(candidate)) {
      actions.append(element("span", "resolved-label", "가림 적용됨"));
      actions.append(actionButton("공개 예외로 변경", () => openException(candidate)));
    } else {
      actions.append(element("span", "unresolved-label", candidateRegion ? "후보 전체를 덮도록 조정 필요" : "미해결"));
      actions.append(actionButton("가림 적용", () => acceptCandidate(candidate), "small-button primary"));
      actions.append(actionButton("공개 예외 기록", () => openException(candidate)));
    }
    row.append(actions);
    for (const uncertainty of (state.uncertainties ?? []).filter((entry) => entry.candidateId === candidate.id)) {
      const resolution = manualResolutions.find((entry) => entry.uncertaintyId === uncertainty.id);
      const note = uncertainty.code === "TEXT_RENDER_BOUNDS_UNRESOLVED" ? "글자가 텍스트 상자 밖에 나왔을 수 있습니다."
        : uncertainty.code === "IMAGE_GEOMETRY_UNRESOLVED" ? "회전·그룹 등으로 이미지 위치 확인이 필요합니다."
          : "회전·그룹 등으로 글자의 실제 위치 확인이 필요합니다.";
      row.append(element("p", "candidate-reason", `${note} 항목별로 원본을 실제 크기 이상으로 확인한 뒤 결정하세요.`));
      const manualActions = element("div", "row-actions");
      manualActions.append(element("span", resolution ? "resolved-label" : "unresolved-label", resolution
        ? `${resolution.decision === "opaque_confirmed" ? "불투명 범위 확인" : "비민감 내용 확인"} · ${resolution.actor}` : "위치 불확실 · 개별 확인 필요"));
      manualActions.append(actionButton("원본 영역 100% 확대", () => inspectUncertainty(uncertainty)));
      manualActions.append(actionButton("확대 확인 후 이 항목 기록", () => openManualResolution(uncertainty)));
      row.append(manualActions);
      if (resolution) row.append(element("p", "candidate-reason", `확인 사유: ${resolution.reason}`));
    }
    candidateList.append(row);
  }
}

function renderRegions() {
  regionList.replaceChildren();
  if (!regions.length) {
    regionList.append(element("p", "empty-list", "저장할 가림 영역이 없습니다."));
    return;
  }
  regions.forEach((region, index) => {
    const row = element("li", "region-row");
    const candidate = region.candidateId ? candidateById(region.candidateId) : null;
    row.append(element("span", "region-name", `${index + 1}. ${candidate?.category ?? "수동 영역"}`));
    const mode = element("select", "region-mode");
    const opaque = element("option", "", "불투명 가림");
    opaque.value = "opaque";
    const blur = element("option", "", "강한 흐림");
    blur.value = "blur";
    mode.append(opaque, blur);
    mode.value = region.mode;
    if (candidate?.required) {
      mode.value = "opaque";
      mode.disabled = true;
      mode.title = "필수 정보는 불투명 가림만 허용됩니다.";
    } else {
      mode.addEventListener("change", () => {
        beginMutation();
        region.mode = mode.value === "blur" ? "blur" : "opaque";
        finishMutation("가림 방식을 바꿨습니다. 저장해야 적용됩니다.");
      });
    }
    row.append(mode);
    if (candidate) {
      row.append(actionButton("공개 예외로 변경", () => openException(candidate)));
    } else {
      row.append(actionButton("영역 삭제", () => {
        beginMutation();
        regions = regions.filter((entry) => entry.id !== region.id);
        finishMutation("수동 가림 영역을 삭제했습니다. 저장해야 적용됩니다.");
      }, "small-button danger"));
    }
    regionList.append(row);
  });
}

function renderOverlays() {
  overlay.replaceChildren();
  for (const candidate of state.candidates) {
    if (candidateResolved(candidate)) continue;
    const node = element("div", "candidate-box");
    node.style.left = `${candidate.rect.x * 100}%`;
    node.style.top = `${candidate.rect.y * 100}%`;
    node.style.width = `${candidate.rect.width * 100}%`;
    node.style.height = `${candidate.rect.height * 100}%`;
    node.title = `${candidate.required ? "필수" : "후보"}: ${candidate.category}`;
    overlay.append(node);
  }
  for (const region of regions) {
    const node = element("div", `region-box mode-${region.mode}`);
    node.dataset.regionId = region.id;
    node.style.left = `${region.rect.x * 100}%`;
    node.style.top = `${region.rect.y * 100}%`;
    node.style.width = `${region.rect.width * 100}%`;
    node.style.height = `${region.rect.height * 100}%`;
    const label = element("span", "region-box-label", region.mode === "opaque" ? "불투명" : "흐림");
    const handle = element("span", "resize-handle");
    handle.dataset.resizeHandle = "true";
    handle.setAttribute("aria-hidden", "true");
    node.append(label, handle);
    overlay.append(node);
  }
}

function layoutDecision() {
  return document.querySelector('input[name="layout-decision"]:checked')?.value ?? "";
}

function renderControls() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
  renderButton.disabled = dirty || !state || state.renderBlocked === true
    || state.status === "replacement_required";
  approveButton.disabled = dirty || !state?.output || state.status === "verified";
  afterCompareInput.disabled = dirty || !state?.output;
  replacementNotice.hidden = state?.status !== "replacement_required" && layoutDecision() !== "replace";
  addButton.setAttribute("aria-pressed", String(addMode));
  addButton.textContent = addMode ? "영역 추가 취소" : "사각형 영역 추가";
}

function renderAll() {
  renderCandidates();
  renderRegions();
  renderOverlays();
  renderControls();
}

function pointInOverlay(event) {
  const bounds = overlay.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
  };
}

function acceptCandidate(candidate) {
  beginMutation();
  exceptions = exceptions.filter((entry) => entry.candidateId !== candidate.id);
  const existing = regions.find((region) => region.candidateId === candidate.id);
  if (existing) {
    existing.rect = clone(candidate.rect);
    existing.mode = candidate.required ? "opaque" : (modeInput.value === "blur" ? "blur" : "opaque");
  } else {
    regions.push({
      id: id(),
      candidateId: candidate.id,
      rect: clone(candidate.rect),
      mode: candidate.required ? "opaque" : (modeInput.value === "blur" ? "blur" : "opaque"),
    });
  }
  finishMutation("후보 영역을 가림에 포함했습니다. 저장해야 적용됩니다.");
}

function openException(candidate) {
  exceptionCandidateId = candidate.id;
  const existing = exceptions.find((entry) => entry.candidateId === candidate.id);
  exceptionTarget.textContent = `${candidate.category || "확인 대상"} · ${candidate.reason || candidate.id}`;
  exceptionActor.value = existing?.actor ?? reviewerInput.value.trim();
  exceptionReason.value = existing?.reason ?? "";
  exceptionDialog.showModal();
  exceptionActor.focus();
}

function closeException() {
  exceptionCandidateId = null;
  exceptionDialog.close();
}

function showBefore() {
  beforeCompareInput.checked = true;
  sourceImage.src = `/artifact/${encodeURIComponent(`highres:${slideNumber}`)}`;
  sourceImage.alt = `${slideNumber}번 원본 장표`;
  overlay.hidden = false;
}

function showAfter() {
  if (!state?.output || dirty) {
    showBefore();
    return;
  }
  sourceImage.src = `/redacted/${slideNumber}/${state.output.sha256}`;
  sourceImage.alt = `${slideNumber}번 가림 적용 결과`;
  overlay.hidden = true;
}

function selectedReview() {
  const decision = layoutDecision();
  if (!decision) throw new Error("가림 후 장표를 계속 쓸지 교체할지 선택해 주세요.");
  return {
    reviewer: reviewerInput.value.trim(),
    originalInspected: originalInspectedInput.checked,
    layoutAcceptable: decision === "keep",
  };
}

function allManualChecksDone() {
  return [...document.querySelectorAll("[data-manual-check]")].every((input) => input.checked);
}

function inspectUncertainty(uncertainty) {
  showBefore();
  setZoomPercent(Math.max(100, Number(zoomInput.value)));
  inspectedUncertaintyId = uncertainty.id;
  requestAnimationFrame(() => {
    const bounds = imageStage.getBoundingClientRect();
    const scroller = imageScroller.getBoundingClientRect();
    imageScroller.scrollLeft += bounds.left - scroller.left + (uncertainty.rect.x + uncertainty.rect.width / 2) * bounds.width - scroller.width / 2;
    imageScroller.scrollTop += bounds.top - scroller.top + (uncertainty.rect.y + uncertainty.rect.height / 2) * bounds.height - scroller.height / 2;
  });
  setStatus("확대된 원본에서 실제 글자·이미지 전체 범위를 살펴보세요. 필요하면 가림을 먼저 조정한 뒤, 이 항목의 확대 확인을 다시 눌러 기록하세요.");
}

async function hashRecord(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function currentEditRecord() {
  return {
    regions: regions.map((r) => ({ id: r.id, ...(r.candidateId ? { candidateId: r.candidateId } : {}),
      rect: { x: r.rect.x, y: r.rect.y, width: r.rect.width, height: r.rect.height }, mode: r.mode })),
    exceptions: exceptions.map((e) => ({ candidateId: e.candidateId, actor: e.actor.trim(), reason: e.reason.trim() })),
    review: selectedReview(),
  };
}
function uncertaintyRecord(item) {
  return { id: item.id, candidateId: item.candidateId, code: item.code,
    rect: { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height } };
}

function openManualResolution(uncertainty) {
  if (inspectedUncertaintyId !== uncertainty.id || Number(zoomInput.value) < 100 || !beforeCompareInput.checked
    || !sourceImage.complete || sourceImage.naturalWidth !== state.width) {
    setStatus("먼저 이 항목의 ‘원본 영역 100% 확대’를 눌러 원본을 직접 확인해 주세요.", "error");
    return;
  }
  let review;
  try { review = selectedReview(); } catch (error) { setStatus(error.message, "error"); return; }
  if (!review.reviewer || !review.originalInspected || !review.layoutAcceptable) {
    setStatus("검토자·원본 확대 확인·장표 사용 여부를 먼저 입력하세요. 이 기록이 바뀌면 항목별 확인도 다시 해야 합니다.", "error");
    return;
  }
  const dialog = element("dialog", "exception-dialog");
  const title = element("h2", "", "이 불확실한 항목만 확인");
  const instruction = element("p", "section-help", "글자가 예상 상자 밖으로 넘쳤는지도 확인하세요. 자동 검사 실패 전체를 넘기는 기능이 아닙니다. 비민감으로 확인하면 해당 후보의 가림만 제거합니다. 가림 영역이나 검토 기록이 바뀌면 다른 항목의 확인 기록도 다시 해야 합니다.");
  const decision = element("select", "region-mode");
  for (const [value, label] of [["opaque_confirmed", "민감한 부분 전체를 불투명 영역으로 덮었음"], ["non_sensitive_confirmed", "직접 보니 도형·일반 문구 등 비민감 내용이었음"]]) {
    const option = element("option", "", label); option.value = value; decision.append(option);
  }
  const regionChoice = element("select", "region-mode");
  const availableRegions = regions.filter((entry) => entry.candidateId === uncertainty.candidateId
    && entry.mode === "opaque" && covers(entry.rect, uncertainty.rect));
  for (const entry of availableRegions) {
    const option = element("option", "", `불투명 영역 ${regions.indexOf(entry) + 1}`); option.value = entry.id; regionChoice.append(option);
  }
  const regionLabel = element("label", "field"); regionLabel.append(element("span", "", "실제 내용을 모두 덮은 영역"), regionChoice);
  const reason = element("textarea", ""); reason.maxLength = 500; reason.rows = 4;
  reason.placeholder = "어떤 내용과 범위를 확인했는지 구체적으로 적어 주세요. 민감정보 원문은 적지 마세요. (10자 이상)";
  const reasonLabel = element("label", "field"); reasonLabel.append(element("span", "", "이 항목의 확인 근거"), reason);
  const acknowledgement = element("input", ""); acknowledgement.type = "checkbox";
  const check = element("label", "check"); check.append(acknowledgement, document.createTextNode(" 이 항목을 실제 크기 이상 원본에서 확인했으며, 선택한 결정을 직접 기록합니다."));
  const controls = element("div", "row-actions");
  const cancel = actionButton("취소", () => dialog.close());
  const confirm = actionButton("이 항목 확인 기록", async () => {
    confirm.disabled = true;
    try {
      if (!acknowledgement.checked || reason.value.trim().length < 10) throw new Error("이 항목의 구체적인 확인 근거와 확대 확인 체크가 필요합니다.");
      if (inspectedUncertaintyId !== uncertainty.id || Number(zoomInput.value) < 100) throw new Error("원본을 100% 이상으로 다시 확인해 주세요.");
      if (decision.value === "opaque_confirmed" && !regionChoice.value) throw new Error("확인할 불투명 영역이 없습니다. 후보를 불투명으로 가리고 실제 범위를 조정한 뒤 다시 확인해 주세요.");
      const before = currentEditRecord();
      const edits = clone(before);
      if (decision.value === "non_sensitive_confirmed") {
        edits.regions = edits.regions.filter((entry) => entry.candidateId !== uncertainty.candidateId);
        edits.exceptions = edits.exceptions.filter((entry) => entry.candidateId !== uncertainty.candidateId);
      }
      const revision = state.revision;
      const editHash = await hashRecord(edits);
      const uncertaintyHash = await hashRecord(uncertaintyRecord(uncertainty));
      if (JSON.stringify(before) !== JSON.stringify(currentEditRecord()) || revision !== state.revision) throw new Error("편집 내용이 바뀌었습니다. 이 항목을 다시 확인해 주세요.");
      const record = { uncertaintyId: uncertainty.id, decision: decision.value, actor: edits.review.reviewer,
        reason: reason.value.trim(), inspectedAtActualSize: true, reviewedRevision: revision,
        sourceHash: state.sourceHash, slideContentHash: state.slideContentHash, imageHash: state.imageHash,
        uncertaintyHash, editHash, ...(decision.value === "opaque_confirmed" ? { regionId: regionChoice.value } : {}) };
      if (JSON.stringify(before) !== JSON.stringify(edits)) manualResolutions = [];
      regions = edits.regions;
      exceptions = edits.exceptions;
      manualResolutions = manualResolutions.filter((entry) => entry.uncertaintyId !== uncertainty.id);
      manualResolutions.push(record);
      dirty = true;
      dialog.close();
      renderAll();
      setStatus("이 항목의 확인 근거를 기록했습니다. ‘가림·검토 기록 저장’을 눌러야 저장되며, 블러본 승인과는 별도입니다.", "pending");
    } catch (error) { setStatus(error instanceof Error ? error.message : "확인 기록을 만들지 못했습니다.", "error"); }
    finally { confirm.disabled = false; }
  }, "small-button primary");
  decision.addEventListener("change", () => { regionLabel.hidden = decision.value !== "opaque_confirmed"; });
  controls.append(cancel, confirm);
  dialog.append(title, instruction, element("p", "", `검토자: ${review.reviewer}`), decision, regionLabel, reasonLabel, check, controls);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(pathname, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: options.method === "POST" ? {
      "Content-Type": "application/json",
      "X-Woolim-CSRF": csrfToken,
    } : undefined,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.startsWith("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof body.error === "string"
      ? body.error : "로컬 편집 요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  return body;
}

function applyServerState(nextState) {
  state = nextState;
  regions = clone(state.regions ?? []);
  exceptions = clone(state.exceptions ?? []);
  manualResolutions = clone(state.manualResolutions ?? []);
  inspectedUncertaintyId = null;
  dirty = false;
  undoStack.length = 0;
  redoStack.length = 0;
  reviewerInput.value = state.review?.reviewer ?? "";
  originalInspectedInput.checked = state.review?.originalInspected === true;
  const decision = state.status === "replacement_required" ? "replace"
    : state.review?.layoutAcceptable === true ? "keep" : "";
  for (const input of document.querySelectorAll('input[name="layout-decision"]')) {
    input.checked = input.value === decision;
  }
  outputInspectedInput.checked = false;
  showBefore();
  renderAll();
}

overlay.addEventListener("pointerdown", (event) => {
  if (!state || sourceImage.complete === false) return;
  const regionNode = event.target.closest?.("[data-region-id]");
  if (regionNode) {
    const region = regions.find((entry) => entry.id === regionNode.dataset.regionId);
    if (!region) return;
    beginMutation();
    drag = {
      type: event.target.dataset.resizeHandle === "true" ? "resize" : "move",
      pointerId: event.pointerId,
      regionId: region.id,
      start: pointInOverlay(event),
      original: clone(region.rect),
    };
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (!addMode) return;
  beginMutation();
  const start = pointInOverlay(event);
  const region = { id: id(), rect: { x: start.x, y: start.y, width: 0.002, height: 0.002 }, mode: modeInput.value === "blur" ? "blur" : "opaque" };
  regions.push(region);
  drag = { type: "add", pointerId: event.pointerId, regionId: region.id, start, original: clone(region.rect) };
  overlay.setPointerCapture(event.pointerId);
  renderOverlays();
  event.preventDefault();
});

overlay.addEventListener("pointermove", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const region = regions.find((entry) => entry.id === drag.regionId);
  if (!region) return;
  const point = pointInOverlay(event);
  if (drag.type === "add") {
    region.rect = {
      x: Math.min(drag.start.x, point.x),
      y: Math.min(drag.start.y, point.y),
      width: Math.max(0.002, Math.abs(point.x - drag.start.x)),
      height: Math.max(0.002, Math.abs(point.y - drag.start.y)),
    };
  } else if (drag.type === "move") {
    region.rect.x = clamp(drag.original.x + point.x - drag.start.x, 0, 1 - drag.original.width);
    region.rect.y = clamp(drag.original.y + point.y - drag.start.y, 0, 1 - drag.original.height);
  } else {
    region.rect.width = clamp(drag.original.width + point.x - drag.start.x, 0.002, 1 - drag.original.x);
    region.rect.height = clamp(drag.original.height + point.y - drag.start.y, 0.002, 1 - drag.original.y);
  }
  renderOverlays();
  event.preventDefault();
});

function finishDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const region = regions.find((entry) => entry.id === drag.regionId);
  if (region && !validRect(region.rect)) regions = regions.filter((entry) => entry.id !== region.id);
  overlay.releasePointerCapture?.(event.pointerId);
  drag = null;
  addMode = false;
  finishMutation("가림 영역을 변경했습니다. 저장해야 적용됩니다.");
}
overlay.addEventListener("pointerup", finishDrag);
overlay.addEventListener("pointercancel", finishDrag);

zoomInput.addEventListener("input", () => {
  setZoomPercent(zoomInput.value);
});
fitButton.addEventListener("click", fitImage);

addButton.addEventListener("click", () => {
  addMode = !addMode;
  renderControls();
  setStatus(addMode ? "장표 위에서 가릴 범위를 끌어 그리세요." : "영역 추가를 취소했습니다.");
});

undoButton.addEventListener("click", () => {
  if (!undoStack.length) return;
  redoStack.push(currentSnapshot());
  restoreSnapshot(undoStack.pop());
  setStatus("마지막 영역 변경을 취소했습니다. 저장 전 상태입니다.", "pending");
});

redoButton.addEventListener("click", () => {
  if (!redoStack.length) return;
  undoStack.push(currentSnapshot());
  restoreSnapshot(redoStack.pop());
  setStatus("취소한 영역 변경을 다시 적용했습니다. 저장 전 상태입니다.", "pending");
});

exceptionSave.addEventListener("click", () => {
  const candidate = candidateById(exceptionCandidateId);
  const actor = exceptionActor.value.trim();
  const reason = exceptionReason.value.trim();
  if (!candidate || !actor || !reason) {
    setStatus("공개를 허용한 사람과 구체적인 사유를 모두 입력해 주세요.", "error");
    return;
  }
  beginMutation();
  regions = regions.filter((region) => region.candidateId !== candidate.id);
  exceptions = exceptions.filter((entry) => entry.candidateId !== candidate.id);
  exceptions.push({ candidateId: candidate.id, actor, reason });
  closeException();
  finishMutation("공개 예외를 기록했습니다. 저장해야 적용됩니다.");
});
exceptionCancel.addEventListener("click", closeException);
exceptionDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeException();
});

saveButton.addEventListener("click", async () => {
  try {
    const review = selectedReview();
    setStatus("가림 영역과 검토 기록을 저장하는 중입니다…");
    const response = await requestJson(`/api/redaction/${slideNumber}/save`, {
      method: "POST",
      body: { expectedRevision: state.revision, regions, exceptions, review, manualResolutions },
    });
    applyServerState(response.state);
    const savedMessage = response.state.status === "replacement_required"
      ? "교체 필요로 저장했습니다. 후보표에서 예비 장표를 선택해 주세요."
      : response.state.output
        ? "변경 내용이 같아 기존 블러본을 유지했습니다."
        : "로컬 작업 기록에 저장했습니다. 아직 블러본을 만들거나 승인하지 않았습니다.";
    setStatus(savedMessage, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "저장하지 못했습니다.", "error");
  }
});

renderButton.addEventListener("click", async () => {
  try {
    if (dirty) throw new Error("영역 변경을 먼저 저장해 주세요.");
    if (state.renderBlocked === true) throw new Error("원본 검사에서 확정하지 못한 내용이 있어 이 장표는 보류됩니다. 장표를 교체하거나 원본을 정리한 뒤 다시 변환해 주세요.");
    if (!state.review?.originalInspected || !state.review?.reviewer?.trim()) throw new Error("원본 확대 확인과 검토자 기록이 필요합니다.");
    if (!state.review?.layoutAcceptable) throw new Error("교체 필요 장표는 블러본을 만들 수 없습니다.");
    if (!allManualChecksDone()) throw new Error("작은 글씨·과잉 가림·디자인 유지 확인 항목을 모두 확인해 주세요.");
    const unresolved = state.candidates.filter((candidate) => !candidateResolved(candidate));
    if (unresolved.length) throw new Error(`미해결 가림 후보가 ${unresolved.length}개 있습니다.`);
    const uncertain = (state.uncertainties ?? []).filter((entry) => !manualResolutions.some((resolution) => resolution.uncertaintyId === entry.id));
    if (uncertain.length) throw new Error(`개별 확대 확인 기록이 필요한 항목이 ${uncertain.length}개 있습니다.`);
    setStatus("고해상도 블러본을 만드는 중입니다…");
    const response = await requestJson(`/api/redaction/${slideNumber}/render`, {
      method: "POST",
      body: { expectedRevision: state.revision },
    });
    applyServerState(response.state);
    showAfter();
    afterCompareInput.checked = true;
    setStatus("블러본을 만들었습니다. 적용 후 화면을 확대 확인한 뒤 별도로 승인해 주세요.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "블러본을 만들지 못했습니다.", "error");
  }
});

approveButton.addEventListener("click", async () => {
  try {
    if (dirty || !state.output) throw new Error("최신 저장 내용으로 블러본을 먼저 만들어 주세요.");
    if (!outputInspectedInput.checked) throw new Error("적용 후 화면을 확대 확인했다는 항목을 체크해 주세요.");
    if (!allManualChecksDone()) throw new Error("로컬 수동 확인 항목을 모두 확인해 주세요.");
    const reviewer = reviewerInput.value.trim();
    if (!reviewer) throw new Error("검토자 이름을 입력해 주세요.");
    setStatus("확인한 블러본을 승인하는 중입니다…");
    const response = await requestJson(`/api/redaction/${slideNumber}/approve`, {
      method: "POST",
      body: {
        expectedRevision: state.revision,
        outputHash: state.output.sha256,
        reviewer,
        outputInspected: true,
      },
    });
    applyServerState(response.state);
    showAfter();
    afterCompareInput.checked = true;
    setStatus("이 장표의 로컬 블러본을 승인했습니다. 아직 서버 업로드는 하지 않았습니다.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "승인하지 못했습니다.", "error");
  }
});

beforeCompareInput.addEventListener("change", () => {
  if (beforeCompareInput.checked) showBefore();
});
afterCompareInput.addEventListener("change", () => {
  if (afterCompareInput.checked) showAfter();
});
reviewerInput.addEventListener("input", markReviewDirty);
originalInspectedInput.addEventListener("change", markReviewDirty);
for (const input of document.querySelectorAll('input[name="layout-decision"]')) {
  input.addEventListener("change", markReviewDirty);
}

async function start() {
  if (!Number.isSafeInteger(slideNumber) || slideNumber < 1) {
    setStatus("장표 번호가 올바르지 않습니다.", "error");
    return;
  }
  try {
    const response = await requestJson(`/api/redaction/${slideNumber}`);
    csrfToken = response.csrfToken;
    if (typeof csrfToken !== "string" || csrfToken.length < 32) throw new Error("보안 토큰을 받지 못했습니다.");
    applyServerState(response.state);
    requestAnimationFrame(fitImage);
    if (state.renderBlocked === true) {
      setStatus("원본 검사에서 확정하지 못한 내용이 있어 이 장표는 보류됩니다. 장표를 교체하거나 원본을 정리한 뒤 다시 변환해 주세요.", "error");
    } else {
      setStatus("고해상도 원본을 확대해 후보와 작은 글씨를 직접 확인해 주세요.");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "로컬 편집 기록을 불러오지 못했습니다.", "error");
  }
}

start();
