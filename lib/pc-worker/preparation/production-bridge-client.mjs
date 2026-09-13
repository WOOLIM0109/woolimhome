// Optional worker-to-admin bridge. No automatic reads, writes, polling or retry.
const card = document.querySelector("#production-bridge");
const previewButton = document.querySelector("#production-preview");
const stageButton = document.querySelector("#production-stage");
const inspected = document.querySelector("#production-inspected");
const status = document.querySelector("#production-status");
const images = document.querySelector("#production-images");
let preview = null;
let csrfToken = "";
let busy = false;
let completed = false;
let generation = 0;
let loaded = 0;

function controls() {
  previewButton.disabled = busy || completed;
  inspected.disabled = busy || completed || !preview || loaded !== 5;
  stageButton.disabled = busy || completed || !preview || loaded !== 5 || !inspected.checked;
}
function invalidate(message) {
  generation += 1;
  preview = null;
  loaded = 0;
  inspected.checked = false;
  images.replaceChildren();
  if (message) status.textContent = message;
  controls();
}
async function request(path, body) {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json", "X-Woolim-CSRF": csrfToken } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  if (!(response.headers.get("content-type") || "").startsWith("application/json")) throw Error("로컬 검토 연결을 다시 열어 주세요.");
  const result = await response.json();
  if (!response.ok) throw Error(typeof result.error === "string" ? result.error : "검토 후보를 처리하지 못했습니다.");
  return result;
}
function imageUrl(board, descriptor) {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(board.templateId) || !/^[a-f0-9]{64}$/.test(board.imageHash)) throw Error("검토 이미지 식별자가 올바르지 않습니다.");
  return board.kind === "thumbnail" && descriptor.thumbnail.titleSpec
    ? `/mockup-title-image/active/${board.imageHash}`
    : `/mockup-image/${board.templateId}/final/${board.imageHash}`;
}
previewButton.addEventListener("click", async () => {
  if (busy || completed) return;
  invalidate(); busy = true; controls();
  const ticket = generation;
  status.textContent = "현재 확정된 최종 5장을 확인하고 있습니다…";
  try {
    const result = await request("/api/production/preview");
    if (ticket !== generation) return;
    if (!/^[a-f0-9]{64}$/.test(result.snapshotHash) || !result.csrfToken
      || result.descriptor?.mode !== "full" || result.descriptor?.remoteApproval !== "required"
      || !Array.isArray(result.descriptor.boards) || result.descriptor.boards.length !== 5) throw Error("완성된 5개 목업의 검토 기록이 필요합니다.");
    preview = result; csrfToken = result.csrfToken;
    result.descriptor.boards.forEach((board, index) => {
      const article = document.createElement("article"); article.className = "mockup-board";
      const heading = document.createElement("h3"); heading.textContent = index === 0 ? "썸네일" : `BODY ${index}`;
      const link = document.createElement("a"); link.href = imageUrl(board, result.descriptor); link.target = "_blank"; link.rel = "noopener noreferrer";
      const frame = document.createElement("div"); frame.className = "mockup-board-image";
      const image = document.createElement("img"); image.alt = `${heading.textContent} 최종 검토 후보`;
      image.addEventListener("load", () => { if (ticket === generation && preview) { loaded += 1; controls(); } }, { once: true });
      image.addEventListener("error", () => { if (ticket === generation) invalidate("검토 이미지가 변경됐거나 열리지 않습니다. 최종 5장을 다시 확인해 주세요."); }, { once: true });
      image.src = link.href; link.append(image); frame.append(link); article.append(heading, frame); images.append(article);
    });
    status.textContent = "각 이미지를 열어 확인한 뒤 아래 확인란을 선택해 주세요. 전송 후에도 관리자 최종 승인이 필요합니다.";
  } catch (error) { if (ticket === generation) invalidate(error.message || "검토 후보를 확인하지 못했습니다."); }
  finally { busy = false; controls(); }
});
inspected.addEventListener("change", controls);
stageButton.addEventListener("click", async () => {
  if (busy || completed || !preview || loaded !== 5 || !inspected.checked) return;
  const expectedSnapshotHash = preview.snapshotHash;
  busy = true; controls(); status.textContent = "관리자 최종 검토용으로 보내고 있습니다…";
  try {
    const result = await request("/api/production/stage", { expectedSnapshotHash, outputInspected: true });
    if (result.staged !== true) throw Error("관리자 검토 전송을 확인하지 못했습니다.");
    completed = true; inspected.checked = false;
    status.textContent = "관리자 최종 검토 대기 상태로 보냈습니다. 운영 이미지 교체·발행은 아직 하지 않았습니다.";
  } catch (error) {
    invalidate(error.message || "전송에 실패했습니다. 자동 재시도하지 않습니다.");
  } finally { busy = false; controls(); }
});
// Other editors retain their own behavior. Only invalidate this confirmation;
// never save, generate or transfer because an input/change/click occurred.
for (const kind of ["input", "change", "click"]) document.addEventListener(kind, (event) => {
  if (completed || (!preview && !busy) || card.contains(event.target)) return;
  if (kind === "click" && event.target?.tagName !== "BUTTON") return;
  invalidate("편집 내용이 바뀌었을 수 있습니다. 보낼 최종 5장을 다시 확인해 주세요.");
});
controls();
