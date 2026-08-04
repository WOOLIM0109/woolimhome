"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bold, Heading2, Heading3, List, ListOrdered, Pilcrow, Save } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccess } from "@/hooks/useAccess";
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
  const access = useAccess(user?.email);
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isAdmin = access.admin;

  useEffect(() => {
    if (!authLoading && !access.loading && isAdmin) {
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
  }, [access.loading, authLoading, isAdmin, params.id, router]);

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

  if (authLoading || (Boolean(user) && access.loading)) return <Shell><p>로그인 상태를 확인하고 있습니다.</p></Shell>;
  if (!isAdmin) return <Shell><p>{access.error || "관리자 권한이 없습니다."}</p></Shell>;
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
        <Field label="본문">
          <VisualHtmlEditor
            value={form.content}
            onChange={(content) => setForm((current) => ({ ...current, content }))}
          />
        </Field>
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
  return <div className="block"><span className="mb-2 block font-bold">{label}</span>{children}</div>;
}

function VisualHtmlEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value && document.activeElement !== editor) {
      editor.innerHTML = value;
    }
  }, [mode, value]);

  const sync = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const command = (name: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, commandValue);
    sync();
  };

  return (
    <div className="overflow-hidden rounded-sm border border-[var(--line)] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[#fffaf7] px-3 py-2">
        <div className="flex flex-wrap gap-1" aria-label="본문 서식 도구">
          {mode === "visual" && (
            <>
              <EditorButton label="본문" onClick={() => command("formatBlock", "p")}><Pilcrow size={17} /></EditorButton>
              <EditorButton label="큰 제목" onClick={() => command("formatBlock", "h2")}><Heading2 size={17} /></EditorButton>
              <EditorButton label="작은 제목" onClick={() => command("formatBlock", "h3")}><Heading3 size={17} /></EditorButton>
              <EditorButton label="굵게" onClick={() => command("bold")}><Bold size={17} /></EditorButton>
              <EditorButton label="글머리표" onClick={() => command("insertUnorderedList")}><List size={17} /></EditorButton>
              <EditorButton label="번호 목록" onClick={() => command("insertOrderedList")}><ListOrdered size={17} /></EditorButton>
            </>
          )}
        </div>
        <div className="flex rounded-sm border border-[var(--line)] bg-white p-1 text-sm">
          <button type="button" onClick={() => setMode("visual")} className={`rounded-sm px-3 py-1.5 ${mode === "visual" ? "bg-[#14100c] text-white" : "text-[var(--muted)]"}`}>
            일반 편집
          </button>
          <button type="button" onClick={() => setMode("html")} className={`rounded-sm px-3 py-1.5 ${mode === "html" ? "bg-[#14100c] text-white" : "text-[var(--muted)]"}`}>
            HTML 원문
          </button>
        </div>
      </div>

      {mode === "visual" ? (
        <>
          <p className="border-b border-[var(--line)] bg-[#fffdfb] px-5 py-3 text-sm text-[var(--muted)]">
            실제 게시 화면과 비슷하게 보면서 글자를 직접 고칠 수 있습니다. 문장을 선택한 뒤 위 버튼으로 제목·굵기·목록을 바꿔보세요.
          </p>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={sync}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) event.preventDefault();
            }}
            className="column-body min-h-[36rem] px-6 py-7 outline-none lg:px-10"
            dangerouslySetInnerHTML={{ __html: value }}
          />
        </>
      ) : (
        <textarea
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={28}
          className="w-full resize-y p-5 font-mono text-sm leading-6 outline-none"
        />
      )}
    </div>
  );
}

function EditorButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-sm px-2 text-sm text-[#302b27] hover:bg-white"
    >
      {children}<span className="sr-only">{label}</span>
    </button>
  );
}
