"use strict";

const statusNode = document.querySelector("#mockup-status");
const titleInput = document.querySelector("#mockup-title");
const titleConfirmedInput = document.querySelector("#mockup-title-confirmed");
const initializeButton = document.querySelector("#initialize-mockups");
const saveButton = document.querySelector("#save-assignments");
const draftButton = document.querySelector("#render-draft");
const finalButton = document.querySelector("#render-final");
const debugInput = document.querySelector("#show-debug");
const boardList = document.querySelector("#mockup-boards");
const candidateList = document.querySelector("#mockup-candidates");
const requestList = document.querySelector("#preparation-requests");
const minimumNode = document.querySelector("#minimum-slides");
const previewDialog = document.querySelector("#mockup-preview-dialog");
const previewImage = document.querySelector("#mockup-preview-image");
const previewTitle = document.querySelector("#mockup-preview-title");
const previewClose = document.querySelector("#mockup-preview-close");
const requestDialog = document.querySelector("#preparation-request-dialog");
const requestTarget = document.querySelector("#preparation-request-target");
const requestReason = document.querySelector("#preparation-request-reason");
const requestSave = document.querySelector("#preparation-request-save");
const requestCancel = document.querySelector("#preparation-request-cancel");
const thumbnailTitleStatus = document.querySelector("#thumbnail-title-status");
const thumbnailMainInput = document.querySelector("#thumbnail-main-title");
const thumbnailSubInput = document.querySelector("#thumbnail-sub-title");
const thumbnailShowSubInput = document.querySelector("#thumbnail-show-sub");
const thumbnailSaveButton = document.querySelector("#save-thumbnail-title");
const thumbnailDraftButton = document.querySelector("#preview-thumbnail-title");
const thumbnailFinalButton = document.querySelector("#render-thumbnail-title");
const thumbnailRefreshButton = document.querySelector("#refresh-thumbnail-title");
const thumbnailConfirmButton = document.querySelector("#confirm-thumbnail-title");
const thumbnailInspectedInput = document.querySelector("#thumbnail-title-inspected");
const thumbnailCandidateFrame = document.querySelector("#thumbnail-title-candidate");
const thumbnailActiveFrame = document.querySelector("#thumbnail-title-active");

let csrfToken = "";
let review = null;
let assignments = [];
let dirty = false;
let titleConfirmed = false;
let requestSlideNumber = null;
let busy = false;
let thumbnailTitleReview = null;
let thumbnailTitleDirty = false;
let thumbnailOpenedFinalHash = null;

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setStatus(message, kind = "info") {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

function candidateLabel(candidate) {
  const title = candidate.title?.trim() || `${candidate.sourceSlideNumber}번 장표`;
  if (candidate.status === "approved") return `${candidate.sourceSlideNumber}번 · ${title} · 가림 승인 완료`;
  if (candidate.status === "needs_redaction") return `${candidate.sourceSlideNumber}번 · ${title} · 가림 승인 필요`;
  return `${candidate.sourceSlideNumber}번 · ${title} · 고해상도 준비 필요`;
}

function statusLabel(status) {
  if (status === "approved") return "목업 사용 가능";
  if (status === "needs_redaction") return "가림 승인 필요";
  return "고해상도 준비 필요";
}

function boardAssignment(templateId) {
  return assignments.find((board) => board.templateId === templateId) ?? null;
}

function duplicateSlides(board) {
  const counts = new Map();
  for (const slot of board.slots) {
    if (slot.sourceSlideNumber === null) continue;
    counts.set(slot.sourceSlideNumber, (counts.get(slot.sourceSlideNumber) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([slide]) => slide));
}

function assignmentProblems() {
  let missing = 0;
  let duplicates = 0;
  let unavailable = 0;
  for (const board of assignments) {
    const duplicate = duplicateSlides(board);
    duplicates += duplicate.size;
    for (const slot of board.slots) {
      if (slot.sourceSlideNumber === null) {
        missing += 1;
        continue;
      }
      const candidate = review?.candidates.find((entry) => entry.sourceSlideNumber === slot.sourceSlideNumber);
      if (candidate?.status !== "approved") unavailable += 1;
    }
  }
  return { missing, duplicates, unavailable };
}

function imageUrl(board, kind, debug = false) {
  const record = board[kind];
  if (!record) return null;
  const suffix = debug ? "/debug" : "";
  return `/mockup-image/${encodeURIComponent(board.templateId)}/${kind}/${record.sha256}${suffix}`;
}

function sourceUrl(candidate) {
  return candidate.status === "approved" && candidate.imageHash
    ? `/mockup-source/${candidate.sourceSlideNumber}/${candidate.imageHash}`
    : null;
}

function openPreview(board, kind) {
  const url = imageUrl(board, kind, debugInput.checked);
  if (!url) return;
  previewTitle.textContent = `${board.label} · ${kind === "final" ? "최종본" : "초안"}${debugInput.checked ? " · 검사용 표시" : ""}`;
  previewImage.dataset.titleCandidateHash = "";
  previewImage.src = url;
  previewImage.alt = previewTitle.textContent;
  previewDialog.showModal();
}

function renderCandidates() {
  candidateList.replaceChildren();
  for (const candidate of review.candidates) {
    const card = element("article", `mockup-candidate candidate-${candidate.status}`);
    const image = sourceUrl(candidate);
    if (image) {
      const thumbnail = document.createElement("img");
      thumbnail.src = image;
      thumbnail.alt = `${candidate.sourceSlideNumber}번 승인 블러본`;
      card.append(thumbnail);
    } else {
      card.append(element("div", "candidate-placeholder", "외부 전송 없는 로컬 준비 대기"));
    }
    card.append(
      element("strong", "candidate-title", `${candidate.sourceSlideNumber}번 · ${candidate.title || "제목 없음"}`),
      element("span", "candidate-status", statusLabel(candidate.status)),
    );
    if (candidate.reason) card.append(element("p", "candidate-note", "이 장표는 추가 준비가 필요합니다."));
    if (candidate.status !== "approved") {
      const button = element("button", "small-button", "이 장표 준비 요청");
      button.type = "button";
      button.disabled = busy || dirty;
      button.addEventListener("click", () => openPreparationRequest(candidate));
      card.append(button);
    }
    candidateList.append(card);
  }
  if (!review.candidates.length) candidateList.append(element("p", "empty-list", "배정할 수 있는 장표가 없습니다."));
}

function slotSelect(board, slot, duplicate) {
  const row = element("label", `mockup-slot${duplicate ? " duplicate-slot" : ""}`);
  const label = element("span", "slot-label", `${slot.position}. ${slot.role}`);
  const select = document.createElement("select");
  select.dataset.templateId = board.templateId;
  select.dataset.slotId = slot.slotId;
  select.disabled = busy;
  select.setAttribute("aria-label", `${board.label} ${slot.position}번 슬롯 장표`);
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "장표 선택 필요";
  select.append(empty);
  for (const candidate of review.candidates) {
    const option = document.createElement("option");
    option.value = String(candidate.sourceSlideNumber);
    option.textContent = candidateLabel(candidate);
    option.disabled = candidate.status !== "approved";
    option.selected = slot.sourceSlideNumber === candidate.sourceSlideNumber;
    select.append(option);
  }
  select.addEventListener("change", () => {
    const assignment = boardAssignment(board.templateId)?.slots.find((entry) => entry.slotId === slot.slotId);
    if (!assignment) return;
    assignment.sourceSlideNumber = select.value ? Number(select.value) : null;
    dirty = true;
    renderBoards();
    renderControls();
    setStatus("배정이 바뀌었습니다. 먼저 배정표를 저장해 주세요.", "pending");
  });
  row.append(label, select);
  if (duplicate) row.append(element("b", "duplicate-label", "같은 목업 안에서 중복됨"));
  return row;
}

function renderBoardImage(board, card) {
  const kind = board.final ? "final" : board.draft ? "draft" : null;
  const frame = element("div", "mockup-board-image");
  if (!kind) {
    frame.append(element("div", "mockup-placeholder", "아직 만든 목업이 없습니다."));
  } else {
    const image = document.createElement("img");
    image.src = imageUrl(board, kind, debugInput.checked);
    image.alt = `${board.label} ${kind === "final" ? "최종본" : "초안"}`;
    const enlarge = element("button", "image-enlarge", "크게 보기");
    enlarge.type = "button";
    enlarge.addEventListener("click", () => openPreview(board, kind));
    frame.append(image, enlarge);
  }
  card.append(frame);
  const imageActions = element("div", "board-image-actions");
  imageActions.append(element("span", "image-kind", kind === "final" ? "현재 최종본" : kind === "draft" ? "현재 초안" : "미제작"));
  if (board.final) {
    const download = element("a", "download-link", "최종 PNG 내려받기");
    download.href = `${imageUrl(board, "final", false)}/download`;
    download.download = `${board.templateId}.png`;
    imageActions.append(download);
  }
  card.append(imageActions);
}

function renderBoards() {
  boardList.replaceChildren();
  for (const board of review.boards) {
    const assignment = boardAssignment(board.templateId) ?? { templateId: board.templateId, slots: clone(board.slots) };
    const duplicates = duplicateSlides(assignment);
    const card = element("article", `mockup-board${duplicates.size ? " board-blocked" : ""}`);
    const heading = element("header", "mockup-board-head");
    heading.append(element("h2", "", board.label), element("span", "template-lock", "승인 좌표 고정"));
    card.append(heading);
    renderBoardImage(board, card);
    const slots = element("div", "mockup-slots");
    for (const definition of board.slots) {
      const selected = assignment.slots.find((entry) => entry.slotId === definition.slotId)?.sourceSlideNumber ?? null;
      slots.append(slotSelect(board, { ...definition, sourceSlideNumber: selected }, selected !== null && duplicates.has(selected)));
    }
    card.append(slots);
    if (duplicates.size) card.append(element("p", "board-hold", "같은 목업 안의 중복 장표를 바꿔야 저장·제작할 수 있습니다."));
    for (const hold of board.holds) card.append(element("p", "board-hold", hold));
    boardList.append(card);
  }
}

function renderRequests() {
  requestList.replaceChildren();
  for (const request of review.requests) {
    const row = element("li", `request-${request.status}`);
    row.append(
      element("strong", "", `${request.sourceSlideNumber}번 · ${request.status === "ready" ? "준비 완료" : "로컬 요청 대기"}`),
      element("span", "", request.reason),
    );
    requestList.append(row);
  }
  if (!review.requests.length) requestList.append(element("li", "empty-list", "기록된 준비 요청이 없습니다."));
}

function renderControls() {
  if (!review) return;
  const initialized = review.state?.initialized === true;
  const titleReady = Boolean(titleInput.value.trim()) && titleConfirmed;
  const problems = assignmentProblems();
  const assignmentReady = initialized && !dirty && problems.missing === 0
    && problems.duplicates === 0 && problems.unavailable === 0;
  titleInput.disabled = busy;
  titleConfirmedInput.disabled = busy;
  requestSave.disabled = busy;
  for (const select of boardList.querySelectorAll("select")) select.disabled = busy;
  initializeButton.hidden = initialized;
  initializeButton.disabled = busy || initialized || !titleReady;
  saveButton.hidden = !initialized;
  saveButton.disabled = busy || !initialized || !dirty || !titleReady || problems.duplicates > 0;
  draftButton.disabled = busy || !assignmentReady || !titleReady;
  finalButton.disabled = busy || !assignmentReady || !titleReady || review.boards.some((board) => !board.draft);
  renderThumbnailTitleControls();
}

function applyReview(nextReview, options = {}) {
  const confirmedTitle = titleConfirmed ? titleInput.value.trim() : null;
  review = nextReview;
  assignments = review.boards.map((board) => ({
    templateId: board.templateId,
    slots: board.slots.map((slot) => ({ slotId: slot.slotId, sourceSlideNumber: slot.sourceSlideNumber })),
  }));
  dirty = false;
  titleInput.value = review.title ?? "";
  titleConfirmed = options.keepTitleConfirmation === true && confirmedTitle === titleInput.value.trim();
  titleConfirmedInput.checked = titleConfirmed;
  minimumNode.textContent = `이 규격은 서로 다른 승인 장표가 최소 ${review.minimum}장 필요합니다.${review.sourceFitNotice ? ` ${review.sourceFitNotice}` : ""}`;
  renderCandidates();
  renderBoards();
  renderRequests();
  renderControls();
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
      ? body.error : "로컬 목업 요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  return body;
}

async function mutate(action, body, progress, success) {
  if (busy) return;
  busy = true;
  renderCandidates();
  renderBoards();
  renderControls();
  try {
    setStatus(progress);
    const response = await requestJson(`/api/mockups/${action}`, { method: "POST", body });
    applyReview(response.review, { keepTitleConfirmation: true });
    await refreshThumbnailTitleReview({ preserveFields: true });
    setStatus(success, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "로컬 목업 요청을 처리하지 못했습니다.";
    let refreshed = false;
    if (action === "render") {
      try {
        const latest = await requestJson("/api/mockups");
        applyReview(latest.review, { keepTitleConfirmation: true });
        refreshed = true;
      } catch {
        // Keep the last visible local state when even the read-only refresh is unavailable.
      }
    }
    setStatus(`${message}${refreshed
      ? " 완료된 로컬 체크포인트를 다시 불러왔습니다."
      : action === "save" ? " 입력 중인 배정은 화면에 유지했습니다. 상태 충돌이면 화면을 새로 열어 다시 확인해 주세요." : ""}`, "error");
  } finally {
    busy = false;
    renderCandidates();
    renderBoards();
    renderControls();
  }
}

titleInput.addEventListener("input", () => {
  titleConfirmed = false;
  titleConfirmedInput.checked = false;
  if (review?.state?.initialized) dirty = true;
  renderControls();
  setStatus("작업물명을 확인하고 다시 승인해 주세요.", "pending");
});

titleConfirmedInput.addEventListener("change", () => {
  titleConfirmed = titleConfirmedInput.checked;
  renderControls();
});

initializeButton.addEventListener("click", () => {
  mutate("initialize", { title: titleInput.value.trim() }, "최초 배정표를 만드는 중입니다…", "승인된 장표로 최초 배정표를 만들었습니다. 부족한 슬롯을 확인해 주세요.");
});

saveButton.addEventListener("click", () => {
  mutate("save", {
    expectedRevision: review.revision,
    title: titleInput.value.trim(),
    boards: assignments,
  }, "배정표를 저장하는 중입니다…", "배정표를 로컬 작업 기록에 저장했습니다.");
});

draftButton.addEventListener("click", () => {
  mutate("render", { expectedRevision: review.revision, scale: 0.5 }, "저해상도 초안 5장을 만드는 중입니다…", "같은 배정표로 저해상도 초안 5장을 만들었습니다.");
});

finalButton.addEventListener("click", () => {
  mutate("render", { expectedRevision: review.revision, scale: 1 }, "고해상도 최종본 5장을 만드는 중입니다…", "초안과 같은 배정표로 고해상도 최종본 5장을 만들었습니다.");
});

debugInput.addEventListener("change", () => {
  renderBoards();
  setStatus(debugInput.checked
    ? "검사용 슬롯·원본 번호·기준선을 표시합니다. 내려받는 최종 PNG에는 표시되지 않습니다."
    : "공개 이미지와 같은 일반 화면을 표시합니다.");
});

previewClose.addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("cancel", () => {
  previewImage.removeAttribute("src");
});
previewDialog.addEventListener("close", () => {
  previewImage.removeAttribute("src");
});

function openPreparationRequest(candidate) {
  if (dirty) {
    setStatus("바뀐 배정표를 먼저 저장한 뒤 새 장표 준비 요청을 기록해 주세요.", "error");
    return;
  }
  requestSlideNumber = candidate.sourceSlideNumber;
  requestTarget.textContent = `${candidate.sourceSlideNumber}번 · ${candidate.title || "제목 없음"}`;
  requestReason.value = "";
  requestDialog.showModal();
}

function closePreparationRequest() {
  requestSlideNumber = null;
  requestDialog.close();
}

requestCancel.addEventListener("click", closePreparationRequest);
requestDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closePreparationRequest();
});
requestSave.addEventListener("click", async () => {
  const reason = requestReason.value.trim();
  if (!Number.isSafeInteger(requestSlideNumber) || !reason) {
    setStatus("준비할 장표와 구체적인 사유를 확인해 주세요.", "error");
    return;
  }
  requestDialog.close();
  await mutate("request", {
    expectedRevision: review.revision,
    sourceSlideNumber: requestSlideNumber,
    reason,
  }, "PC 내부 준비 요청을 기록하는 중입니다…", "준비 요청만 로컬에 기록했습니다. 자동 처리와 아직 연결되지 않았고 워커 실행이나 외부 전송도 하지 않았습니다.");
  requestSlideNumber = null;
});

function thumbnailInputSpec() {
  const normalize = (value) => value.normalize("NFC").trim().replace(/[ \t]+/g, " ");
  return {
    main: normalize(thumbnailMainInput.value),
    sub: normalize(thumbnailSubInput.value),
    showSub: thumbnailShowSubInput.checked,
    style: "bold",
  };
}

function setThumbnailTitleStatus(message, kind = "info") {
  thumbnailTitleStatus.textContent = message;
  thumbnailTitleStatus.dataset.kind = kind;
}

function resetThumbnailInspection() {
  thumbnailOpenedFinalHash = null;
  thumbnailInspectedInput.checked = false;
  previewImage.dataset.titleCandidateHash = "";
}

function renderThumbnailTitleControls() {
  const available = thumbnailTitleReview?.available === true;
  const held = !available || !thumbnailTitleReview?.baseFingerprint || thumbnailTitleReview.holds.length > 0;
  const title = thumbnailInputSpec();
  const validInput = Boolean(title.main) && (!title.showSub || Boolean(title.sub));
  const saved = Number.isSafeInteger(thumbnailTitleReview?.revision);
  const ready = !busy && !dirty && !held && !thumbnailTitleDirty && !thumbnailTitleReview?.stale && saved;
  thumbnailMainInput.disabled = busy || !available;
  thumbnailSubInput.disabled = busy || !available;
  thumbnailShowSubInput.disabled = busy || !available;
  thumbnailSaveButton.disabled = busy || dirty || held || !validInput || (!thumbnailTitleDirty && saved && !thumbnailTitleReview?.stale);
  thumbnailDraftButton.disabled = !ready;
  thumbnailFinalButton.disabled = !ready || !thumbnailTitleReview?.draft;
  thumbnailRefreshButton.disabled = busy || !csrfToken;
  const finalIsInspected = ready && thumbnailTitleReview?.final?.sha256 === thumbnailOpenedFinalHash;
  thumbnailInspectedInput.disabled = !finalIsInspected;
  thumbnailConfirmButton.disabled = !finalIsInspected || !thumbnailInspectedInput.checked
    || thumbnailTitleReview?.active?.sha256 === thumbnailTitleReview?.final?.sha256;
}

function thumbnailImageUrl(kind, record) {
  return `/mockup-title-image/${kind}/${record.sha256}`;
}

function openThumbnailTitleImage(kind, record) {
  if (!record || busy) return;
  previewTitle.textContent = kind === "active" ? "이전에 로컬 확정한 제목" : kind === "final" ? "현재 제목 최종본 · 확정 전 확인" : "현재 제목 초안";
  previewImage.dataset.titleCandidateHash = kind === "final" && !thumbnailTitleDirty && !dirty
    && !thumbnailTitleReview?.stale && thumbnailTitleReview?.final?.sha256 === record.sha256 ? record.sha256 : "";
  previewImage.src = thumbnailImageUrl(kind, record);
  previewImage.alt = previewTitle.textContent;
  previewDialog.showModal();
}

function renderThumbnailFrame(frame, kind, record, title) {
  frame.replaceChildren();
  if (!record) {
    frame.append(element("p", "", kind === "active" ? "아직 로컬 확정한 제목이 없습니다. 기존 완성본은 아래 배정표에 보존되어 있습니다." : "제목 저장 후 초안을 만들어 주세요. 기존 완성본은 바뀌지 않습니다."));
    return;
  }
  const img = document.createElement("img");
  img.src = thumbnailImageUrl(kind, record);
  img.alt = kind === "active" ? "이전에 로컬 확정한 썸네일" : "수정 중인 제목 후보";
  const button = element("button", "", kind === "final" ? "제목 최종본 열어 확인" : "크게 보기");
  button.type = "button";
  button.addEventListener("click", () => openThumbnailTitleImage(kind, record));
  frame.append(img, button);
  if (title) frame.append(element("p", "", `${title.main}${title.showSub ? ` · ${title.sub}` : " · 보조 제목 숨김"}`));
}

function renderThumbnailTitlePreviews() {
  const candidateKind = thumbnailTitleReview?.final ? "final" : "draft";
  renderThumbnailFrame(thumbnailCandidateFrame, candidateKind, thumbnailTitleReview?.[candidateKind], thumbnailTitleReview?.title);
  updateThumbnailDirtyNote();
  renderThumbnailFrame(thumbnailActiveFrame, "active", thumbnailTitleReview?.active, thumbnailTitleReview?.activeTitle);
  if (!thumbnailTitleReview?.active && thumbnailTitleReview?.legacyFinalAvailable) {
    const legacy = review?.boards[0];
    if (legacy?.final) {
      thumbnailActiveFrame.replaceChildren();
      const image = document.createElement("img");
      image.src = imageUrl(legacy, "final");
      image.alt = "제목 편집 전 기존 완성 썸네일";
      const button = element("button", "", "기존 완성본 크게 보기");
      button.type = "button";
      button.addEventListener("click", () => openPreview(legacy, "final"));
      thumbnailActiveFrame.append(image, button, element("p", "", "제목 편집 전 기존 완성본 · 그대로 보존됨"));
    }
  }
}

function updateThumbnailDirtyNote() {
  let note = thumbnailCandidateFrame.querySelector(".thumbnail-dirty-note");
  if (!note) {
    note = element("p", "thumbnail-dirty-note");
    thumbnailCandidateFrame.append(note);
  }
  note.hidden = !thumbnailTitleDirty;
  note.textContent = thumbnailTitleDirty ? "이 이미지는 마지막으로 저장한 제목입니다. 입력 중인 문구는 아직 적용되지 않았습니다." : "";
}

function applyThumbnailTitleReview(nextReview, options = {}) {
  const preserveFields = options.preserveFields === true && thumbnailTitleDirty;
  const previousFinal = thumbnailTitleReview?.final?.sha256;
  const previousBase = thumbnailTitleReview?.baseFingerprint;
  thumbnailTitleReview = nextReview;
  if (!preserveFields) {
    thumbnailMainInput.value = nextReview.title.main;
    thumbnailSubInput.value = nextReview.title.sub;
    thumbnailShowSubInput.checked = nextReview.title.showSub;
    thumbnailTitleDirty = false;
  } else {
    thumbnailTitleDirty = JSON.stringify(thumbnailInputSpec()) !== JSON.stringify(nextReview.title);
  }
  if (previousFinal !== nextReview.final?.sha256 || previousBase !== nextReview.baseFingerprint || nextReview.stale) resetThumbnailInspection();
  renderThumbnailTitlePreviews();
  renderThumbnailTitleControls();
}

async function refreshThumbnailTitleReview(options = {}) {
  try {
    const response = await requestJson("/api/mockups/title");
    applyThumbnailTitleReview(response.review, options);
    setThumbnailTitleStatus(!response.review.available
      ? "기존 목업 배정표를 먼저 준비하면 제목만 따로 편집할 수 있습니다."
      : response.review.stale ? "장표 또는 제작 기준이 바뀌었습니다. 제목을 다시 저장하고 초안부터 확인해 주세요."
        : response.review.holds.length ? response.review.holds.join(" ")
          : thumbnailTitleDirty ? "최신 상태를 확인했습니다. 입력 중인 제목은 그대로 유지했습니다."
            : "제목만 별도로 저장·제작합니다. 로컬 확정 전에는 이전 완성본이 유지됩니다.", response.review.stale ? "pending" : "info");
  } catch (error) {
    setThumbnailTitleStatus(`${error instanceof Error ? error.message : "제목 상태를 불러오지 못했습니다."} 입력 문구와 기존 완성본은 유지됩니다.`, "error");
  }
}

async function mutateThumbnailTitle(action, extra, progress, success) {
  if (busy || !thumbnailTitleReview?.baseFingerprint) return;
  if (action === "save" && !thumbnailTitleDirty && thumbnailTitleReview.revision !== null && !thumbnailTitleReview.stale) return;
  busy = true;
  resetThumbnailInspection();
  renderControls();
  try {
    setThumbnailTitleStatus(progress);
    const response = await requestJson(`/api/mockups/title/${action}`, {
      method: "POST",
      body: {
        expectedRevision: thumbnailTitleReview.revision,
        expectedBaseFingerprint: thumbnailTitleReview.baseFingerprint,
        ...extra,
      },
    });
    applyThumbnailTitleReview(response.review);
    setThumbnailTitleStatus(success, "success");
  } catch (error) {
    // Failed writes never auto-retry or reload over unsaved fields / the last good output.
    setThumbnailTitleStatus(`${error instanceof Error ? error.message : "제목 작업을 처리하지 못했습니다."} 입력 문구와 이전 완성본은 화면에 유지했습니다.`, "error");
  } finally {
    busy = false;
    renderControls();
  }
}

function onThumbnailTitleInput() {
  thumbnailTitleDirty = !thumbnailTitleReview || JSON.stringify(thumbnailInputSpec()) !== JSON.stringify(thumbnailTitleReview.title);
  resetThumbnailInspection();
  // Do not rebuild img elements on typing: that would trigger image requests.
  updateThumbnailDirtyNote();
  renderThumbnailTitleControls();
  setThumbnailTitleStatus(thumbnailTitleDirty ? "입력 중인 제목은 아직 저장되지 않았습니다. 제목 저장을 눌러 주세요." : "저장된 제목과 같습니다. 다시 저장하거나 제작할 필요가 없습니다.", thumbnailTitleDirty ? "pending" : "info");
}

thumbnailMainInput.addEventListener("input", onThumbnailTitleInput);
thumbnailSubInput.addEventListener("input", onThumbnailTitleInput);
thumbnailShowSubInput.addEventListener("change", onThumbnailTitleInput);
thumbnailInspectedInput.addEventListener("change", renderThumbnailTitleControls);
previewImage.addEventListener("load", () => {
  const expectedHash = previewImage.dataset.titleCandidateHash;
  if (expectedHash && expectedHash === thumbnailTitleReview?.final?.sha256
    && !thumbnailTitleDirty && !dirty && !thumbnailTitleReview?.stale) {
    thumbnailOpenedFinalHash = expectedHash;
    renderThumbnailTitleControls();
  }
});
previewImage.addEventListener("error", () => {
  if (previewImage.dataset.titleCandidateHash) {
    resetThumbnailInspection();
    renderThumbnailTitleControls();
    setThumbnailTitleStatus("현재 최종본 이미지를 열지 못했습니다. 확인되지 않은 이미지로는 확정할 수 없습니다.", "error");
  }
});
thumbnailSaveButton.addEventListener("click", () => {
  if (thumbnailSaveButton.disabled) return;
  mutateThumbnailTitle("save", { title: thumbnailInputSpec() }, "제목만 로컬에 저장하는 중입니다…", "제목만 저장했습니다. 초안 미리보기를 만들어 확인해 주세요.");
});
thumbnailDraftButton.addEventListener("click", () => {
  if (thumbnailDraftButton.disabled) return;
  mutateThumbnailTitle("render", { scale: 0.5 }, "제목 초안 1장을 만드는 중입니다…", "제목 초안을 만들었습니다. 기존 내지 4장은 그대로입니다.");
});
thumbnailFinalButton.addEventListener("click", () => {
  if (thumbnailFinalButton.disabled) return;
  mutateThumbnailTitle("render", { scale: 1 }, "같은 제목으로 최종 썸네일 1장을 만드는 중입니다…", "제목 최종본을 만들었습니다. ‘제목 최종본 열어 확인’ 후 로컬 확정할 수 있습니다.");
});
thumbnailConfirmButton.addEventListener("click", () => {
  if (thumbnailConfirmButton.disabled || !thumbnailTitleReview?.final || !thumbnailInspectedInput.checked
    || thumbnailOpenedFinalHash !== thumbnailTitleReview.final.sha256) return;
  mutateThumbnailTitle("confirm", { expectedFinalHash: thumbnailTitleReview.final.sha256, visualConfirmed: true }, "확인한 제목 최종본을 로컬에 확정하는 중입니다…", "확인한 제목 최종본만 로컬 확정했습니다. 발행·업로드하지 않았으며 기존 내지와 원고는 유지됩니다.");
});
thumbnailRefreshButton.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  resetThumbnailInspection();
  renderControls();
  await refreshThumbnailTitleReview({ preserveFields: true });
  busy = false;
  renderControls();
});

async function start() {
  try {
    const response = await requestJson("/api/mockups");
    csrfToken = response.csrfToken;
    if (typeof csrfToken !== "string" || csrfToken.length < 32) throw new Error("보안 토큰을 받지 못했습니다.");
    applyReview(response.review);
    await refreshThumbnailTitleReview();
    setStatus(response.review.state
      ? "작업물명과 5개 목업의 슬롯 배정을 확인해 주세요."
      : "작업물명을 직접 확인한 뒤 배정 만들기를 눌러 주세요.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "로컬 목업 기록을 불러오지 못했습니다.", "error");
  }
}

start();
