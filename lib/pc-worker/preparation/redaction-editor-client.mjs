"use strict";

const slideNumber = Number(document.body.dataset.sourceSlideNumber);
const sourceImage = document.querySelector("#source-image");
const overlay = document.querySelector("#redaction-overlay");
const imageStage = document.querySelector("#image-stage");
const imageScroller = document.querySelector(".image-scroller");
const statusNode = document.querySelector("#editor-status");
const warningList = document.querySelector("#redaction-warnings");
const regionList = document.querySelector("#region-list");
const zoomInput = document.querySelector("#zoom");
const zoomLabel = document.querySelector("#zoom-label");
const fitButton = document.querySelector("#fit-image");
const modeInput = document.querySelector("#mask-mode");
const addButton = document.querySelector("#add-region");
const copyButton = document.querySelector("#copy-previous-regions");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const saveButton = document.querySelector("#save-redaction");
const approveButton = document.querySelector("#approve-redaction");
const reviewerInput = document.querySelector("#reviewer");
const afterCompareInput = document.querySelector("#compare-after");
const beforeCompareInput = document.querySelector("#compare-before");
const replacementNotice = document.querySelector("#replacement-notice");

let csrfToken = "";
let state = null;
let previousSavedSlide = null;
let regions = [];
let dirty = false;
let busy = false;
let addMode = false;
let drag = null;
let hoveredRegion = null;
let focusedRegion = null;
const undoStack = [];
const redoStack = [];

function setStatus(message, kind = "info") {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function id() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function validRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= 1.0000001 && rect.y + rect.height <= 1.0000001;
}
function requiredRegion(region) {
  return Boolean(region.candidateId && state?.candidates?.some((entry) => entry.id === region.candidateId && entry.required));
}
function previousManualRegions() {
  return (previousSavedSlide?.regions ?? []).filter((region) => !region.candidateId && validRect(region.rect)
    && ["opaque", "blur"].includes(region.mode));
}
function setZoomPercent(value) {
  const zoom = clamp(Math.round(Number(value) || 100), 10, 400);
  zoomInput.value = String(zoom);
  if (Number.isFinite(state?.width) && state.width > 0) imageStage.style.width = `${Math.max(1, Math.round(state.width * zoom / 100))}px`;
  zoomLabel.textContent = `확대 ${zoom}% · 100%=실제크기`;
}
function fitImage() {
  if (!state || !Number.isFinite(state.width) || state.width <= 0) return;
  const style = getComputedStyle(imageScroller);
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  setZoomPercent(Math.min(100, Math.floor(Math.max(1, imageScroller.clientWidth - padding) / state.width * 100)));
}
function currentSnapshot() { return JSON.stringify(regions); }
function beginMutation() {
  undoStack.push(currentSnapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}
function finishMutation(message) {
  dirty = true;
  showBefore();
  renderAll();
  setStatus(message, "pending");
}
function restoreSnapshot(snapshot) {
  regions = JSON.parse(snapshot);
  finishMutation("가림 영역을 바꿨습니다. 저장해야 적용됩니다.");
}
function markReviewDirty() {
  if (!state || busy) return;
  finishMutation("검토 기록이 바뀌었습니다. 저장하고 블러본을 만들어 주세요.");
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
  button.disabled = busy;
  button.addEventListener("click", () => { if (!busy) onClick(); });
  return button;
}
function bindLocator(node, regionId) {
  node.dataset.locatorId = regionId;
  node.addEventListener("pointerenter", () => { hoveredRegion = regionId; renderLocatorHighlights(); });
  node.addEventListener("pointerleave", () => { if (hoveredRegion === regionId) hoveredRegion = null; renderLocatorHighlights(); });
  node.addEventListener("focusin", () => { focusedRegion = regionId; renderLocatorHighlights(); });
  node.addEventListener("focusout", (event) => {
    if (node.contains(event.relatedTarget)) return;
    if (focusedRegion === regionId) focusedRegion = null;
    renderLocatorHighlights();
  });
}
function renderLocatorHighlights() {
  for (const node of [...regionList.querySelectorAll(".region-row"), ...overlay.querySelectorAll(".region-box")]) {
    node.classList.toggle("locator-active", node.dataset.locatorId === hoveredRegion || node.dataset.locatorId === focusedRegion);
  }
}
function navigateToRect(rect) {
  requestAnimationFrame(() => {
    imageScroller.scrollIntoView({ block: "nearest", inline: "nearest" });
    const bounds = imageStage.getBoundingClientRect();
    const scroller = imageScroller.getBoundingClientRect();
    imageScroller.scrollLeft += bounds.left - scroller.left + (rect.x + rect.width / 2) * bounds.width - scroller.width / 2;
    imageScroller.scrollTop += bounds.top - scroller.top + (rect.y + rect.height / 2) * bounds.height - scroller.height / 2;
  });
}
function renderRegions() {
  regionList.replaceChildren();
  if (!regions.length) regionList.append(element("p", "empty-list", "저장할 가림 영역이 없습니다."));
  regions.forEach((region, index) => {
    const locked = requiredRegion(region);
    const row = element("li", "region-row");
    bindLocator(row, region.id);
    row.dataset.regionId = region.id;
    row.append(actionButton(`${index + 1}. ${locked ? "필수 불투명 영역" : "수동 영역"}`, () => navigateToRect(region.rect), "region-name locator-button"));
    const mode = element("select", "region-mode");
    const opaque = element("option", "", "불투명 가림"); opaque.value = "opaque";
    const blur = element("option", "", "강한 흐림"); blur.value = "blur";
    mode.append(opaque, blur);
    mode.value = region.mode;
    mode.disabled = locked || busy;
    if (locked) mode.title = "필수 정보의 자동 불투명 영역은 변경하거나 지울 수 없습니다.";
    else mode.addEventListener("change", () => {
      if (busy) return;
      beginMutation();
      region.mode = mode.value === "blur" ? "blur" : "opaque";
      finishMutation("가림 방식을 바꿨습니다. 저장해야 적용됩니다.");
    });
    row.append(mode);
    if (!locked) row.append(actionButton("영역 삭제", () => {
      beginMutation();
      regions = regions.filter((entry) => entry.id !== region.id);
      finishMutation("수동 가림 영역을 삭제했습니다. 저장해야 적용됩니다.");
    }, "small-button danger"));
    regionList.append(row);
  });
}
function renderOverlays() {
  overlay.replaceChildren();
  for (const [index, region] of regions.entries()) {
    const locked = requiredRegion(region);
    const node = element("div", `region-box mode-${region.mode}${locked ? " region-locked" : ""}`);
    bindLocator(node, region.id);
    node.dataset.regionId = region.id;
    node.style.left = `${region.rect.x * 100}%`;
    node.style.top = `${region.rect.y * 100}%`;
    node.style.width = `${region.rect.width * 100}%`;
    node.style.height = `${region.rect.height * 100}%`;
    node.append(element("span", "region-box-label", `${index + 1} ${locked ? "필수 불투명" : region.mode === "opaque" ? "불투명" : "흐림"}`));
    if (!locked) {
      const handle = element("span", "resize-handle");
      handle.dataset.resizeHandle = "true";
      handle.setAttribute("aria-hidden", "true");
      node.append(handle);
    }
    overlay.append(node);
  }
  renderLocatorHighlights();
}
function layoutDecision() { return document.querySelector('input[name="layout-decision"]:checked')?.value ?? ""; }
function renderControls() {
  undoButton.disabled = busy || undoStack.length === 0;
  redoButton.disabled = busy || redoStack.length === 0;
  saveButton.disabled = busy || !state || Boolean(drag);
  copyButton.hidden = previousManualRegions().length === 0;
  copyButton.disabled = busy || !state;
  addButton.disabled = busy || !state;
  modeInput.disabled = busy;
  reviewerInput.disabled = busy;
  for (const input of document.querySelectorAll('input[name="layout-decision"]')) input.disabled = busy;
  approveButton.disabled = busy || dirty || !state?.output || state.status === "verified";
  approveButton.textContent = state?.status === "verified" && !dirty ? "이 장표는 승인됨" : "블러본을 확인했고 승인합니다";
  afterCompareInput.disabled = dirty || !state?.output;
  replacementNotice.hidden = state?.status !== "replacement_required" && layoutDecision() !== "replace";
  addButton.setAttribute("aria-pressed", String(addMode));
  addButton.textContent = addMode ? "영역 추가 취소" : "사각형 영역 추가";
}
function renderAll() {
  warningList.replaceChildren();
  for (const warning of state.warnings ?? []) warningList.append(element("li", "", warning));
  warningList.hidden = warningList.childElementCount === 0;
  renderRegions(); renderOverlays(); renderControls();
}
function showBefore() {
  beforeCompareInput.checked = true;
  sourceImage.src = `/artifact/${encodeURIComponent(`highres:${slideNumber}`)}`;
  sourceImage.alt = `${slideNumber}번 원본 장표`;
  overlay.hidden = false;
}
function showAfter() {
  if (!state?.output || dirty) { showBefore(); return; }
  afterCompareInput.checked = true;
  sourceImage.src = `/redacted/${slideNumber}/${state.output.sha256}`;
  sourceImage.alt = `${slideNumber}번 가림 적용 결과`;
  overlay.hidden = true;
}
function selectedReview() {
  const reviewer = reviewerInput.value.trim();
  if (!reviewer) throw new Error("검토자 이름을 입력해 주세요.");
  const decision = layoutDecision();
  if (!decision) throw new Error("가림 후 장표를 계속 쓸지 교체할지 선택해 주세요.");
  return { reviewer, layoutAcceptable: decision === "keep" };
}
async function requestJson(pathname, options = {}) {
  const response = await fetch(pathname, {
    method: options.method ?? "GET", credentials: "same-origin",
    headers: options.method === "POST" ? { "Content-Type": "application/json", "X-Woolim-CSRF": csrfToken } : undefined,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.startsWith("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body && typeof body === "object" && typeof body.error === "string" ? body.error : "로컬 편집 요청을 처리하지 못했습니다.");
  return body;
}
function applyServerState(nextState) {
  state = nextState;
  regions = clone(state.regions ?? []);
  dirty = false;
  addMode = false;
  undoStack.length = 0;
  redoStack.length = 0;
  reviewerInput.value = state.review?.reviewer || previousSavedSlide?.reviewer || "";
  const decision = state.status === "replacement_required" || state.review?.layoutAcceptable === false ? "replace" : "keep";
  for (const input of document.querySelectorAll('input[name="layout-decision"]')) input.checked = input.value === decision;
  showBefore(); renderAll();
}
function pointInOverlay(event) {
  const bounds = overlay.getBoundingClientRect();
  return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
}
overlay.addEventListener("pointerdown", (event) => {
  if (!state || busy || overlay.hidden || sourceImage.complete === false) return;
  const regionNode = event.target.closest?.("[data-region-id]");
  if (regionNode) {
    const region = regions.find((entry) => entry.id === regionNode.dataset.regionId);
    if (!region || requiredRegion(region)) return;
    beginMutation();
    drag = { type: event.target.dataset.resizeHandle === "true" ? "resize" : "move", pointerId: event.pointerId, regionId: region.id, start: pointInOverlay(event), original: clone(region.rect) };
  } else {
    if (!addMode) return;
    beginMutation();
    const start = pointInOverlay(event);
    const region = { id: id(), rect: { x: start.x, y: start.y, width: 0.002, height: 0.002 }, mode: modeInput.value === "blur" ? "blur" : "opaque" };
    regions.push(region);
    drag = { type: "add", pointerId: event.pointerId, regionId: region.id, start, original: clone(region.rect) };
  }
  overlay.setPointerCapture(event.pointerId);
  renderOverlays(); renderControls(); event.preventDefault();
});
overlay.addEventListener("pointermove", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const region = regions.find((entry) => entry.id === drag.regionId);
  if (!region || requiredRegion(region)) return;
  const point = pointInOverlay(event);
  if (drag.type === "add") region.rect = { x: Math.min(drag.start.x, point.x), y: Math.min(drag.start.y, point.y), width: Math.max(0.002, Math.abs(point.x - drag.start.x)), height: Math.max(0.002, Math.abs(point.y - drag.start.y)) };
  else if (drag.type === "move") {
    region.rect.x = clamp(drag.original.x + point.x - drag.start.x, 0, 1 - drag.original.width);
    region.rect.y = clamp(drag.original.y + point.y - drag.start.y, 0, 1 - drag.original.height);
  } else {
    region.rect.width = clamp(drag.original.width + point.x - drag.start.x, 0.002, 1 - drag.original.x);
    region.rect.height = clamp(drag.original.height + point.y - drag.start.y, 0.002, 1 - drag.original.y);
  }
  renderOverlays(); event.preventDefault();
});
function finishDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const region = regions.find((entry) => entry.id === drag.regionId);
  if (region && !validRect(region.rect)) regions = regions.filter((entry) => entry.id !== region.id);
  overlay.releasePointerCapture?.(event.pointerId);
  drag = null; addMode = false;
  finishMutation("가림 영역을 변경했습니다. 저장해야 적용됩니다.");
}
overlay.addEventListener("pointerup", finishDrag);
overlay.addEventListener("pointercancel", finishDrag);
zoomInput.addEventListener("input", () => setZoomPercent(zoomInput.value));
fitButton.addEventListener("click", fitImage);
addButton.addEventListener("click", () => {
  if (busy) return;
  addMode = !addMode;
  if (addMode) showBefore();
  renderControls();
  setStatus(addMode ? "장표 위에서 가릴 범위를 끌어 그리세요." : "영역 추가를 취소했습니다.");
});
copyButton.addEventListener("click", () => {
  if (busy) return;
  const previous = previousManualRegions();
  if (!previous.length) return;
  beginMutation();
  regions.push(...previous.map((region) => ({ id: id(), rect: clone(region.rect), mode: region.mode })));
  finishMutation("앞 장표의 수동 가림 영역을 넣었습니다. 위치와 크기를 바꾸거나 지울 수 있습니다.");
});
undoButton.addEventListener("click", () => {
  if (busy || !undoStack.length) return;
  redoStack.push(currentSnapshot()); restoreSnapshot(undoStack.pop());
  setStatus("마지막 영역 변경을 취소했습니다. 저장 전 상태입니다.", "pending");
});
redoButton.addEventListener("click", () => {
  if (busy || !redoStack.length) return;
  undoStack.push(currentSnapshot()); restoreSnapshot(redoStack.pop());
  setStatus("취소한 영역 변경을 다시 적용했습니다. 저장 전 상태입니다.", "pending");
});
saveButton.addEventListener("click", async () => {
  if (busy || !state || drag) return;
  try {
    const review = selectedReview();
    busy = true; renderAll();
    setStatus("가림 영역과 검토자 기록을 저장하는 중입니다…");
    const saved = await requestJson(`/api/redaction/${slideNumber}/save`, { method: "POST", body: { expectedRevision: state.revision, regions, exceptions: state.exceptions ?? [], review } });
    applyServerState(saved.state);
    if (!state.review.layoutAcceptable || state.status === "replacement_required") {
      setStatus("교체 필요로 저장했습니다. 후보표에서 예비 장표를 선택해 주세요.", "success");
      return;
    }
    if (state.renderBlocked === true) throw new Error("원본 검사에서 확정하지 못한 내용이 있어 이 장표는 보류됩니다. 장표를 교체하거나 원본을 정리한 뒤 다시 변환해 주세요.");
    setStatus("고해상도 블러본을 만드는 중입니다…");
    const rendered = await requestJson(`/api/redaction/${slideNumber}/render`, { method: "POST", body: { expectedRevision: state.revision } });
    applyServerState(rendered.state); showAfter();
    setStatus(state.status === "verified" ? "이미 승인된 블러본을 유지했습니다." : "블러본을 만들었습니다. 화면을 확인한 뒤 승인해 주세요.", "success");
  } catch (error) { setStatus(error instanceof Error ? error.message : "저장하고 블러본을 만들지 못했습니다.", "error"); }
  finally { busy = false; renderAll(); }
});
approveButton.addEventListener("click", async () => {
  if (busy) return;
  try {
    if (dirty || !state?.output) throw new Error("최신 저장 내용으로 블러본을 먼저 만들어 주세요.");
    const reviewer = reviewerInput.value.trim();
    if (!reviewer) throw new Error("검토자 이름을 입력해 주세요.");
    busy = true; renderAll();
    setStatus("확인한 블러본을 승인하는 중입니다…");
    const response = await requestJson(`/api/redaction/${slideNumber}/approve`, { method: "POST", body: { expectedRevision: state.revision, outputHash: state.output.sha256, reviewer, outputInspected: true } });
    applyServerState(response.state); showAfter();
    setStatus("이 장표의 로컬 블러본을 승인했습니다. 아직 서버 업로드는 하지 않았습니다.", "success");
  } catch (error) { setStatus(error instanceof Error ? error.message : "승인하지 못했습니다.", "error"); }
  finally { busy = false; renderAll(); }
});
beforeCompareInput.addEventListener("change", () => { if (beforeCompareInput.checked) showBefore(); });
afterCompareInput.addEventListener("change", () => { if (afterCompareInput.checked) showAfter(); });
reviewerInput.addEventListener("input", markReviewDirty);
for (const input of document.querySelectorAll('input[name="layout-decision"]')) input.addEventListener("change", markReviewDirty);
async function start() {
  if (!Number.isSafeInteger(slideNumber) || slideNumber < 1) { setStatus("장표 번호가 올바르지 않습니다.", "error"); return; }
  try {
    const response = await requestJson(`/api/redaction/${slideNumber}`);
    csrfToken = response.csrfToken;
    if (typeof csrfToken !== "string" || csrfToken.length < 32) throw new Error("보안 토큰을 받지 못했습니다.");
    previousSavedSlide = response.previousSavedSlide ?? null;
    applyServerState(response.state);
    if (state.output) showAfter();
    requestAnimationFrame(fitImage);
    setStatus(state.renderBlocked === true ? "원본 검사에서 확정하지 못한 내용이 있어 이 장표는 보류됩니다. 장표를 교체하거나 원본을 정리한 뒤 다시 변환해 주세요."
      : state.status === "verified" ? `이 장표는 ${state.output?.approvedBy ?? state.review.reviewer} 검토자가 승인했습니다.` : "가릴 자리에 사각형을 그린 뒤 저장하고 블러본을 만들어 주세요.", state.renderBlocked === true ? "error" : "info");
  } catch (error) { setStatus(error instanceof Error ? error.message : "로컬 편집 기록을 불러오지 못했습니다.", "error"); }
}
start();
