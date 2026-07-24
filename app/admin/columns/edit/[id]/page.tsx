"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { ColumnKind, ColumnPost } from "@/lib/columns/types";

type FormState = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  tags: string;
  category: string;
  content_kind: ColumnKind;
  audience: string;
  core_message: string;
  published: boolean;
};

const EMPTY: FormState = {
  title: "", slug: "", excerpt: "", content: "", tags: "", category: "",
  content_kind: "informational", audience: "", core_message: "", published: false,
};

export default function EditColumnPage() {
  const { user, loading: authLoading } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isAdmin = user?.email?.toLowerCase() === "miseong0928@gmail.com";

  useEffect(() => {
    if (!authLoading && isAdmin) {
      fetch(`/api/admin/columns/${params.id}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("칼럼을 불러오지 못했습니다.");
          return response.json() as Promise<ColumnPost>;
        })
        .then((post) => setForm({
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt || "",
          content: post.content,
          tags: post.tags.join(", "),
          category: post.category || "",
          content_kind: post.content_kind,
          audience: post.audience || "",
          core_message: post.core_message || "",
          published: post.published,
        }))
        .catch(() => router.push("/admin/columns"))
        .finally(() => setLoading(false));
    }
  }, [authLoading, isAdmin, params.id, router]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const response = await fetch(`/api/admin/columns/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      }),
    });
    setSaving(false);
    if (response.ok) router.push("/admin/columns");
    else window.alert((await response.json()).error || "저장에 실패했습니다.");
  };

  if (authLoading) return <Shell><p>로그인 상태를 확인하고 있습니다.</p></Shell>;
  if (!isAdmin) return <Shell><p>관리자 권한이 없습니다.</p></Shell>;
  if (loading) return <Shell><p>칼럼을 불러오는 중입니다.</p></Shell>;

  return (
    <Shell>
      <Link href="/admin/columns" className="text-sm text-[var(--muted)]">← 칼럼 관리</Link>
      <h1 className="mt-5 text-3xl font-bold">칼럼 검토 및 수정</h1>
      <form onSubmit={save} className="mt-8 space-y-6">
        <Field label="제목"><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" /></Field>
        <Field label="URL 슬러그"><div className="flex items-center"><span className="mr-2 text-sm text-[var(--muted)]">/columns/</span><input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="input" /></div></Field>
        <Field label="요약"><textarea value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} rows={3} className="input" /></Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="카테고리"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input" /></Field>
          <Field label="콘텐츠 유형">
            <select value={form.content_kind} onChange={(e) => setForm({ ...form, content_kind: e.target.value as ColumnKind })} className="input">
              <option value="informational">정보형</option><option value="hybrid">하이브리드형</option><option value="authority">권위형</option>
            </select>
          </Field>
        </div>
        <Field label="독자 한 명"><input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="input" /></Field>
        <Field label="핵심 한 문장"><input value={form.core_message} onChange={(e) => setForm({ ...form, core_message: e.target.value })} className="input" /></Field>
        <Field label="본문 HTML"><textarea required value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={28} className="input font-mono text-sm" /></Field>
        <Field label="태그 (쉼표로 구분)"><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="input" /></Field>
        <label className="flex items-center gap-3 rounded-sm border border-[var(--line)] bg-white p-5">
          <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
          <span><strong>공개하기</strong><span className="ml-2 text-sm text-[var(--muted)]">검토가 끝난 글만 선택하세요.</span></span>
        </label>
        <button disabled={saving} className="btn-gradient inline-flex items-center gap-2 rounded-sm px-6 py-3 font-bold text-white disabled:opacity-50">
          <Save size={18} /> {saving ? "저장 중…" : "저장하기"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="min-h-[70vh] bg-[#fffaf7]"><div className="mx-auto max-w-4xl px-5 py-16 lg:px-8">{children}</div></section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block font-bold">{label}</span>{children}</label>;
}
