"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine, Save } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccess } from "@/hooks/useAccess";
import VisualHtmlEditor from "@/components/admin/VisualHtmlEditor";
import { readJsonResponse } from "@/lib/http/read-json";
import type { ColumnKind } from "@/lib/columns/types";

/**
 * 직접 쓴 칼럼을 그대로 올립니다.
 *
 * 블로그에는 「직접 쓴 원고 넣기」가 있는데 칼럼에는 없었습니다. 저장하는
 * 기능은 이미 있었고 화면만 없어서, 급한 글도 AI 를 부를 수밖에 없었습니다.
 *
 * 이 화면은 Gemini 를 한 번도 부르지 않습니다. 요금이 들지 않고 기다릴
 * 필요도 없습니다. 대신 AI 가 하던 검사도 없으니 그대로 저장됩니다.
 */

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
};

const EMPTY: FormState = {
  title: "", slug: "", excerpt: "", content: "", tags: "", category: "",
  content_kind: "informational", audience: "", core_message: "",
};

/**
 * 제목에서 주소를 만듭니다.
 *
 * 한글은 주소에 쓸 수 없어 날짜로 대신합니다. 비워 두면 저장이 막히므로
 * 사람이 매번 영문을 지어내야 했습니다. 언제든 직접 고칠 수 있습니다.
 */
function slugFromTitle(title: string) {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (ascii.length >= 3) return ascii.slice(0, 60);
  return `column-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export default function NewColumnPage() {
  const { user, loading: authLoading } = useAuth();
  const access = useAccess(user?.email);
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = access.admin;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.content.trim()) {
      setError("본문을 넣어 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          slug: form.slug.trim() || slugFromTitle(form.title),
          tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          // 사람이 확인하고 발행합니다. 손으로 쓴 글도 바로 공개하지 않습니다.
          published: false,
          generation_status: "draft",
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "저장하지 못했습니다.");
      }
      router.push("/admin/columns");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (Boolean(user) && access.loading)) {
    return <Shell><p>로그인 상태를 확인하고 있습니다.</p></Shell>;
  }
  if (!isAdmin) return <Shell><p>{access.error || "관리자 권한이 없습니다."}</p></Shell>;

  return (
    <Shell>
      <Link href="/admin/columns" className="text-sm text-[var(--muted)]">← 칼럼 관리</Link>
      <h1 className="mt-5 flex items-center gap-3 text-3xl font-bold">
        <PenLine size={26} /> 직접 쓴 칼럼 넣기
      </h1>
      <p className="prose-muted mt-3">
        AI를 부르지 않습니다. 요금이 들지 않고 기다릴 필요도 없습니다.
        비공개 초안으로 저장되니, 확인한 뒤 편집기에서 공개하시면 됩니다.
      </p>

      <form onSubmit={save} className="mt-8 space-y-6">
        <Field label="제목">
          <input
            required
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            className="input"
          />
        </Field>
        <Field label="URL 슬러그 (비워 두면 자동)">
          <div className="flex items-center">
            <span className="mr-2 text-sm text-[var(--muted)]">/columns/</span>
            <input
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
              placeholder={form.title ? slugFromTitle(form.title) : "column-20260826"}
              className="input"
            />
          </div>
        </Field>
        <Field label="요약">
          <textarea
            value={form.excerpt}
            onChange={(event) => setForm({ ...form, excerpt: event.target.value })}
            rows={3}
            className="input"
          />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="카테고리">
            <input
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              className="input"
            />
          </Field>
          <Field label="콘텐츠 유형">
            <select
              value={form.content_kind}
              onChange={(event) => setForm({ ...form, content_kind: event.target.value as ColumnKind })}
              className="input"
            >
              <option value="informational">정보형</option>
              <option value="hybrid">하이브리드형</option>
              <option value="authority">권위형</option>
            </select>
          </Field>
        </div>
        <Field label="독자 한 명">
          <input
            value={form.audience}
            onChange={(event) => setForm({ ...form, audience: event.target.value })}
            className="input"
          />
        </Field>
        <Field label="핵심 한 문장">
          <input
            value={form.core_message}
            onChange={(event) => setForm({ ...form, core_message: event.target.value })}
            className="input"
          />
        </Field>
        <Field label="본문">
          <VisualHtmlEditor
            value={form.content}
            onChange={(content) => setForm((current) => ({ ...current, content }))}
          />
        </Field>
        <Field label="태그 (쉼표로 구분)">
          <input
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            className="input"
          />
        </Field>

        {error && (
          <p className="rounded-sm border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-900">
            {error}
          </p>
        )}

        <button
          disabled={saving}
          className="btn-gradient inline-flex items-center gap-2 rounded-sm px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          <Save size={18} /> {saving ? "저장 중…" : "비공개 초안으로 저장"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="min-h-[70vh] bg-[#fffaf7]">
      <div className="mx-auto max-w-4xl px-5 py-16 lg:px-8">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="block"><span className="mb-2 block font-bold">{label}</span>{children}</div>;
}
