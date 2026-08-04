"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccess } from "@/hooks/useAccess";
import type { ExpertKnowledge } from "@/lib/columns/types";
import { EXPERTISE_AREAS } from "@/lib/columns/interview-requests";
import InterviewRequests from "./InterviewRequests";

type Filter = "all" | "pending" | "approved" | "needs_review";
type EditableKnowledge = Pick<
  ExpertKnowledge,
  "topic" | "source_type" | "expertise_area" | "raw_text" | "perspective" | "case_evidence" | "differentiator"
>;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pending", label: "미승인" },
  { value: "approved", label: "승인" },
  { value: "needs_review", label: "확인 필요" },
];

const SOURCE_LABELS: Record<ExpertKnowledge["source_type"], string> = {
  interview: "인터뷰",
  case: "사례",
  note: "업무 노트",
};

const REVIEW_MARKERS = ["[발행 전 공식 확인 필요]", "[공식 확인 필요]", "[익명화 필요]", "확인 필요"];

function needsReview(item: ExpertKnowledge) {
  const text = [item.raw_text, item.perspective, item.case_evidence, item.differentiator]
    .filter(Boolean)
    .join(" ");
  return REVIEW_MARKERS.some((marker) => text.includes(marker));
}

function editableValues(item: ExpertKnowledge): EditableKnowledge {
  return {
    topic: item.topic,
    source_type: item.source_type,
    expertise_area: item.expertise_area,
    raw_text: item.raw_text,
    perspective: item.perspective || "",
    case_evidence: item.case_evidence || "",
    differentiator: item.differentiator || "",
  };
}

export default function KnowledgePage() {
  const { user, loading: authLoading } = useAuth();
  const access = useAccess(Boolean(user));
  const loading = authLoading || (Boolean(user) && access.loading);
  const isAdmin = access.admin;
  const [items, setItems] = useState<ExpertKnowledge[]>([]);
  const [form, setForm] = useState({
    topic: "", source_type: "interview", expertise_area: "planning", raw_text: "", perspective: "",
    case_evidence: "", differentiator: "", approved: true,
  });
  const [saving, setSaving] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditableKnowledge | null>(null);
  const [reviewingItem, setReviewingItem] = useState<ExpertKnowledge | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/admin/columns/knowledge", { cache: "no-store" });
    if (response.ok) setItems(await response.json());
  };

  useEffect(() => {
    if (!loading && isAdmin) {
      fetch("/api/admin/columns/knowledge", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : [])
        .then((data: ExpertKnowledge[]) => setItems(data));
    }
  }, [loading, isAdmin]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/admin/columns/knowledge", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    setSaving(false);
    if (response.ok) {
      setForm({ topic: "", source_type: "interview", expertise_area: "planning", raw_text: "", perspective: "", case_evidence: "", differentiator: "", approved: true });
      await load();
    } else window.alert((await response.json()).error);
  };

  const importKnowledge = async () => {
    if (!importFile) return;
    setImporting(true);
    const body = new FormData();
    body.append("file", importFile);
    const response = await fetch("/api/admin/columns/knowledge/import", { method: "POST", body });
    setImporting(false);
    if (response.ok) {
      const result = await response.json();
      setImportFile(null);
      await load();
      window.alert(`${result.count}개의 노하우 카드로 분류했습니다. 내용을 확인한 뒤 승인해 주세요.`);
    } else window.alert((await response.json()).error || "파일 분류에 실패했습니다.");
  };

  const patchItem = async (id: string, changes: Record<string, unknown>) => {
    setUpdatingId(id);
    const response = await fetch("/api/admin/columns/knowledge", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    setUpdatingId(null);
    if (!response.ok) {
      window.alert((await response.json()).error || "자료를 수정하지 못했습니다.");
      return false;
    }
    await load();
    return true;
  };

  const startEditing = (item: ExpertKnowledge) => {
    setExpandedIds((current) => new Set(current).add(item.id));
    setEditingId(item.id);
    setEditForm(editableValues(item));
  };

  const saveEdit = async (item: ExpertKnowledge) => {
    if (!editForm?.topic.trim() || !editForm.raw_text.trim()) {
      window.alert("주제와 원천 내용은 필수입니다.");
      return;
    }
    if (await patchItem(item.id, editForm)) {
      setEditingId(null);
      setEditForm(null);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredItems = useMemo(() => items.filter((item) => {
    if (filter === "pending") return !item.approved;
    if (filter === "approved") return item.approved;
    if (filter === "needs_review") return needsReview(item);
    return true;
  }), [filter, items]);

  const filterCount = (value: Filter) => {
    if (value === "pending") return items.filter((item) => !item.approved).length;
    if (value === "approved") return items.filter((item) => item.approved).length;
    if (value === "needs_review") return items.filter(needsReview).length;
    return items.length;
  };

  if (loading) return <Shell><p>로그인 상태를 확인하고 있습니다.</p></Shell>;
  if (!isAdmin) return <Shell><p>관리자 권한이 없습니다.</p></Shell>;

  const approvedItems = items.filter((item) => item.approved);
  const remainingUses = approvedItems.reduce(
    (total, item) => total + Math.max(0, 3 - Number(item.use_count || 0)),
    0,
  );

  return (
    <Shell>
      <Link href="/admin/columns" className="text-sm text-[var(--muted)]">← 칼럼 관리</Link>
      <div className="mt-5 flex items-center gap-3"><BookOpen className="text-[var(--primary)]" /><h1 className="text-3xl font-bold">울림 노하우 자료실</h1></div>
      <p className="prose-muted mt-3">인터뷰 녹취, 실제 사례, 대표님의 판단 기준을 저장합니다. 승인된 자료만 하이브리드·권위형 칼럼에 사용됩니다.</p>
      <div className={`mt-6 rounded-sm border p-5 ${remainingUses <= 3 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        <p className="font-bold">원천자료 사용 현황</p>
        <p className="mt-1 text-sm text-[#5f5750]">
          승인 자료 {approvedItems.length}개 · 예상 활용 여유 {remainingUses}회
          {remainingUses <= 3 && " · 새로운 인터뷰나 사례를 추가할 시점입니다."}
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">한 자료는 내용 반복을 막기 위해 기본 3회까지만 활용 여유로 계산합니다.</p>
      </div>
      <InterviewRequests />
      <div id="upload-source" className="mt-6 scroll-mt-24 rounded-sm border border-[var(--line)] bg-white p-6">
        <div className="flex items-start gap-3">
          <Upload className="mt-0.5 text-[var(--primary)]" />
          <div>
            <h2 className="font-bold">인터뷰·강의 자료 파일로 가져오기</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">TXT 또는 DOCX 파일을 올리면 대표님의 실제 표현과 맥락을 유지해 주제별 노하우 카드로 나눕니다. 외부 자료조사는 칼럼 작성 단계에서 별도로 붙이며, 분류된 카드는 검토 전까지 미승인 상태입니다.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input type="file" accept=".txt,.docx" onChange={(event) => setImportFile(event.target.files?.[0] || null)} className="input" />
          <button type="button" disabled={!importFile || importing} onClick={() => void importKnowledge()} className="btn-gradient shrink-0 rounded-sm px-5 py-3 font-bold text-white disabled:opacity-50">
            {importing ? "분류 중…" : "파일 분석하기"}
          </button>
        </div>
      </div>
      <form onSubmit={save} className="mt-8 space-y-5 rounded-sm border border-[var(--line)] bg-white p-6">
        <label className="block"><span className="mb-2 block font-bold">주제</span><input required className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="예: 사업계획서에서 심사위원이 실제로 확인하는 것" /></label>
        <label className="block"><span className="mb-2 block font-bold">자료 종류</span><select className="input" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}><option value="interview">인터뷰</option><option value="case">사례</option><option value="note">업무 노트</option></select></label>
        <label className="block">
          <span className="mb-2 block font-bold">전문 분야</span>
          <select className="input" value={form.expertise_area} onChange={(e) => setForm({ ...form, expertise_area: e.target.value })}>
            {EXPERTISE_AREAS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-2 block font-bold">원천 내용</span><textarea required rows={12} className="input" value={form.raw_text} onChange={(e) => setForm({ ...form, raw_text: e.target.value })} placeholder="녹취록이나 메모를 그대로 붙여 넣어도 됩니다." /></label>
        <label className="block"><span className="mb-2 block font-bold">통념을 뒤집는 관점 (선택)</span><textarea rows={3} className="input" value={form.perspective} onChange={(e) => setForm({ ...form, perspective: e.target.value })} /></label>
        <label className="block"><span className="mb-2 block font-bold">사례·숫자·전후 변화 (선택)</span><textarea rows={3} className="input" value={form.case_evidence} onChange={(e) => setForm({ ...form, case_evidence: e.target.value })} /></label>
        <label className="block"><span className="mb-2 block font-bold">울림만의 방식·절대 하지 않는 것 (선택)</span><textarea rows={3} className="input" value={form.differentiator} onChange={(e) => setForm({ ...form, differentiator: e.target.value })} /></label>
        <label className="flex items-center gap-3"><input type="checkbox" checked={form.approved} onChange={(e) => setForm({ ...form, approved: e.target.checked })} /><span>칼럼 생성에 사용하도록 승인</span></label>
        <button disabled={saving} className="btn-gradient rounded-sm px-6 py-3 font-bold text-white disabled:opacity-50">{saving ? "저장 중…" : "원천자료 저장"}</button>
      </form>

      <section className="mt-10">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-xl font-bold">저장된 원천자료</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">카드를 누르면 전체 내용이 펼쳐집니다.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="원천자료 필터">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`rounded-sm border px-3 py-2 text-sm font-bold ${filter === option.value ? "border-[#201d1a] bg-[#201d1a] text-white" : "border-[var(--line)] bg-white text-[#5f5750]"}`}
              >
                {option.label} {filterCount(option.value)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {filteredItems.map((item) => {
            const expanded = expandedIds.has(item.id);
            const flagged = needsReview(item);
            const editing = editingId === item.id && editForm;
            return (
              <article key={item.id} className={`rounded-sm border bg-white p-5 ${flagged ? "border-amber-300" : "border-[var(--line)]"}`}>
                <div className="flex flex-col justify-between gap-4 sm:flex-row">
                  <button type="button" onClick={() => toggleExpanded(item.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                      <span className="text-[var(--primary)]">{EXPERTISE_AREAS.find((area) => area.value === (item.expertise_area || "general"))?.label}</span>
                      <span className="text-[var(--muted)]">· {SOURCE_LABELS[item.source_type]} · 사용 {Number(item.use_count || 0)}회</span>
                      <span className={`rounded-sm px-2 py-1 ${item.approved ? "bg-emerald-50 text-emerald-800" : "bg-[#f2efec] text-[#5f5750]"}`}>{item.approved ? "승인" : "미승인"}</span>
                      {flagged && <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-2 py-1 text-amber-900"><AlertTriangle size={13} /> 확인 필요</span>}
                      {Number(item.use_count || 0) >= 3 && <span className="text-amber-800">새 자료 권장</span>}
                    </div>
                    <h3 className="mt-3 text-lg font-bold">{item.topic}</h3>
                    {!expanded && <p className="prose-muted mt-3 line-clamp-3 text-sm">{item.raw_text}</p>}
                  </button>
                  <div className="flex shrink-0 flex-wrap items-start gap-2">
                    <button type="button" onClick={() => startEditing(item)} className="inline-flex items-center gap-1 rounded-sm border border-[var(--line)] px-3 py-2 text-sm font-bold">
                      <Pencil size={15} /> 상세보기·수정
                    </button>
                    {item.approved ? (
                      <button
                        type="button"
                        disabled={updatingId === item.id}
                        onClick={() => {
                          if (window.confirm("이 자료의 승인을 취소할까요? 취소하면 새 칼럼 생성에 사용되지 않습니다.")) void patchItem(item.id, { approved: false });
                        }}
                        className="inline-flex items-center gap-1 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 disabled:opacity-50"
                      >
                        <X size={15} /> 승인 취소
                      </button>
                    ) : (
                      <button type="button" onClick={() => setReviewingItem(item)} className="inline-flex items-center gap-1 rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                        <Check size={15} /> 검토 후 승인
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`${item.topic} 삭제`}
                      className="inline-flex size-9 items-center justify-center rounded-sm border border-[var(--line)] text-rose-700"
                      onClick={async () => {
                        if (window.confirm("이 원천자료를 삭제할까요? 삭제한 자료는 복구할 수 없습니다.")) {
                          const response = await fetch(`/api/admin/columns/knowledge?id=${item.id}`, { method: "DELETE" });
                          if (response.ok) await load();
                          else window.alert("자료를 삭제하지 못했습니다.");
                        }
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                    <button type="button" aria-label={expanded ? "내용 접기" : "내용 펼치기"} onClick={() => toggleExpanded(item.id)} className="inline-flex size-9 items-center justify-center rounded-sm border border-[var(--line)]">
                      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="mt-5 border-t border-[var(--line)] pt-5">
                    {editing ? (
                      <EditForm value={editForm} onChange={setEditForm} />
                    ) : (
                      <KnowledgeDetails item={item} />
                    )}
                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                      {editing ? (
                        <>
                          <button type="button" onClick={() => { setEditingId(null); setEditForm(null); }} className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-bold">취소</button>
                          <button type="button" disabled={updatingId === item.id} onClick={() => void saveEdit(item)} className="inline-flex items-center gap-2 rounded-sm bg-[#201d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                            <Save size={16} /> {updatingId === item.id ? "저장 중…" : "수정 저장"}
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => startEditing(item)} className="inline-flex items-center gap-2 rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-bold"><Pencil size={16} /> 수정하기</button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          {filteredItems.length === 0 && <p className="rounded-sm border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">이 조건에 해당하는 자료가 없습니다.</p>}
        </div>
      </section>

      {reviewingItem && (
        <ApprovalDialog
          item={reviewingItem}
          updating={updatingId === reviewingItem.id}
          onClose={() => setReviewingItem(null)}
          onApprove={async () => {
            if (await patchItem(reviewingItem.id, { approved: true })) setReviewingItem(null);
          }}
        />
      )}
    </Shell>
  );
}

function KnowledgeDetails({ item }: { item: ExpertKnowledge }) {
  return (
    <div className="space-y-5">
      <Detail label="대표 표현을 보존한 원천 내용" value={item.raw_text} />
      <div className="grid gap-5 md:grid-cols-3">
        <Detail label="통념을 뒤집는 관점" value={item.perspective} />
        <Detail label="사례·숫자·전후 변화" value={item.case_evidence} />
        <Detail label="울림만의 방식·절대 하지 않는 것" value={item.differentiator} />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <h4 className="text-sm font-bold">{label}</h4>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#5f5750]">{value || "입력된 내용이 없습니다."}</p>
    </div>
  );
}

function EditForm({ value, onChange }: { value: EditableKnowledge; onChange: (value: EditableKnowledge) => void }) {
  return (
    <div className="space-y-5">
      <label className="block"><span className="mb-2 block text-sm font-bold">주제</span><input className="input" value={value.topic} onChange={(e) => onChange({ ...value, topic: e.target.value })} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-2 block text-sm font-bold">자료 종류</span><select className="input" value={value.source_type} onChange={(e) => onChange({ ...value, source_type: e.target.value as ExpertKnowledge["source_type"] })}><option value="interview">인터뷰</option><option value="case">사례</option><option value="note">업무 노트</option></select></label>
        <label className="block"><span className="mb-2 block text-sm font-bold">전문 분야</span><select className="input" value={value.expertise_area} onChange={(e) => onChange({ ...value, expertise_area: e.target.value as ExpertKnowledge["expertise_area"] })}>{EXPERTISE_AREAS.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</select></label>
      </div>
      <label className="block"><span className="mb-2 block text-sm font-bold">대표 표현을 보존한 원천 내용</span><textarea rows={12} className="input" value={value.raw_text} onChange={(e) => onChange({ ...value, raw_text: e.target.value })} /></label>
      <label className="block"><span className="mb-2 block text-sm font-bold">통념을 뒤집는 관점</span><textarea rows={4} className="input" value={value.perspective || ""} onChange={(e) => onChange({ ...value, perspective: e.target.value })} /></label>
      <label className="block"><span className="mb-2 block text-sm font-bold">사례·숫자·전후 변화</span><textarea rows={4} className="input" value={value.case_evidence || ""} onChange={(e) => onChange({ ...value, case_evidence: e.target.value })} /></label>
      <label className="block"><span className="mb-2 block text-sm font-bold">울림만의 방식·절대 하지 않는 것</span><textarea rows={4} className="input" value={value.differentiator || ""} onChange={(e) => onChange({ ...value, differentiator: e.target.value })} /></label>
    </div>
  );
}

function ApprovalDialog({ item, updating, onClose, onApprove }: { item: ExpertKnowledge; updating: boolean; onClose: () => void; onApprove: () => void }) {
  const flagged = needsReview(item);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-sm bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--line)] bg-white p-5">
          <div>
            <p className="text-xs font-bold text-[var(--primary)]">승인 전 최종 검토</p>
            <h2 id="approval-title" className="mt-1 text-xl font-bold">{item.topic}</h2>
          </div>
          <button type="button" aria-label="검토 창 닫기" onClick={onClose} className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-[var(--line)]"><X size={18} /></button>
        </div>
        <div className="p-5">
          {flagged && (
            <div className="mb-6 flex gap-3 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 shrink-0" size={19} />
              <p><strong>확인이 필요한 표현이 남아 있습니다.</strong><br />공식 수치와 사실을 확인하고, 고객명·성과 사례 등 공개하면 안 되는 정보는 익명화했는지 살펴보세요.</p>
            </div>
          )}
          <KnowledgeDetails item={item} />
          <div className="mt-7 border-t border-[var(--line)] pt-5">
            <p className="text-sm leading-6 text-[#5f5750]">승인하면 이 자료가 AI 칼럼 생성에 사용될 수 있습니다. 위 내용을 모두 읽고 사실관계와 공개 가능 여부를 확인한 경우에만 승인해 주세요.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-sm border border-[var(--line)] px-4 py-2.5 text-sm font-bold">돌아가서 수정</button>
              <button type="button" disabled={updating} onClick={onApprove} className="inline-flex items-center gap-2 rounded-sm bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                <Eye size={16} /> {updating ? "승인 중…" : "전체 내용을 확인했으며 승인"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="min-h-[70vh] bg-[#fffaf7]"><div className="mx-auto max-w-5xl px-5 py-16 lg:px-8">{children}</div></section>;
}
