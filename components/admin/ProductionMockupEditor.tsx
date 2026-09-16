"use client";

import { useRef, useState } from "react";
import { readJsonResponse } from "@/lib/http/read-json";

type TitleSpec = { main: string; sub: string; showSub: boolean; style: "bold" };
type SessionImage = { url: string; kind: "thumbnail" | "body_image" };
type Session = { id: string; status: string; createdAt: string; localReviewUrl: string | null;
  errorCode: string | null; snapshotHash: string | null; images: SessionImage[]; setId?: string };
type TitleRevision = { activeSetId: string | null; updatedAt: string };
type SessionData = { sessions: Session[]; title: { available: boolean; current: TitleSpec | null; revision: TitleRevision | null; reason?: string } };
type TitleCandidate = { candidateId: string; expectedUpdatedAt: string; manifestHash: string; url: string; title: TitleSpec };
type Preview = { url: string; label: string; proof: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const blankTitle: TitleSpec = { main: "", sub: "", showSub: false, style: "bold" };
const buttonClass = "rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass = `${buttonClass} border-orange-300 bg-orange-50 text-orange-900`;
function sameTitle(a: TitleSpec, b: TitleSpec) { return a.main === b.main && a.sub === b.sub && a.showSub === b.showSub && a.style === b.style; }
function cleanTitle(value: TitleSpec): TitleSpec {
  const clean = (s: string) => s.normalize("NFC").trim().replace(/ {2,}/g, " ");
  return { main: clean(value.main), sub: clean(value.sub), showSub: value.showSub, style: "bold" };
}
export function localMockupReviewLink(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1","localhost"].includes(url.hostname)
      || !url.port || url.username || url.password || url.search || url.hash
      || (url.pathname !== "/" && !/^\/launch\/[a-f0-9]{64}$/.test(url.pathname))) return null;
    return url.href;
  } catch { return null; }
}
export function productionMockupImageUrl(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\x00-\x20\\]/.test(value)) return null;
  // Candidate URLs must be authenticated same-origin image routes, not raw PPT
  // storage links or a caller-selected remote image host.
  return value.startsWith("/api/admin/") ? value : null;
}
export function productionMockupError(value: unknown) {
  const code = typeof value === "string" ? value : "";
  const known: Record<string,string> = {
    MOCKUP_TITLE_TOO_WIDE: "제목이 표시 영역을 벗어납니다. 문구를 줄이거나 보조 제목 표시를 꺼 주세요.",
    MOCKUP_TITLE_UNSUPPORTED_GLYPH: "지원하지 않는 글자나 기호가 있습니다. 다른 문자로 바꿔 주세요.",
    MOCKUP_TITLE_INVALID_CHARACTER: "제목에는 줄바꿈이나 제어 문자를 넣을 수 없습니다.",
    MOCKUP_TITLE_REQUIRED: "메인 제목을 입력해 주세요.",
    THUMBNAIL_VERIFIED_BASE_REQUIRED: "새 편집 경로로 목업을 먼저 확인·확정해야 제목만 수정할 수 있습니다.",
    THUMBNAIL_PREVIEW_LIMIT: "미리보기 요청이 잠시 많아졌습니다. 잠시 뒤 직접 다시 눌러 주세요.",
    MOCKUP_EXISTING_JOB_RUNNING: "기존 이미지 작업이 실행 중입니다. 끝난 뒤 새 목업을 준비해 주세요.",
    MOCKUP_SESSION_ALREADY_OPEN: "이미 준비 중인 요청이 있습니다. 상태 새로고침으로 확인해 주세요.",
  };
  if (known[code]) return `${known[code]} (${code})`;
  if (/^(MOCKUP|THUMBNAIL|IMAGE_SET)_.*(?:STALE|CHANGED|CONFLICT|NO_LONGER_ACTIVE)$/.test(code)) return `다른 편집으로 기준 상태가 바뀌었습니다. 최신 상태를 확인하고 새 후보를 만들어 주세요. (${code})`;
  if (/^(MOCKUP|THUMBNAIL)_SCHEMA_NOT_READY$/.test(code)) return `편집 기능의 서버 준비가 아직 끝나지 않았습니다. (${code})`;
  if (/^(MOCKUP|THUMBNAIL|IMAGE_SET)_[A-Z0-9_]+$/.test(code)) return `요청을 처리하지 못했습니다. (${code})`;
  return code === "Unauthorized" ? "관리자 로그인이 필요합니다." : "요청을 처리하지 못했습니다. 현재 이미지는 유지됩니다.";
}
function checkedTitle(value: unknown): TitleSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const title = value as Record<string,unknown>;
  return typeof title.main === "string" && typeof title.sub === "string" && typeof title.showSub === "boolean" && title.style === "bold"
    ? { main: title.main, sub: title.sub, showSub: title.showSub, style: "bold" } : null;
}
export function checkedMockupSessions(value: Record<string,unknown>): SessionData {
  if (!Array.isArray(value.sessions) || !value.title || typeof value.title !== "object") throw new Error("목업 편집 상태 응답을 확인할 수 없습니다. 기존 이미지는 유지됩니다.");
  const sessions = value.sessions.map(raw => {
    if (!raw || typeof raw !== "object" || !UUID.test(raw.id) || typeof raw.status !== "string"
      || typeof raw.createdAt !== "string" || !Array.isArray(raw.images)) throw new Error("목업 세션 상태가 올바르지 않습니다.");
    return { id: raw.id, status: raw.status, createdAt: raw.createdAt, localReviewUrl: localMockupReviewLink(raw.localReviewUrl),
      errorCode: typeof raw.errorCode === "string" && /^[A-Z0-9_:-]{1,100}$/.test(raw.errorCode) ? raw.errorCode : null,
      snapshotHash: typeof raw.snapshotHash === "string" && SHA.test(raw.snapshotHash) ? raw.snapshotHash : null,
      ...(typeof raw.setId === "string" && UUID.test(raw.setId) ? { setId: raw.setId } : {}),
      images: raw.images.map((image: Record<string,unknown>) => {
        const url = productionMockupImageUrl(image?.url);
        if (!url || !["thumbnail","body_image"].includes(String(image?.kind))) throw new Error("검토 이미지 주소가 올바르지 않습니다.");
        return { url, kind: image.kind as SessionImage["kind"] };
      }),
    };
  });
  const title = value.title as Record<string,unknown>;
  let revision: TitleRevision | null = null;
  if (title.revision !== undefined && title.revision !== null) {
    if (typeof title.revision !== "object" || Array.isArray(title.revision)) throw new Error("제목 편집 기준 상태가 올바르지 않습니다.");
    const raw = title.revision as Record<string,unknown>;
    if ((raw.activeSetId !== null && (typeof raw.activeSetId !== "string" || !UUID.test(raw.activeSetId)))
      || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))) throw new Error("제목 편집 기준 상태가 올바르지 않습니다.");
    revision = { activeSetId: raw.activeSetId as string | null, updatedAt: raw.updatedAt };
  }
  return { sessions, title: { available: title.available === true, current: checkedTitle(title.current),
    revision,
    ...(typeof title.reason === "string" ? { reason: title.reason.slice(0,500) } : {}) } };
}
function completeImageSet(session: Session) {
  return session.snapshotHash && session.images.length === 5 && session.images.filter(i => i.kind === "thumbnail").length === 1
    && session.images.filter(i => i.kind === "body_image").length === 4 && new Set(session.images.map(i => i.url)).size === 5;
}
function stageLabel(status: string) {
  return ({ queued:"PC 작업 대기",running:"PC에서 준비 중",claimed:"PC에서 준비 중",preparing:"PC에서 준비 중",
    local_review:"PC에서 장표·블러 검토 중",review:"PC에서 장표·블러 검토 중",reviewing:"PC에서 장표·블러 검토 중",staged:"새 목업 확인 대기",ready:"새 목업 확인 대기",
    uploading:"검토한 목업 업로드 중",uploaded:"새 목업 확인 대기",activated:"운영 이미지 교체 완료",completed:"처리 완료",cancelled:"요청 취소됨",failed:"준비 실패" } as Record<string,string>)[status] || "상태 확인 필요";
}

export default function ProductionMockupEditor({ workItemId, title: workTitle, currentAssets, onActivated, disabled = false }: {
  workItemId: string; title: string;
  currentAssets: { id: string; asset_type: string; public_url: string; sort_order?: number }[];
  onActivated: () => Promise<void> | void; disabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageDialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const titleDirtyRef = useRef(false);
  const titleInitializedRef = useRef(false);
  const titleRevisionRef = useRef<string | null>(null);
  const candidatePresentRef = useRef(false);
  const [open,setOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [data,setData] = useState<SessionData | null>(null);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const [preview,setPreview] = useState<Preview | null>(null);
  const [seen,setSeen] = useState<string[]>([]);
  const [approved,setApproved] = useState<Record<string,boolean>>({});
  const [titleSpec,setTitleSpec] = useState<TitleSpec>(blankTitle);
  const [candidate,setCandidate] = useState<TitleCandidate | null>(null);
  const [titleInspected,setTitleInspected] = useState(false);
  const [titleNotice,setTitleNotice] = useState("");
  const endpoint = `/api/admin/content/${encodeURIComponent(workItemId)}/mockup-session`;
  const titleEndpoint = `/api/admin/content/${encodeURIComponent(workItemId)}/thumbnail-title`;
  const liveSession = data?.sessions.some(s => !["activated","completed","cancelled","failed"].includes(s.status)) ?? false;

  async function jsonRequest(url: string, body?: Record<string,unknown>) {
    const response = await fetch(url,{ method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      ...(body ? { headers: { "Content-Type":"application/json" },body:JSON.stringify(body) } : {}) });
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(productionMockupError(result.error));
    return result;
  }
  async function readState() {
    const next = checkedMockupSessions(await jsonRequest(endpoint));
    const nextRevision = next.title.revision ? `${next.title.revision.activeSetId ?? "legacy"}:${next.title.revision.updatedAt}` : null;
    if (candidatePresentRef.current && (!next.title.available || (titleRevisionRef.current !== null && titleRevisionRef.current !== nextRevision))) {
      invalidateTitleCandidate("목업 또는 원고의 기준 상태가 바뀌어 이전 제목 후보와 검수 확인을 해제했습니다. 입력 문구는 유지했습니다. 미리보기를 새로 만들어 주세요.");
    }
    titleRevisionRef.current = nextRevision;
    setApproved(previous => Object.fromEntries(next.sessions.filter(session => data?.sessions.some(old => old.id === session.id && old.snapshotHash === session.snapshotHash)).map(session => [session.id,previous[session.id] ?? false])));
    setData(next);
    // Read-only refresh must never overwrite separately typed, unsaved titles.
    if (!titleInitializedRef.current || !titleDirtyRef.current) {
      setTitleSpec(next.title.current ?? blankTitle);
      titleInitializedRef.current = true;
    }
    return next;
  }
  async function guarded(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (reason) { setError(`${reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다."} 입력 중인 내용과 기존 완성본은 유지됩니다. 자동 재시도하지 않습니다.`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function openEditor() {
    setOpen(true); dialogRef.current?.showModal();
    void guarded(async () => { await readState(); });
  }
  function closeEditor() {
    if (busyRef.current) return;
    imageDialogRef.current?.close();dialogRef.current?.close();setOpen(false);setPreview(null);
  }
  function showImage(url: string, label: string, proof: string | null) {
    setPreview({url,label,proof});imageDialogRef.current?.showModal();
  }
  function proofKey(session: Session, image: SessionImage) { return `${session.id}:${session.snapshotHash}:${image.url}`; }
  function invalidateTitleCandidate(notice: string) {
    const hadCandidate = candidatePresentRef.current;
    candidatePresentRef.current = false;setCandidate(null);setTitleInspected(false);
    setSeen(keys => keys.filter(key => !key.startsWith("title:")));
    if (preview?.proof?.startsWith("title:")) { imageDialogRef.current?.close();setPreview(null); }
    if (hadCandidate) setTitleNotice(notice);
  }
  function titleChanged(next: TitleSpec) {
    setTitleSpec(next);titleDirtyRef.current = !sameTitle(cleanTitle(next),data?.title.current ?? blankTitle);
    setTitleInspected(false);
    // Text input affects only local React state, never a fetch or image rebuild.
  }
  async function createSession() {
    await guarded(async () => {
      const result = await jsonRequest(endpoint,{action:"create"});
      if (typeof result.id !== "string" || !UUID.test(result.id)) throw new Error("작업 요청 접수 여부를 확인하지 못했습니다. 상태 새로고침으로 확인해 주세요.");
      const next = await readState();
      if (!next.sessions.some(session => session.id === result.id)) throw new Error("접수한 준비 요청의 상태를 아직 확인하지 못했습니다.");
      setMessage("PC 준비 요청을 접수했습니다. 기존 이미지는 교체하지 않았습니다.");
    });
  }
  async function cancelSession(session: Session) {
    await guarded(async () => {
      await jsonRequest(endpoint,{action:"cancel",sessionId:session.id});
      const next = await readState();
      if (!next.sessions.some(s => s.id === session.id && s.status === "cancelled")) throw new Error("취소 완료 상태를 아직 확인하지 못했습니다.");
      setMessage("새 목업 준비 요청만 취소했습니다. 기존 완성본은 유지됩니다.");
    });
  }
  async function activateSession(session: Session) {
    if (!completeImageSet(session) || !approved[session.id] || !session.images.every(i => seen.includes(proofKey(session,i)))) return;
    await guarded(async () => {
      const result = await jsonRequest(endpoint,{action:"activate",sessionId:session.id,snapshotHash:session.snapshotHash,outputInspected:true});
      if (result.workItemId !== workItemId || typeof result.activeSetId !== "string" || !UUID.test(result.activeSetId)
        || result.activeSetId !== (session.setId ?? session.id) || typeof result.updatedAt !== "string") throw new Error("이미지 교체 완료 응답을 확인하지 못했습니다. 상태를 새로 확인해 주세요.");
      // Invalidate immediately after the confirmed swap, even if its subsequent
      // read-back fails. Keep unsaved title fields, but never keep old approvals.
      invalidateTitleCandidate("목업이 교체되어 이전 제목 후보와 검수 확인을 해제했습니다. 입력 문구는 유지했습니다. 새 목업에서 미리보기를 다시 만들어 주세요.");
      setMessage("확인한 목업 이미지로 교체했습니다. 원고·FAQ·게시글 제목·발행 정보는 유지됩니다.");
      await onActivated();await readState();
    });
  }
  async function previewTitle() {
    const entered = cleanTitle(titleSpec);
    if (!entered.main || (entered.showSub && !entered.sub) || (data?.title.current && sameTitle(entered,data.title.current)) || (candidate && sameTitle(entered,candidate.title))) return;
    await guarded(async () => {
      const result = await jsonRequest(titleEndpoint,{action:"preview",title:entered});
      const url = productionMockupImageUrl(result.url);
      if (typeof result.candidateId !== "string" || !UUID.test(result.candidateId) || typeof result.manifestHash !== "string"
        || !SHA.test(result.manifestHash) || typeof result.expectedUpdatedAt !== "string" || !url) throw new Error("제목 미리보기 완료 응답을 확인하지 못했습니다.");
      setCandidate({candidateId:result.candidateId,manifestHash:result.manifestHash,expectedUpdatedAt:result.expectedUpdatedAt,url,title:entered});
      candidatePresentRef.current = true;setTitleNotice("");
      setTitleInspected(false);setSeen(s => s.filter(key => !key.startsWith("title:")));
      setMessage("제목 후보만 만들었습니다. 이미지를 열어 확인한 뒤 적용할 수 있습니다.");
    });
  }
  async function activateTitle() {
    if (!candidate || !sameTitle(candidate.title,cleanTitle(titleSpec)) || !titleInspected || !seen.includes(`title:${candidate.candidateId}:${candidate.manifestHash}`)) return;
    await guarded(async () => {
      const result = await jsonRequest(titleEndpoint,{action:"activate",candidateId:candidate.candidateId,manifestHash:candidate.manifestHash,outputInspected:true});
      if (result.workItemId !== workItemId || result.activeVersionId !== candidate.candidateId || typeof result.updatedAt !== "string") throw new Error("썸네일 교체 완료 응답을 확인하지 못했습니다. 상태를 새로 확인해 주세요.");
      titleDirtyRef.current=false;candidatePresentRef.current=false;setCandidate(null);setTitleInspected(false);setTitleNotice("");
      setMessage("확인한 썸네일만 교체했습니다. 내지·원고·FAQ·게시글 제목·발행 정보는 유지됩니다.");
      await onActivated();await readState();
    });
  }
  const titleProof = candidate ? `title:${candidate.candidateId}:${candidate.manifestHash}` : null;
  const titleMatches = Boolean(candidate && sameTitle(candidate.title,cleanTitle(titleSpec)));
  const titleUnchanged = Boolean(data?.title.current && sameTitle(data.title.current,cleanTitle(titleSpec)));
  const currentImages = [...currentAssets].filter(a => ["thumbnail","body_image"].includes(a.asset_type)).sort((a,b) => (a.sort_order ?? 0)-(b.sort_order ?? 0));

  return <>
    <button type="button" className={primaryClass} disabled={disabled} onClick={openEditor}>목업·썸네일 편집</button>
    <dialog ref={dialogRef} aria-label={`${workTitle} 목업·썸네일 편집`} onCancel={event => {event.preventDefault();closeEditor();}}
      className="fixed inset-0 m-auto max-h-[92vh] w-[min(1180px,calc(100vw-24px))] overflow-auto rounded-2xl border border-[var(--line)] bg-[#f7f7f6] p-5 shadow-2xl backdrop:bg-black/60">
      {open && <>
        <header className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">목업·썸네일 편집</h2><p className="mt-1 text-sm text-[var(--muted)]">{workTitle}</p></div><button type="button" className={buttonClass} disabled={busy} onClick={closeEditor}>닫기</button></header>
        <p className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">원고·발행 정보는 유지하고 확인한 이미지만 교체합니다. 새 후보를 만드는 동안 기존 완성본은 유지됩니다.</p>
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        <div className="my-4 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => void guarded(async () => {await readState();setMessage("최신 준비 상태를 확인했습니다.");})}>상태 새로고침</button><button type="button" className={primaryClass} disabled={busy || !data || liveSession} onClick={() => void createSession()}>PC에서 새 목업 준비</button><span className="self-center text-xs text-[var(--muted)]">요청 버튼을 누를 때만 PC 작업을 만듭니다.</span></div>
        <section className="rounded-xl border border-[var(--line)] bg-white p-4"><h3 className="font-bold">현재 사용 중인 이미지</h3><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{currentImages.map((asset,index) => <button key={asset.id} type="button" className="overflow-hidden rounded-lg border border-[var(--line)]" onClick={() => showImage(asset.public_url,`현재 이미지 ${index+1}`,null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.public_url} alt={`현재 ${asset.asset_type === "thumbnail" ? "썸네일" : "내지"} ${index+1}`} className="aspect-square w-full object-contain"/><span className="block p-2 text-xs">현재 {asset.asset_type === "thumbnail" ? "썸네일" : `이미지 ${index+1}`}</span></button>)}</div>{!currentImages.length && <p className="mt-2 text-sm text-[var(--muted)]">등록된 현재 이미지가 없습니다.</p>}</section>
        <section className="mt-4 rounded-xl border border-[var(--line)] bg-white p-4"><h3 className="font-bold">새 목업 준비·검토</h3><p className="mt-2 text-xs text-[var(--muted)]">PC 검토 화면은 워커가 설치된 같은 사무실 PC에서 열어야 합니다. 다른 PC에서는 연결되지 않습니다. 변환·장표 선정·블러·슬롯을 확인한 뒤 새 후보 5장을 검토하세요.</p>
          {!data && <p className="mt-3 text-sm">{busy ? "준비 상태를 확인하는 중입니다…" : "상태 새로고침을 눌러 주세요."}</p>}
          {data?.sessions.length===0 && <p className="mt-3 text-sm text-[var(--muted)]">새 목업 준비 요청이 없습니다.</p>}
          {data?.sessions.map(session => {
            const complete=Boolean(completeImageSet(session));
            const allSeen=complete && session.images.every(i=>seen.includes(proofKey(session,i)));
            const terminal=["activated","completed","cancelled","failed"].includes(session.status);
            return <article key={session.id} className="mt-3 rounded-xl border border-[var(--line)] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm">{stageLabel(session.status)}</strong><p className="text-xs text-[var(--muted)]">{session.createdAt.replace("T"," ").slice(0,19)}</p></div>{!terminal && <button type="button" className={buttonClass} disabled={busy} onClick={()=>void cancelSession(session)}>이 준비 요청 취소</button>}</div>
              {session.errorCode && <p className="mt-2 text-xs text-red-800">준비 오류: {session.errorCode} · 기존 완성본은 유지됩니다.</p>}
              {session.localReviewUrl && !terminal && <a href={session.localReviewUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="mt-3 inline-block rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white">이 PC의 장표·블러·슬롯 편집 열기</a>}
              {["review","uploading"].includes(session.status) && <button type="button" className={`${buttonClass} ml-2 mt-3`} disabled={busy} onClick={()=>void guarded(async()=>{const receipt=await jsonRequest(endpoint,{action:"reopen",sessionId:session.id});if(receipt.sessionId!==session.id||receipt.reopenRequested!==true)throw new Error("새 연결 요청을 확인하지 못했습니다.");await readState();setMessage("새 편집 연결을 요청했습니다. PC 워커가 연결을 준비한 뒤 상태 새로고침을 눌러 주세요. PPT 재변환은 하지 않습니다.");})}>편집 연결 다시 받기</button>}
              {!!session.images.length && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{session.images.map((image,index)=><button key={image.url} type="button" className="rounded-lg border border-[var(--line)]" onClick={()=>showImage(image.url,`새 후보 ${index+1} · ${image.kind==="thumbnail"?"썸네일":"내지"}`,proofKey(session,image))}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`새 목업 후보 ${index+1}`} className="aspect-square w-full object-contain"/><span className="block p-2 text-xs">{seen.includes(proofKey(session,image)) ? "확대 확인함" : "열어 확인"}</span></button>)}</div>}
              {complete && !terminal && <div className="mt-3 flex flex-wrap items-center gap-3"><label className="text-sm"><input type="checkbox" checked={Boolean(approved[session.id])} disabled={busy || !allSeen} onChange={e=>setApproved(p=>({...p,[session.id]:e.target.checked}))}/> 새 후보 5장의 가림·잘림·장표 배치를 확인함</label><button type="button" className={primaryClass} disabled={busy || !allSeen || !approved[session.id]} onClick={()=>void activateSession(session)}>확인한 목업 5장으로 교체</button>{!allSeen && <p className="text-xs text-[var(--muted)]">5장을 각각 열어 확인해야 교체할 수 있습니다.</p>}</div>}
            </article>;
          })}
        </section>
        <section className="mt-4 rounded-xl border border-orange-200 bg-white p-4"><h3 className="font-bold">썸네일 제목만 편집</h3><p className="mt-1 text-xs text-[var(--muted)]">작업물 종류는 크게, 브랜드명은 작게 표시합니다. 입력 중에는 저장·제작·AI 요청이 없습니다.</p>
          {titleNotice && <p role="status" className="mt-3 rounded-lg bg-orange-50 p-3 text-sm text-orange-900">{titleNotice}</p>}
          {!data?.title.available && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{data?.title.reason || "제목만 편집할 수 있는 검증된 목업이 준비되면 사용할 수 있습니다."}</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-bold">메인 제목 · 작업물 종류<input value={titleSpec.main} maxLength={40} disabled={busy || !data?.title.available} onChange={e=>titleChanged({...titleSpec,main:e.target.value})} className="rounded-lg border border-[var(--line)] p-2 font-normal" placeholder="예: 행사 대행 제안서"/></label><label className="grid gap-1 text-sm font-bold">보조 제목 · 브랜드명(선택)<input value={titleSpec.sub} maxLength={60} disabled={busy || !data?.title.available} onChange={e=>titleChanged({...titleSpec,sub:e.target.value})} className="rounded-lg border border-[var(--line)] p-2 font-normal" placeholder="작게 표시할 브랜드명"/></label></div>
          <label className="mt-3 block text-sm"><input type="checkbox" checked={titleSpec.showSub} disabled={busy || !data?.title.available} onChange={e=>titleChanged({...titleSpec,showSub:e.target.checked})}/> 보조 제목 표시</label>
          <div className="mt-3 flex gap-2"><button type="button" className={primaryClass} disabled={busy || !data?.title.available || titleUnchanged || titleMatches || !titleSpec.main.trim() || (titleSpec.showSub && !titleSpec.sub.trim())} onClick={()=>void previewTitle()}>제목 미리보기 만들기</button><button type="button" className={buttonClass} disabled={busy} onClick={()=>{setTitleSpec(data?.title.current??blankTitle);titleDirtyRef.current=false;candidatePresentRef.current=false;setCandidate(null);setTitleInspected(false);setTitleNotice("");setMessage("입력 문구만 현재 제목으로 되돌렸습니다. 서버 이미지는 변경하지 않았습니다.");}}>입력만 되돌리기</button></div>
          {candidate && <div className="mt-4 rounded-xl bg-slate-50 p-3"><button type="button" className="block w-full max-w-[360px] overflow-hidden rounded-lg border border-[var(--line)]" onClick={()=>showImage(candidate.url,"썸네일 제목 후보 · 적용 전 확인",titleMatches?titleProof:null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={candidate.url} alt="수정한 썸네일 제목 후보" className="aspect-square w-full object-contain"/><span className="block p-2 text-xs font-bold">제목 후보 열어 확인</span></button>
            {!titleMatches && <p className="mt-2 text-xs text-orange-800">입력 문구가 달라졌습니다. 이 이미지는 이전 후보입니다. 미리보기를 다시 만들어 주세요.</p>}
            <label className="mt-3 block text-sm"><input type="checkbox" checked={titleInspected} disabled={busy || !titleMatches || !titleProof || !seen.includes(titleProof)} onChange={e=>setTitleInspected(e.target.checked)}/> 후보를 열어 제목·잘림·브랜드 노출을 확인함</label><button type="button" className={`${primaryClass} mt-3`} disabled={busy || !titleMatches || !titleInspected || !titleProof || !seen.includes(titleProof)} onClick={()=>void activateTitle()}>확인한 썸네일만 교체</button></div>}
        </section>
      </>}
    </dialog>
    <dialog ref={imageDialogRef} aria-label={preview?.label || "목업 이미지 확대"} onClose={()=>setPreview(null)} className="fixed inset-0 m-auto max-h-[96vh] w-[min(1700px,calc(100vw-16px))] overflow-auto rounded-xl border-0 bg-white p-3 shadow-2xl backdrop:bg-black/70">
      {preview && <><div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white pb-3"><h3 className="font-bold">{preview.label}</h3><button type="button" className={buttonClass} onClick={()=>{imageDialogRef.current?.close();setPreview(null);}}>닫기</button></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={`${preview.url}:${preview.proof}`} src={preview.url} alt={preview.label} className="mx-auto block max-w-none" onLoad={()=>{if(preview.proof)setSeen(keys=>keys.includes(preview.proof!)?keys:[...keys,preview.proof!]);}} onError={()=>{if(preview.proof)setSeen(keys=>keys.filter(key=>key!==preview.proof));setTitleInspected(false);setError("확대 이미지를 읽지 못했습니다. 확인되지 않은 후보는 교체할 수 없습니다.");}}/></>}
    </dialog>
  </>;
}
