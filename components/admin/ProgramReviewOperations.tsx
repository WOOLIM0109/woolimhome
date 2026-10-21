"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, ClipboardCheck, FileText, RefreshCw, Search, X } from "lucide-react";

type Match = { target_kind: "self" | "customer"; target_id: string; target_name: string; verdict: string;
  verdict_label: string; reasons?: string[]; score: number };
type Review = { id: string; target_kind: string; target_id: string; target_name: string; conclusion: string;
  review_markdown: string; missing_documents: string[]; next_actions: string[]; reviewer: string; created_at: string };
type AttachmentSummary = { total: number; supported: number; extracted: number; pending: number; failed: number;
  no_text: number; skipped: number; unsupported: number; stored: number };
type Program = { id: string; title: string; deadline_at: string | null; source_url: string | null;
  source?: { name: string; source_key: string; category: string } | null; matches_stale: boolean;
  match?: Match; matches?: Match[]; matching_summary?: { candidate: number; unknown: number; mismatch: number };
  attachments_summary?: AttachmentSummary; latest_reviews?: Review[] };
type Profile = { id: string; name: string; aliases: string[]; profile: Record<string, unknown>; version: number; updated_at: string };
type Proposal = { id: string; profile_id: string; base_version: number; patch: Record<string, unknown>; reason: string;
  status: string; submitted_by: string; created_at: string };
type Target = { kind: "self" | "customer"; id: string; name: string };
type Institution = { id: string; name: string; enabled: boolean; last_status: string | null; last_error: string | null;
  last_succeeded_at: string | null; programs: number; deadline_unknown_programs: number; text_programs: number;
  supported_documents: number; supported_extracted: number; supported_failed: number; supported_no_text: number;
  no_links: number; discovery_failed: number; unvisited: number; attachment_warning: string | boolean | null };
type Overview = { as_of: string; today: { review_date: string; programs: Program[] }; profiles: Profile[];
  targets: Target[]; proposals: Proposal[]; institutions: Institution[] };
type Detail = { program: Program; requirements: Record<string, unknown> | null; matches_stale: boolean; matches: Match[];
  extraction: { status: string; source_complete: boolean; input_truncated: boolean } | null;
  attachments: { id: string; file_name: string; file_ext: string; text_status: string; text_chars: number; download_available: boolean }[];
  latest_reviews: Review[] };
type TextData = { detail_text: string | null; attachments: { id: string; file_name: string; text_content: string | null }[] };
type Resource<T> = { data: T | null; loading: boolean; error: string };
const API = "/api/admin/program-review";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold transition hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-50";
const panel = "rounded-2xl border border-[var(--line)] bg-white shadow-[var(--shadow-card)]";
const fieldNames: Record<string, string> = {
  regions: "지역", target_types: "지원 대상", business_age: "업력", min_years: "최소 연수", max_years: "최대 연수",
  basis: "기준 원문", as_of: "업력 기준일", size: "기업 규모", max_employees: "근로자 상한", max_revenue_krw: "매출 상한(원)",
  text: "원문", industries_included: "포함 업종", industries_excluded: "제외 업종", required_certifications: "필수 인증",
  bonus_points: "가점", item: "항목", points: "점수", support_amount_text: "지원 금액", self_pay_text: "자부담",
  deadline_at: "마감", contact: "문의", submission_documents: "제출 서류", name: "서류명", issuer: "발급 기관", note: "비고",
  evaluation: "평가", method: "평가 방법", criteria_text: "평가 기준", region: "지역", founded_on: "설립일",
  business_type: "사업자 유형", industries: "업종", employees: "근로자 수", revenue_krw: "매출(원)", revenue_band: "매출 구간",
  certifications: "현재 보유 인증", certifications_complete: "현재 인증 목록 확인 완료", has_support_history: "지원 이력 확인 여부", notes: "메모",
};
const statusNames: Record<string, string> = { extracted: "추출 완료", pending: "처리 대기", processing: "처리 중", failed: "처리 실패",
  no_text: "텍스트 없음 · 스캔 확인 필요", skipped: "제한으로 건너뜀", unsupported: "미지원 형식", completed: "완료", success: "성공", ok: "성공", error: "실패", idle: "대기" };
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false });
function date(value?: string | null) { return value && Number.isFinite(Date.parse(value)) ? dateFormatter.format(new Date(value)) : "미확인"; }
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "미확인";
  if (Array.isArray(value)) return value.length ? value.map(display).join(", ") : "등록된 항목 없음";
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function label(path: string) { return path.split(".").map(key => /^\d+$/.test(key) ? `${Number(key) + 1}` : fieldNames[key] ?? key).join(" · "); }
function errorMessage(status: number) {
  if (status === 401) return "관리자 로그인을 다시 확인해 주세요.";
  if (status === 403) return "이 요청을 처리할 권한을 확인하지 못했습니다.";
  if (status === 409) return "프로필 버전이나 제안 상태가 변경됐습니다. 새로고침 후 다시 확인해 주세요.";
  if (status === 404) return "해당 자료를 찾지 못했습니다. 목록을 새로고침해 주세요.";
  return "자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
class ReviewRequestError extends Error {}
async function readJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
    if (!response.ok) throw new ReviewRequestError(errorMessage(response.status));
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ReviewRequestError) throw error;
    throw new ReviewRequestError("자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
function useResource<T>(path: string | null, revision: number): Resource<T> {
  const [state, setState] = useState<Resource<T> & { key: string | null }>({ key: null, data: null, loading: true, error: "" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      setState({ key: path, data: null, loading: true, error: "" });
      void readJson<T>(path, { signal: controller.signal }).then(data => {
        if (active) setState({ key: path, data, loading: false, error: "" });
      }).catch((error: unknown) => {
        if (active) setState({ key: path, data: null, loading: false,
          error: error instanceof Error ? error.message : "자료를 불러오지 못했습니다." });
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [path, revision]);
  return !path ? { data: null, loading: false, error: "" } : state.key !== path ? { data: null, loading: true, error: "" } : state;
}
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  const colors = { neutral: "bg-stone-100 text-stone-600", green: "bg-emerald-50 text-emerald-800", amber: "bg-amber-50 text-amber-900", red: "bg-red-50 text-red-800" };
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${colors[tone]}`}>{children}</span>;
}
function Verdict({ match }: { match: Match }) {
  const text = match.verdict_label || (match.verdict === "candidate" ? "후보" : match.verdict === "mismatch" ? "제외" : "확인 필요");
  return <Badge tone={match.verdict === "mismatch" ? "red" : match.verdict === "unknown" ? "amber" : "green"}>{text}</Badge>;
}
function Stale({ stale }: { stale: boolean }) {
  return stale ? <Badge tone="amber">재매칭 필요 · 이전 결과</Badge> : null;
}
function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <p role={error ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-stone-200 bg-stone-50 text-stone-600"}`}>{children}</p>;
}
function ProgramCard({ program, index, onOpen, selected }: { program: Program; index: number; onOpen: (id: string) => void; selected: boolean }) {
  const matches = program.match ? [program.match] : (program.matches ?? []).filter(match => match.verdict !== "mismatch");
  const visible = [...matches].sort((a, b) => Number(b.target_kind === "self") - Number(a.target_kind === "self")).slice(0, 5);
  const summary = program.attachments_summary;
  return <article className={`${panel} p-5 ${selected ? "ring-2 ring-orange-400" : ""}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><p className="text-xs font-semibold text-stone-500">{String(index + 1).padStart(2, "0")} · {program.source?.name ?? "기관 미확인"}</p>
        <h3 className="mt-2 break-keep text-lg font-bold leading-7"><button type="button" onClick={() => onOpen(program.id)} aria-controls="program-review-detail" className="text-left hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-orange-500">{program.title}</button></h3></div>
      <FileText size={22} className="mt-1 shrink-0 text-orange-400" aria-hidden="true" />
    </div>
    <p className="mt-3 text-sm text-stone-600">마감 <span className="font-semibold text-stone-800">{date(program.deadline_at)}</span></p>
    <div className="mt-3 flex flex-wrap items-center gap-2"><Stale stale={program.matches_stale} />{!matches.length ? <Badge tone="amber">매칭 정보 확인 필요</Badge> : null}</div>
    <ul className="mt-3 space-y-2 text-sm">{visible.map(match => <li key={`${match.target_kind}:${match.target_id}`} className="flex flex-wrap items-center gap-2"><span className="font-medium">{match.target_name}</span><Verdict match={match} /><span className="text-xs text-stone-500">{match.score}점</span></li>)}</ul>
    {matches.length > visible.length ? <p className="mt-2 text-xs text-stone-500">외 {matches.length - visible.length}개 대상 · 상세에서 전체 확인</p> : null}
    <div className="mt-4 border-t border-stone-100 pt-3 text-xs leading-6 text-stone-600">
      <p>첨부 {summary ? `추출 ${summary.extracted}/${summary.supported}개 · 확보 ${summary.stored}/${summary.total}개` : "현황 확인 필요"}</p>
      {summary && summary.failed + summary.no_text > 0 ? <p className="text-amber-800">추출 실패 {summary.failed}개 · 텍스트 없음 {summary.no_text}개</p> : null}
      {(program.latest_reviews ?? []).length ? <p>매칭원 검토: {(program.latest_reviews ?? []).slice(0, 2).map(review => `${review.target_name} ${review.conclusion}`).join(" · ")}</p> : <p>매칭원 검토 대기</p>}
    </div>
    <button type="button" onClick={() => onOpen(program.id)} className={`${button} mt-4 w-full`} aria-controls="program-review-detail">조건과 근거 보기 <ArrowUpRight size={15} aria-hidden="true" /></button>
  </article>;
}
function inlineMarkdown(value: string): React.ReactNode {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`")
      ? <code key={index} className="rounded bg-stone-100 px-1 text-xs">{part.slice(1, -1)}</code> : part);
}
function ReviewMarkdown({ value }: { value: string }) {
  return <div className="space-y-3 break-words text-sm leading-7">{value.split(/\n\s*\n/).map((block, index) => {
    if (/^#{1,6}\s/.test(block)) return <h4 key={index} className="pt-2 font-bold text-stone-900">{inlineMarkdown(block.replace(/^#{1,6}\s+/, ""))}</h4>;
    const lines = block.split("\n");
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) return <ul key={index} className="list-disc space-y-1 pl-5">{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
    return <p key={index} className="whitespace-pre-wrap">{inlineMarkdown(block)}</p>;
  })}</div>;
}
function RequirementTable({ requirements }: { requirements: Record<string, unknown> }) {
  const rows: { path: string; value: unknown }[] = [];
  function flatten(value: unknown, path: string) {
    if (value && typeof value === "object" && Object.keys(value).length) {
      for (const [key, item] of Object.entries(value)) flatten(item, path ? `${path}.${key}` : key);
    } else rows.push({ path, value });
  }
  for (const [key, value] of Object.entries(requirements)) if (key !== "evidence") flatten(value, key);
  const evidence = requirements.evidence && typeof requirements.evidence === "object" ? requirements.evidence as Record<string, unknown> : {};
  return <div className="max-h-[36rem] overflow-auto rounded-xl border border-stone-200"><table className="w-full min-w-[520px] text-left text-sm">
    <thead className="sticky top-0 bg-stone-50 text-xs text-stone-600"><tr><th scope="col" className="w-40 p-3">지원 요건</th><th scope="col" className="p-3">내용</th><th scope="col" className="w-[45%] p-3">원문 근거 · 쪽 / 문단</th></tr></thead>
    <tbody className="divide-y divide-stone-100">{rows.map(row => <tr key={row.path}><th scope="row" className="p-3 align-top font-medium text-stone-600">{label(row.path)}</th><td className="whitespace-pre-wrap break-words p-3 align-top">{display(row.value)}</td><td className="whitespace-pre-wrap break-words p-3 align-top text-xs leading-6 text-stone-500">{typeof evidence[row.path] === "string" ? String(evidence[row.path]) : "인용 없음"}</td></tr>)}</tbody>
  </table></div>;
}
function DetailPanel({ id, revision, onClose, chosenTarget, chosenKind }: { id: string; revision: number; onClose: () => void; chosenTarget: string; chosenKind: "self" | "customer" }) {
  const resource = useResource<Detail>(`${API}/programs/${encodeURIComponent(id)}`, revision);
  const [showText, setShowText] = useState(false);
  const [matchSearch, setMatchSearch] = useState("");
  const [showCustomers, setShowCustomers] = useState(chosenKind === "customer");
  const [matchLimit, setMatchLimit] = useState(30);
  const [downloadMessage, setDownloadMessage] = useState("");
  const text = useResource<TextData>(showText ? `${API}/programs/${encodeURIComponent(id)}/text` : null, revision);
  const detail = resource.data;
  const matches = detail?.matches ?? [];
  const filtered = matches.filter(match => (showCustomers || match.target_kind === "self") && (!matchSearch || match.target_name.toLocaleLowerCase().includes(matchSearch.toLocaleLowerCase())))
    .sort((a, b) => Number(b.target_id === chosenTarget) - Number(a.target_id === chosenTarget));
  function download(attachmentId: string) {
    // Only the authenticated application URL enters the DOM/browser action; signed storage URLs stay server-side.
    window.open(`${API}/programs/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/download`, "_blank", "noopener,noreferrer");
    setDownloadMessage("다운로드 요청을 새 창에서 열었습니다. 파일이 열리지 않으면 관리자 로그인 상태를 확인해 주세요.");
  }
  return <section id="program-review-detail" className={`${panel} scroll-mt-5 p-5 sm:p-7`} aria-label="공고 상세">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold text-orange-700">공고 상세</p><h2 className="mt-2 text-xl font-bold">{detail?.program.title ?? "상세 정보를 확인하고 있습니다"}</h2></div><button type="button" onClick={onClose} className={button} aria-label="공고 상세 닫기"><X size={17} aria-hidden="true" /></button></div>
    {resource.loading ? <div className="mt-5"><Notice>요건과 근거를 불러오고 있습니다.</Notice></div> : resource.error ? <div className="mt-5"><Notice error>{resource.error}</Notice></div> : detail ? <div className="mt-5 space-y-8">
      <div className="flex flex-wrap items-center gap-3 text-sm"><span>{detail.program.source?.name ?? "기관 미확인"}</span><span className="text-stone-500">마감 {date(detail.program.deadline_at)}</span><Stale stale={detail.matches_stale} />
        {detail.program.source_url ? <a href={detail.program.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-orange-700 underline underline-offset-4">기관 원문 <ArrowUpRight size={14} aria-hidden="true" /></a> : null}</div>
      {detail.extraction && (!detail.extraction.source_complete || detail.extraction.input_truncated) ? <Notice>확보된 원문이 일부이거나 추출 입력이 제한되었습니다. 조건과 예외를 첨부 원본에서 추가 확인해 주세요.</Notice> : null}
      <section><h3 className="mb-3 font-bold">지원 요건과 원문 근거</h3><p className="mb-3 text-xs leading-6 text-stone-500">p.는 문서의 쪽, para.는 본문 문단입니다. 서로 같은 위치 단위로 해석하지 않습니다. 미확인 항목은 자격 충족을 뜻하지 않습니다.</p>{detail.requirements ? <RequirementTable requirements={detail.requirements} /> : <Notice>요건 추출 결과가 없습니다. 첨부 원문을 확인해 주세요.</Notice>}</section>
      <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">대상별 매칭 <span className="text-sm font-normal text-stone-500">{matches.length}개</span></h3><button type="button" className={button} aria-pressed={showCustomers} onClick={() => { setShowCustomers(value => !value); setMatchLimit(30); }}>{showCustomers ? "자사만 보기" : "고객사 포함 전체 보기"}</button></div>
        {showCustomers ? <label className="mb-3 flex items-center gap-2 rounded-xl border border-stone-200 px-3"><Search size={16} aria-hidden="true" /><input className="min-h-10 w-full min-w-0 bg-transparent text-sm outline-none" aria-label="상세 매칭 대상 이름 검색" placeholder="대상 이름 검색" value={matchSearch} onChange={event => { setMatchSearch(event.target.value); setMatchLimit(30); }} /></label> : null}
        <div className="space-y-3">{filtered.slice(0, matchLimit).map(match => <article key={`${match.target_kind}:${match.target_id}`} className="rounded-xl border border-stone-200 p-4"><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{match.target_name}</h4><Verdict match={match} /><span className="text-xs text-stone-500">검토 우선순위 {match.score}점</span></div><ul className="mt-2 space-y-1 text-sm leading-6 text-stone-600">{(match.reasons ?? []).map((reason, index) => <li key={index}>· {reason}</li>)}</ul></article>)}</div>
        {!filtered.length ? <Notice>표시할 대상별 매칭 결과가 없습니다.</Notice> : null}{filtered.length > matchLimit ? <button type="button" className={`${button} mt-3 w-full`} onClick={() => setMatchLimit(value => value + 30)}>30개 더 보기 ({matchLimit}/{filtered.length}) <ChevronDown size={15} aria-hidden="true" /></button> : null}
      </section>
      <section><h3 className="mb-3 font-bold">매칭원 최신 검토</h3>{detail.latest_reviews?.length ? <div className="space-y-4">{detail.latest_reviews.map(review => <article key={review.id} className="rounded-xl border border-stone-200 p-4 sm:p-5"><div className="mb-3 flex flex-wrap items-center gap-2"><h4 className="font-bold">{review.target_name}</h4><Badge tone={review.conclusion === "제외" ? "red" : review.conclusion === "확인 필요" ? "amber" : "green"}>{review.conclusion}</Badge><span className="text-xs text-stone-500">{date(review.created_at)}</span></div><ReviewMarkdown value={review.review_markdown} />{review.missing_documents?.length ? <p className="mt-3 text-sm text-amber-900">추가 확인 서류: {review.missing_documents.join(", ")}</p> : null}{review.next_actions?.length ? <p className="mt-2 text-sm text-stone-600">다음 단계: {review.next_actions.join(" · ")}</p> : null}</article>)}</div> : <Notice>아직 저장된 매칭원 검토가 없습니다.</Notice>}</section>
      <section><h3 className="mb-3 font-bold">첨부 원본</h3><p className="mb-3 text-xs leading-6 text-stone-500">다운로드는 관리자 권한 확인 후 10분 동안 유효한 비공개 링크로 연결됩니다.</p><ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">{detail.attachments.map(attachment => <li key={attachment.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-all text-sm font-semibold">{attachment.file_name}</p><p className="mt-1 text-xs text-stone-500">{statusNames[attachment.text_status] ?? "상태 확인 필요"} · {(attachment.text_chars ?? 0).toLocaleString("ko-KR")}자</p></div><button type="button" className={`${button} shrink-0`} onClick={() => download(attachment.id)} disabled={!attachment.download_available} aria-label={`${attachment.file_name} 원본 다운로드`}><ArrowDownToLine size={15} aria-hidden="true" />원본 받기</button></li>)}</ul>{!detail.attachments.length ? <Notice>확보된 첨부가 없습니다.</Notice> : null}{downloadMessage ? <p role="status" className="mt-3 text-xs text-stone-600">{downloadMessage}</p> : null}</section>
      <section><button type="button" className={button} aria-expanded={showText} onClick={() => setShowText(value => !value)}><FileText size={16} aria-hidden="true" />{showText ? "추출 원문 접기" : "추출 원문 전체 보기"}</button>{showText ? <div className="mt-3">{text.loading ? <Notice>본문과 첨부의 추출 글자를 불러오고 있습니다.</Notice> : text.error ? <Notice error>{text.error}</Notice> : text.data ? <div className="max-h-[32rem] space-y-5 overflow-auto rounded-xl bg-stone-50 p-4"><div><h4 className="mb-2 text-sm font-bold">상세 본문</h4><pre className="whitespace-pre-wrap break-words font-sans text-xs leading-6">{text.data.detail_text || "확보된 상세 본문 없음"}</pre></div>{text.data.attachments.map(attachment => <div key={attachment.id}><h4 className="mb-2 break-all text-sm font-bold">{attachment.file_name}</h4><pre className="whitespace-pre-wrap break-words font-sans text-xs leading-6">{attachment.text_content ?? "추출된 글자 없음"}</pre></div>)}</div> : null}</div> : null}</section>
    </div> : null}
  </section>;
}

export default function ProgramReviewOperations() {
  const [section, setSection] = useState<"programs" | "profiles" | "institutions">("programs");
  const [mode, setMode] = useState<"today" | "target">("today");
  const [targetKind, setTargetKind] = useState<"self" | "customer">("self");
  const [selfId, setSelfId] = useState("woolim-company");
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState(0);
  const [actionBusy, setActionBusy] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const overview = useResource<Overview>(`${API}/overview`, revision);
  const chosenId = targetKind === "self" ? selfId : customerId;
  const targetParams = new URLSearchParams({ target_kind: targetKind, target_id: chosenId, eligible: "true", limit: "10" });
  const targetResult = useResource<{ programs: Program[] }>(section === "programs" && mode === "target" && chosenId ? `${API}/programs?${targetParams}` : null, revision);
  const data = overview.data;
  const customers = useMemo(() => {
    const targets = (data?.targets ?? []).filter(target => target.kind === "customer");
    const query = customerSearch.trim().toLocaleLowerCase();
    const selected = targets.find(target => target.id === customerId);
    const filtered = targets.filter(target => !query || target.name.toLocaleLowerCase().includes(query)).slice(0, 100);
    return selected && !filtered.some(target => target.id === selected.id) ? [selected, ...filtered] : filtered;
  }, [data?.targets, customerId, customerSearch]);
  const programs = mode === "today" ? data?.today.programs ?? [] : (targetResult.data?.programs ?? []).filter(program => program.match?.verdict !== "mismatch");
  const listLoading = mode === "today" ? overview.loading : targetResult.loading;
  const listError = mode === "today" ? overview.error : targetResult.error;
  const pending = (data?.proposals ?? []).filter(proposal => proposal.status === "pending");
  async function decide(proposal: Proposal, approve: boolean) {
    setActionBusy(proposal.id); setActionMessage(""); setActionError("");
    try {
      await readJson(`${API}/proposals/${encodeURIComponent(proposal.id)}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_version: proposal.base_version, approve }), signal: AbortSignal.timeout(25_000) });
      setActionMessage(approve ? "프로필 수정 제안을 승인했습니다. 다음 자동 실행에서 새 프로필로 재매칭합니다. 그 전 결과에는 이전 결과 표시가 붙습니다." : "프로필 수정 제안을 반려했습니다. 기존 프로필을 유지합니다.");
      setRevision(value => value + 1);
    } catch (error) { setActionError(error instanceof Error ? error.message : "제안을 처리하지 못했습니다."); }
    finally { setActionBusy(""); }
  }
  function openProgram(id: string) {
    setSelectedId(id);
    window.setTimeout(() => document.getElementById("program-review-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  return <div className="space-y-6 pt-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" aria-label="공고 검토 화면 선택">{[
      ["programs", "공고 목록"], ["profiles", "자사 프로필·제안"], ["institutions", "기관별 수집"],
    ].map(([key, text]) => <button type="button" key={key} className={`${button} ${section === key ? "border-orange-300 bg-orange-50 text-orange-900" : ""}`} aria-pressed={section === key} onClick={() => setSection(key as typeof section)}>{text}{key === "profiles" && pending.length ? <span className="rounded-full bg-orange-600 px-1.5 text-xs text-white">{pending.length}</span> : null}</button>)}</div><button type="button" className={button} onClick={() => setRevision(value => value + 1)} disabled={overview.loading}><RefreshCw size={15} className={overview.loading ? "animate-spin" : ""} aria-hidden="true" />새로고침</button></div>
    {data ? <p className="text-xs text-stone-500">{date(data.as_of)} 기준 · 한국시간</p> : null}
    {overview.error ? <Notice error>{overview.error}</Notice> : null}
    {actionMessage ? <Notice>{actionMessage}</Notice> : null}{actionError ? <Notice error>{actionError}</Notice> : null}
    {section === "programs" ? <>
      <div className={`${panel} p-5`}><div className="flex flex-wrap gap-2" aria-label="공고 목록 범위"><button type="button" className={`${button} ${mode === "today" ? "border-stone-800 bg-stone-800 text-white hover:bg-stone-700" : ""}`} aria-pressed={mode === "today"} onClick={() => setMode("today")}>오늘 정독 8개</button><button type="button" className={`${button} ${mode === "target" ? "border-stone-800 bg-stone-800 text-white hover:bg-stone-700" : ""}`} aria-pressed={mode === "target"} onClick={() => setMode("target")}>대상별 상위 10개</button></div>
        <p className="mt-3 text-sm leading-6 text-stone-600">{mode === "today" ? "하루 정독할 공고를 최대 8개까지 모았습니다. 정보가 부족한 공고도 확인 대상으로 포함됩니다." : "대상별 조건부 후보·후보를 우선 표시합니다. 후보가 없으면 확인 필요 목록을 보여줍니다. 명백한 불일치는 제외합니다."}</p>
        {mode === "target" ? <div className="mt-4 space-y-4 border-t border-stone-100 pt-4"><div className="flex flex-wrap items-center gap-2">{(data?.profiles ?? []).map(profile => <button type="button" key={profile.id} className={`${button} ${targetKind === "self" && selfId === profile.id ? "border-orange-300 bg-orange-50 text-orange-900" : ""}`} aria-pressed={targetKind === "self" && selfId === profile.id} onClick={() => { setTargetKind("self"); setSelfId(profile.id); }}>{profile.name}</button>)}<button type="button" className={`${button} ${targetKind === "customer" ? "border-orange-300 bg-orange-50 text-orange-900" : ""}`} aria-pressed={targetKind === "customer"} onClick={() => setTargetKind("customer")}>고객사 선택</button></div>
          {targetKind === "customer" ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-stone-600">고객사 이름 검색<div className="mt-1 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3"><Search size={16} aria-hidden="true" /><input type="search" className="min-h-11 w-full min-w-0 bg-transparent text-sm outline-none" placeholder="이름을 입력해 목록 좁히기" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} /></div></label><label className="text-xs font-semibold text-stone-600">조회할 고객사<select className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm" value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">고객사를 선택해 주세요</option>{customers.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select><span className="mt-1 block font-normal">검색 결과는 최대 100개씩 표시합니다.</span></label></div> : null}
        </div> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">{mode === "today" ? `${data?.today.review_date ?? "오늘"} 정독 목록` : `${(data?.targets ?? []).find(target => target.kind === targetKind && target.id === chosenId)?.name ?? "대상별"} 상위 목록`} <span className="ml-1 text-sm font-normal text-stone-500">{programs.length}개</span></h2><p className="text-xs text-stone-500">조건부 후보는 추가 요건 확인 필요 · 점수는 검토 우선순위</p></div>
      {listLoading || overview.loading ? <Notice>공고와 대상별 매칭 현황을 불러오고 있습니다.</Notice> : listError ? <Notice error>{listError}</Notice> : mode === "target" && !chosenId ? <Notice>고객사를 선택하면 대상별 상위 공고를 표시합니다.</Notice> : !programs.length ? <Notice>현재 범위에 표시할 공고가 없습니다. 다른 대상이나 오늘 정독 목록을 확인해 주세요.</Notice> : <div className="grid gap-4 xl:grid-cols-2">{programs.map((program, index) => <ProgramCard key={program.id} program={program} index={index} onOpen={openProgram} selected={selectedId === program.id} />)}</div>}
      {selectedId ? <DetailPanel key={`${selectedId}:${targetKind}:${chosenId}`} id={selectedId} revision={revision} chosenTarget={chosenId} chosenKind={targetKind} onClose={() => setSelectedId("")} /> : null}
    </> : section === "profiles" ? overview.loading ? <Notice>자사 프로필을 불러오고 있습니다.</Notice> : <div className="space-y-7">
      <p className="text-sm leading-7 text-stone-600">승인된 사실만 표시합니다. 미확인 항목을 임의로 채우지 않으며, 제안은 승인 후에만 반영됩니다.</p>
      <div className="grid gap-4 xl:grid-cols-2">{(data?.profiles ?? []).map(profile => <article key={profile.id} className={`${panel} p-5`}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">{profile.name}</h2><Badge>버전 {profile.version}</Badge></div>{profile.aliases.length ? <p className="mt-1 text-xs text-stone-500">다른 이름: {profile.aliases.join(", ")}</p> : null}<dl className="mt-4 divide-y divide-stone-100">{Object.entries(profile.profile).map(([key, value]) => <div key={key} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-2.5 text-sm"><dt className="text-stone-500">{fieldNames[key] ?? key}</dt><dd className="whitespace-pre-wrap break-words font-medium">{display(value)}</dd></div>)}</dl><p className="mt-4 text-xs text-stone-500">반영 시각 {date(profile.updated_at)}</p></article>)}</div>
      <section><h2 className="mb-3 text-lg font-bold">승인 대기 제안 <span className="text-sm font-normal text-stone-500">{pending.length}개</span></h2>{!pending.length ? <Notice>승인 대기 중인 제안이 없습니다.</Notice> : <div className="space-y-4">{pending.map(proposal => { const profile = data?.profiles.find(item => item.id === proposal.profile_id); return <article key={proposal.id} className={`${panel} p-5`}><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{profile?.name ?? "자사 프로필"} 수정 제안</h3><Badge tone="amber">승인 대기</Badge><span className="text-xs text-stone-500">기준 버전 {proposal.base_version} · {date(proposal.created_at)}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-600">{proposal.reason}</p><div className="mt-4 overflow-x-auto rounded-xl border border-stone-200"><table className="w-full min-w-[400px] text-left text-sm"><thead className="bg-stone-50 text-xs text-stone-500"><tr><th scope="col" className="p-3">항목</th><th scope="col" className="p-3">현재 승인 값</th><th scope="col" className="p-3">제안 값</th></tr></thead><tbody className="divide-y divide-stone-100">{Object.entries(proposal.patch).map(([key, value]) => <tr key={key}><th scope="row" className="p-3 font-medium">{fieldNames[key] ?? key}</th><td className="whitespace-pre-wrap break-words p-3 text-stone-500">{display(profile?.profile[key])}</td><td className="whitespace-pre-wrap break-words p-3 font-semibold">{display(value)}</td></tr>)}</tbody></table></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={`${button} border-emerald-200 text-emerald-800 hover:bg-emerald-50`} disabled={Boolean(actionBusy)} onClick={() => void decide(proposal, true)}><Check size={16} aria-hidden="true" />{actionBusy === proposal.id ? "처리 중" : "제안 승인"}</button><button type="button" className={`${button} text-stone-600`} disabled={Boolean(actionBusy)} onClick={() => void decide(proposal, false)}><X size={16} aria-hidden="true" />제안 반려</button></div></article>; })}</div>}</section>
    </div> : overview.loading ? <Notice>기관별 수집 상태를 불러오고 있습니다.</Notice> : <section className="space-y-4"><div><h2 className="text-lg font-bold">기관별 수집·첨부 현황</h2><p className="mt-2 text-sm leading-6 text-stone-600">최근 60일 중 마감일이 미래로 확인된 공고 기준입니다. 마감 미확인 건수는 별도로 표시합니다. 마지막 수집 성공과 첨부 확보·추출 상태를 함께 확인하세요.</p></div><div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-stone-50 text-xs text-stone-500"><tr><th scope="col" className="p-4">기관</th><th scope="col" className="p-4">마지막 수집 성공</th><th scope="col" className="p-4">공고</th><th scope="col" className="p-4">첨부 추출</th><th scope="col" className="p-4">주의·최근 오류</th></tr></thead><tbody className="divide-y divide-stone-100">{(data?.institutions ?? []).map(institution => <tr key={institution.id}><th scope="row" className="p-4 align-top font-semibold">{institution.name}<span className="mt-1 block text-xs font-normal text-stone-500">{institution.enabled ? "수집 활성" : "수집 중지"}</span></th><td className="p-4 align-top"><span className="whitespace-nowrap">{date(institution.last_succeeded_at)}</span><span className="mt-1 block text-xs text-stone-500">{statusNames[institution.last_status ?? ""] ?? "상태 확인 필요"}</span></td><td className="p-4 align-top"><p className="whitespace-nowrap">마감 확인 {institution.programs}건</p><p className="mt-1 text-xs text-stone-500">미확인 {institution.deadline_unknown_programs}건</p></td><td className="p-4 align-top"><p className="whitespace-nowrap">{institution.supported_extracted}/{institution.supported_documents}개 추출</p><p className="mt-1 text-xs text-stone-500">텍스트 확보 공고 {institution.text_programs}건</p><p className="mt-1 text-xs text-stone-500">실패 {institution.supported_failed} · 글자 없음 {institution.supported_no_text}</p></td><td className="max-w-xs space-y-2 p-4 align-top text-xs leading-6">{institution.attachment_warning ? <Badge tone="amber">첨부 확보·추출 확인 필요</Badge> : <Badge tone="green">특이사항 없음</Badge>}{institution.no_links + institution.discovery_failed + institution.unvisited > 0 ? <p className="text-stone-500">링크 없음 {institution.no_links} · 탐색 실패 {institution.discovery_failed} · 미확인 {institution.unvisited}</p> : null}{institution.last_error ? <p className="break-words text-red-700">{institution.last_error}</p> : <p className="text-stone-400">최근 오류 없음</p>}</td></tr>)}</tbody></table></div>{!data?.institutions.length ? <Notice>기관 수집 현황이 없습니다.</Notice> : null}</section>}
    <p className="flex items-start gap-2 text-xs leading-6 text-stone-500"><ClipboardCheck size={15} className="mt-1 shrink-0" aria-hidden="true" />매칭 결과는 검토를 돕는 자료입니다. 실제 신청 전 모집 단계, 지원 대상과 예외 조건을 기관 원문으로 확인해 주세요.</p>
  </div>;
}
