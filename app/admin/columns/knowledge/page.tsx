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
import type { ExpertKnowledge } from "@/lib/columns/types";
import { EXPERTISE_AREAS } from "@/lib/columns/interview-requests";
import InterviewRequests from "./InterviewRequests";

type Filter = "all" | "pending" | "approved" | "needs_review";
type EditableKnowledge = Pick<
  ExpertKnowledge,
  "topic" | "source_type" | "expertise_area" | "raw_text" | "perspective" | "case_evidence" | "differentiator"
>;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "?꾩껜" },
  { value: "pending", label: "誘몄듅?? },
  { value: "approved", label: "?뱀씤" },
  { value: "needs_review", label: "?뺤씤 ?꾩슂" },
];

const SOURCE_LABELS: Record<ExpertKnowledge["source_type"], string> = {
  interview: "?명꽣酉?,
  case: "?щ?",
  note: "?낅Т ?명듃",
};

const REVIEW_MARKERS = ["[諛쒗뻾 ??怨듭떇 ?뺤씤 ?꾩슂]", "[怨듭떇 ?뺤씤 ?꾩슂]", "[?듬챸???꾩슂]", "?뺤씤 ?꾩슂"];

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
  const { user, loading } = useAuth();
  const isAdmin = user?.email?.toLowerCase() === "miseong0928@gmail.com";
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
      window.alert(`${result.count}媛쒖쓽 ?명븯??移대뱶濡?遺꾨쪟?덉뒿?덈떎. ?댁슜???뺤씤?????뱀씤??二쇱꽭??`);
    } else window.alert((await response.json()).error || "?뚯씪 遺꾨쪟???ㅽ뙣?덉뒿?덈떎.");
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
      window.alert((await response.json()).error || "?먮즺瑜??섏젙?섏? 紐삵뻽?듬땲??");
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
      window.alert("二쇱젣? ?먯쿇 ?댁슜? ?꾩닔?낅땲??");
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

  if (loading) return <Shell><p>濡쒓렇???곹깭瑜??뺤씤?섍퀬 ?덉뒿?덈떎.</p></Shell>;
  if (!isAdmin) return <Shell><p>愿由ъ옄 沅뚰븳???놁뒿?덈떎.</p></Shell>;

  const approvedItems = items.filter((item) => item.approved);
  const remainingUses = approvedItems.reduce(
    (total, item) => total + Math.max(0, 3 - Number(item.use_count || 0)),
    0,
  );

  return (
    <Shell>
      <Link href="/admin/columns" className="text-sm text-[var(--muted)]">??移쇰읆 愿由?/Link>
      <div className="mt-5 flex items-center gap-3"><BookOpen className="text-[var(--primary)]" /><h1 className="text-3xl font-bold">?몃┝ ?명븯???먮즺??/h1></div>
      <p className="prose-muted mt-3">?명꽣酉??뱀랬, ?ㅼ젣 ?щ?, ??쒕떂???먮떒 湲곗?????ν빀?덈떎. ?뱀씤???먮즺留??섏씠釉뚮━?쑣룰텒?꾪삎 移쇰읆???ъ슜?⑸땲??</p>
      <div className={`mt-6 rounded-sm border p-5 ${remainingUses <= 3 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        <p className="font-bold">?먯쿇?먮즺 ?ъ슜 ?꾪솴</p>
        <p className="mt-1 text-sm text-[#5f5750]">
          ?뱀씤 ?먮즺 {approvedItems.length}媛?쨌 ?덉긽 ?쒖슜 ?ъ쑀 {remainingUses}??          {remainingUses <= 3 && " 쨌 ?덈줈???명꽣酉곕굹 ?щ?瑜?異붽????쒖젏?낅땲??"}
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">???먮즺???댁슜 諛섎났??留됯린 ?꾪빐 湲곕낯 3?뚭퉴吏留??쒖슜 ?ъ쑀濡?怨꾩궛?⑸땲??</p>
      </div>
      <InterviewRequests />
      <div id="upload-source" className="mt-6 scroll-mt-24 rounded-sm border border-[var(--line)] bg-white p-6">
        <div className="flex items-start gap-3">
          <Upload className="mt-0.5 text-[var(--primary)]" />
          <div>
            <h2 className="font-bold">?명꽣酉걔룰컯???먮즺 ?뚯씪濡?媛?몄삤湲?/h2>
            <p className="mt-1 text-sm text-[var(--muted)]">TXT ?먮뒗 DOCX ?뚯씪???щ━硫?AI媛 二쇱젣蹂??명븯??移대뱶濡??섎닏?덈떎. 遺꾨쪟??移대뱶??寃???꾧퉴吏 誘몄듅???곹깭?낅땲??</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input type="file" accept=".txt,.docx" onChange={(event) => setImportFile(event.target.files?.[0] || null)} className="input" />
          <button type="button" disabled={!importFile || importing} onClick={() => void importKnowledge()} className="btn-gradient shrink-0 rounded-sm px-5 py-3 font-bold text-white disabled:opacity-50">
            {importing ? "遺꾨쪟 以묅? : "?뚯씪 遺꾩꽍?섍린"}
          </button>
        </div>
      </div>
      <form onSubmit={save} className="mt-8 space-y-5 rounded-sm border border-[var(--line)] bg-white p-6">
        <label className="block"><span className="mb-2 block font-bold">二쇱젣</span><input required className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="?? ?ъ뾽怨꾪쉷?쒖뿉???ъ궗?꾩썝???ㅼ젣濡??뺤씤?섎뒗 寃? /></label>
        <label className="block"><span className="mb-2 block font-bold">?먮즺 醫낅쪟</span><select className="input" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}><option value="interview">?명꽣酉?/option><option value="case">?щ?</option><option value="note">?낅Т ?명듃</option></select></label>
        <label className="block">
          <span className="mb-2 block font-bold">?꾨Ц 遺꾩빞</span>
          <select className="input" value={form.expertise_area} onChange={(e) => setForm({ ...form, expertise_area: e.target.value })}>
            {EXPERTISE_AREAS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-2 block font-bold">?먯쿇 ?댁슜</span><textarea required rows={12} className="input" value={form.raw_text} onChange={(e) => setForm({ ...form, raw_text: e.target.value })} placeholder="?뱀랬濡앹씠??硫붾え瑜?洹몃?濡?遺숈뿬 ?ｌ뼱???⑸땲??" /></label>
        <label className="block"><span className="mb-2 block font-bold">?듬뀗???ㅼ쭛??愿??(?좏깮)</span><textarea rows={3} className="input" value={form.perspective} onChange={(e) => setForm({ ...form, perspective: e.target.value })} /></label>
        <label className="block"><span className="mb-2 block font-bold">?щ?쨌?レ옄쨌?꾪썑 蹂??(?좏깮)</span><textarea rows={3} className="input" value={form.case_evidence} onChange={(e) => setForm({ ...form, case_evidence: e.target.value })} /></label>
        <label className="block"><span className="mb-2 block font-bold">?몃┝留뚯쓽 諛⑹떇쨌?덈? ?섏? ?딅뒗 寃?(?좏깮)</span><textarea rows={3} className="input" value={form.differentiator} onChange={(e) => setForm({ ...form, differentiator: e.target.value })} /></label>
        <label className="flex items-center gap-3"><input type="checkbox" checked={form.approved} onChange={(e) => setForm({ ...form, approved: e.target.checked })} /><span>移쇰읆 ?앹꽦???ъ슜?섎룄濡??뱀씤</span></label>
        <button disabled={saving} className="btn-gradient rounded-sm px-6 py-3 font-bold text-white disabled:opacity-50">{saving ? "???以묅? : "?먯쿇?먮즺 ???}</button>
      </form>

      <section className="mt-10">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-xl font-bold">??λ맂 ?먯쿇?먮즺</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">移대뱶瑜??꾨Ⅴ硫??꾩껜 ?댁슜???쇱퀜吏묐땲??</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="?먯쿇?먮즺 ?꾪꽣">
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
                      <span className="text-[var(--muted)]">쨌 {SOURCE_LABELS[item.source_type]} 쨌 ?ъ슜 {Number(item.use_count || 0)}??/span>
                      <span className={`rounded-sm px-2 py-1 ${item.approved ? "bg-emerald-50 text-emerald-800" : "bg-[#f2efec] text-[#5f5750]"}`}>{item.approved ? "?뱀씤" : "誘몄듅??}</span>
                      {flagged && <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-2 py-1 text-amber-900"><AlertTriangle size={13} /> ?뺤씤 ?꾩슂</span>}
                      {Number(item.use_count || 0) >= 3 && <span className="text-amber-800">???먮즺 沅뚯옣</span>}
                    </div>
                    <h3 className="mt-3 text-lg font-bold">{item.topic}</h3>
                    {!expanded && <p className="prose-muted mt-3 line-clamp-3 text-sm">{item.raw_text}</p>}
                  </button>
                  <div className="flex shrink-0 flex-wrap items-start gap-2">
                    <button type="button" onClick={() => startEditing(item)} className="inline-flex items-center gap-1 rounded-sm border border-[var(--line)] px-3 py-2 text-sm font-bold">
                      <Pencil size={15} /> ?곸꽭蹂닿린쨌?섏젙
                    </button>
                    {item.approved ? (
                      <button
                        type="button"
                        disabled={updatingId === item.id}
                        onClick={() => {
                          if (window.confirm("???먮즺???뱀씤??痍⑥냼?좉퉴?? 痍⑥냼?섎㈃ ??移쇰읆 ?앹꽦???ъ슜?섏? ?딆뒿?덈떎.")) void patchItem(item.id, { approved: false });
                        }}
                        className="inline-flex items-center gap-1 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800 disabled:opacity-50"
                      >
                        <X size={15} /> ?뱀씤 痍⑥냼
                      </button>
                    ) : (
                      <button type="button" onClick={() => setReviewingItem(item)} className="inline-flex items-center gap-1 rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                        <Check size={15} /> 寃?????뱀씤
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`${item.topic} ??젣`}
                      className="inline-flex size-9 items-center justify-center rounded-sm border border-[var(--line)] text-rose-700"
                      onClick={async () => {
                        if (window.confirm("???먯쿇?먮즺瑜???젣?좉퉴?? ??젣???먮즺??蹂듦뎄?????놁뒿?덈떎.")) {
                          const response = await fetch(`/api/admin/columns/knowledge?id=${item.id}`, { method: "DELETE" });
                          if (response.ok) await load();
                          else window.alert("?먮즺瑜???젣?섏? 紐삵뻽?듬땲??");
                        }
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                    <button type="button" aria-label={expanded ? "?댁슜 ?묎린" : "?댁슜 ?쇱튂湲?} onClick={() => toggleExpanded(item.id)} className="inline-flex size-9 items-center justify-center rounded-sm border border-[var(--line)]">
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
                          <button type="button" onClick={() => { setEditingId(null); setEditForm(null); }} className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-bold">痍⑥냼</button>
                          <button type="button" disabled={updatingId === item.id} onClick={() => void saveEdit(item)} className="inline-flex items-center gap-2 rounded-sm bg-[#201d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                            <Save size={16} /> {updatingId === item.id ? "???以묅? : "?섏젙 ???}
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => startEditing(item)} className="inline-flex items-center gap-2 rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-bold"><Pencil size={16} /> ?섏젙?섍린</button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          {filteredItems.length === 0 && <p className="rounded-sm border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">??議곌굔???대떦?섎뒗 ?먮즺媛 ?놁뒿?덈떎.</p>}
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
      <Detail label="?먯쿇 ?댁슜" value={item.raw_text} />
      <div className="grid gap-5 md:grid-cols-3">
        <Detail label="?듬뀗???ㅼ쭛??愿?? value={item.perspective} />
        <Detail label="?щ?쨌?レ옄쨌?꾪썑 蹂?? value={item.case_evidence} />
        <Detail label="?몃┝留뚯쓽 諛⑹떇쨌?덈? ?섏? ?딅뒗 寃? value={item.differentiator} />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <h4 className="text-sm font-bold">{label}</h4>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#5f5750]">{value || "?낅젰???댁슜???놁뒿?덈떎."}</p>
    </div>
  );
}

function EditForm({ value, onChange }: { value: EditableKnowledge; onChange: (value: EditableKnowledge) => void }) {
  return (
    <div className="space-y-5">
      <label className="block"><span className="mb-2 block text-sm font-bold">二쇱젣</span><input className="input" value={value.topic} onChange={(e) => onChange({ ...value, topic: e.target.value })} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-2 block text-sm font-bold">?먮즺 醫낅쪟</span><select className="input" value={value.source_type} onChange={(e) => onChange({ ...value, source_type: e.target.value as ExpertKnowledge["source_type"] })}><option value="interview">?명꽣酉?/option><option value="case">?щ?</option><option value="note">?낅Т ?명듃</option></select></label>
        <label className="block"><span className="mb-2 block text-sm font-bold">?꾨Ц 遺꾩빞</span><select className="input" value={value.expertise_area} onChange={(e) => onChange({ ...value, expertise_area: e.target.value as ExpertKnowledge["expertise_area"] })}>{EXPERTISE_AREAS.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</select></label>
      </div>
      <label className="block"><span className="mb-2 block text-sm font-bold">?먯쿇 ?댁슜</span><textarea rows={12} className="input" value={value.raw_text} onChange={(e) => onChange({ ...value, raw_text: e.target.value })} /></label>
      <label className="block"><span className="mb-2 block text-sm font-bold">?듬뀗???ㅼ쭛??愿??/span><textarea rows={4} className="input" value={value.perspective || ""} onChange={(e) => onChange({ ...value, perspective: e.target.value })} /></label>
      <label className="block"><span className="mb-2 block text-sm font-bold">?щ?쨌?レ옄쨌?꾪썑 蹂??/span><textarea rows={4} className="input" value={value.case_evidence || ""} onChange={(e) => onChange({ ...value, case_evidence: e.target.value })} /></label>
      <label className="block"><span className="mb-2 block text-sm font-bold">?몃┝留뚯쓽 諛⑹떇쨌?덈? ?섏? ?딅뒗 寃?/span><textarea rows={4} className="input" value={value.differentiator || ""} onChange={(e) => onChange({ ...value, differentiator: e.target.value })} /></label>
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
            <p className="text-xs font-bold text-[var(--primary)]">?뱀씤 ??理쒖쥌 寃??/p>
            <h2 id="approval-title" className="mt-1 text-xl font-bold">{item.topic}</h2>
          </div>
          <button type="button" aria-label="寃??李??リ린" onClick={onClose} className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-[var(--line)]"><X size={18} /></button>
        </div>
        <div className="p-5">
          {flagged && (
            <div className="mb-6 flex gap-3 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 shrink-0" size={19} />
              <p><strong>?뺤씤???꾩슂???쒗쁽???⑥븘 ?덉뒿?덈떎.</strong><br />怨듭떇 ?섏튂? ?ъ떎???뺤씤?섍퀬, 怨좉컼紐끒룹꽦怨??щ? ??怨듦컻?섎㈃ ???섎뒗 ?뺣낫???듬챸?뷀뻽?붿? ?댄렣蹂댁꽭??</p>
            </div>
          )}
          <KnowledgeDetails item={item} />
          <div className="mt-7 border-t border-[var(--line)] pt-5">
            <p className="text-sm leading-6 text-[#5f5750]">?뱀씤?섎㈃ ???먮즺媛 AI 移쇰읆 ?앹꽦???ъ슜?????덉뒿?덈떎. ???댁슜??紐⑤몢 ?쎄퀬 ?ъ떎愿怨꾩? 怨듦컻 媛???щ?瑜??뺤씤??寃쎌슦?먮쭔 ?뱀씤??二쇱꽭??</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-sm border border-[var(--line)] px-4 py-2.5 text-sm font-bold">?뚯븘媛???섏젙</button>
              <button type="button" disabled={updating} onClick={onApprove} className="inline-flex items-center gap-2 rounded-sm bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                <Eye size={16} /> {updating ? "?뱀씤 以묅? : "?꾩껜 ?댁슜???뺤씤?덉쑝硫??뱀씤"}
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

