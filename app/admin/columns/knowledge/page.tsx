"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Check, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { ExpertKnowledge } from "@/lib/columns/types";

export default function KnowledgePage() {
  const { user, loading } = useAuth();
  const isAdmin = user?.email?.toLowerCase() === "miseong0928@gmail.com";
  const [items, setItems] = useState<ExpertKnowledge[]>([]);
  const [form, setForm] = useState({
    topic: "", source_type: "interview", raw_text: "", perspective: "",
    case_evidence: "", differentiator: "", approved: true,
  });
  const [saving, setSaving] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

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
      setForm({ topic: "", source_type: "interview", raw_text: "", perspective: "", case_evidence: "", differentiator: "", approved: true });
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
      <div className="mt-6 rounded-sm border border-[var(--line)] bg-white p-6">
        <div className="flex items-start gap-3">
          <Upload className="mt-0.5 text-[var(--primary)]" />
          <div>
            <h2 className="font-bold">인터뷰·강의 자료 파일로 가져오기</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">TXT 또는 DOCX 파일을 올리면 AI가 주제별 노하우 카드로 나눕니다. 분류된 카드는 검토 전까지 미승인 상태입니다.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="file"
            accept=".txt,.docx"
            onChange={(event) => setImportFile(event.target.files?.[0] || null)}
            className="input"
          />
          <button type="button" disabled={!importFile || importing} onClick={() => void importKnowledge()} className="btn-gradient shrink-0 rounded-sm px-5 py-3 font-bold text-white disabled:opacity-50">
            {importing ? "분류 중…" : "파일 분석하기"}
          </button>
        </div>
      </div>
      <form onSubmit={save} className="mt-8 space-y-5 rounded-sm border border-[var(--line)] bg-white p-6">
        <label className="block"><span className="mb-2 block font-bold">주제</span><input required className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="예: 사업계획서에서 심사위원이 실제로 확인하는 것" /></label>
        <label className="block"><span className="mb-2 block font-bold">자료 종류</span><select className="input" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}><option value="interview">인터뷰</option><option value="case">사례</option><option value="note">업무 노트</option></select></label>
        <label className="block"><span className="mb-2 block font-bold">원천 내용</span><textarea required rows={12} className="input" value={form.raw_text} onChange={(e) => setForm({ ...form, raw_text: e.target.value })} placeholder="녹취록이나 메모를 그대로 붙여 넣어도 됩니다." /></label>
        <label className="block"><span className="mb-2 block font-bold">통념을 뒤집는 관점 (선택)</span><textarea rows={3} className="input" value={form.perspective} onChange={(e) => setForm({ ...form, perspective: e.target.value })} /></label>
        <label className="block"><span className="mb-2 block font-bold">사례·숫자·전후 변화 (선택)</span><textarea rows={3} className="input" value={form.case_evidence} onChange={(e) => setForm({ ...form, case_evidence: e.target.value })} /></label>
        <label className="block"><span className="mb-2 block font-bold">울림만의 방식·절대 하지 않는 것 (선택)</span><textarea rows={3} className="input" value={form.differentiator} onChange={(e) => setForm({ ...form, differentiator: e.target.value })} /></label>
        <label className="flex items-center gap-3"><input type="checkbox" checked={form.approved} onChange={(e) => setForm({ ...form, approved: e.target.checked })} /><span>칼럼 생성에 사용하도록 승인</span></label>
        <button disabled={saving} className="btn-gradient rounded-sm px-6 py-3 font-bold text-white disabled:opacity-50">{saving ? "저장 중…" : "원천자료 저장"}</button>
      </form>
      <div className="mt-10 space-y-4">
        {items.map((item) => (
          <article key={item.id} className="rounded-sm border border-[var(--line)] bg-white p-5">
            <div className="flex justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--primary)]">
                  {item.source_type} · {item.approved ? "승인됨" : "미승인"} · 사용 {Number(item.use_count || 0)}회
                  {Number(item.use_count || 0) >= 3 && " · 새 자료 권장"}
                </p>
                <h2 className="mt-2 font-bold">{item.topic}</h2>
                <p className="prose-muted mt-3 line-clamp-3 text-sm">{item.raw_text}</p>
              </div>
              <div className="flex shrink-0 items-start gap-3">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1 rounded-sm border px-3 py-1.5 text-sm font-bold ${item.approved ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-[var(--line)] bg-white"}`}
                  onClick={async () => {
                    await fetch("/api/admin/columns/knowledge", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: item.id, approved: !item.approved }),
                    });
                    await load();
                  }}
                >
                  <Check size={15} /> {item.approved ? "승인됨" : "승인하기"}
                </button>
                <button aria-label="삭제" onClick={async () => { if (confirm("이 원천자료를 삭제할까요?")) { await fetch(`/api/admin/columns/knowledge?id=${item.id}`, { method: "DELETE" }); await load(); } }}><Trash2 size={18} /></button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="min-h-[70vh] bg-[#fffaf7]"><div className="mx-auto max-w-4xl px-5 py-16 lg:px-8">{children}</div></section>;
}
