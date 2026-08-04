"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen, Bot, CheckCircle2, Edit, Eye, EyeOff, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccess } from "@/hooks/useAccess";
import type { ColumnPost } from "@/lib/columns/types";
import { EXPERTISE_AREAS } from "@/lib/columns/interview-requests";
import EditorialSchedule from "./EditorialSchedule";

type KnowledgeSummary = {
  id: string;
  topic: string;
  expertise_area: string;
  approved: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
};

export default function AdminColumnsPage() {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  const access = useAccess(user?.email);
  const [posts, setPosts] = useState<ColumnPost[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeSummary[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const loading = authLoading || (Boolean(user) && access.loading);
  const isAdmin = access.admin;

  const loadPosts = async () => {
    const response = await fetch("/api/admin/columns", { cache: "no-store" });
    if (response.ok) setPosts(await response.json());
    setLoadingPosts(false);
  };

  useEffect(() => {
    if (!loading && user && isAdmin) {
      Promise.all([
        fetch("/api/admin/columns", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : []),
        fetch("/api/admin/columns/knowledge?summary=1", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : []),
      ]).then(([postData, knowledgeData]: [ColumnPost[], KnowledgeSummary[]]) => {
        setPosts(postData);
        setKnowledge(knowledgeData);
      }).finally(() => setLoadingPosts(false));
    }
  }, [loading, user, isAdmin]);

  if (loading) return <AdminShell><p>로그인 상태를 확인하고 있습니다.</p></AdminShell>;
  if (!user) {
    return (
      <AdminShell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-3xl font-bold">울림 칼럼 관리자</h1>
          <p className="prose-muted mt-4">승인된 Google 계정으로 로그인해 주세요.</p>
          <button onClick={() => void signInWithGoogle()} className="btn-gradient mt-8 rounded-sm px-6 py-3 font-bold text-white">
            Google로 로그인
          </button>
        </div>
      </AdminShell>
    );
  }
  if (!isAdmin) {
    return (
      <AdminShell>
        <h1 className="text-2xl font-bold text-red-700">접근 권한이 없습니다.</h1>
        <p className="mt-3">{access.error || `${user.email} 계정에는 관리자 권한이 없습니다.`}</p>
        <button onClick={() => void signOut()} className="mt-6 underline">로그아웃</button>
      </AdminShell>
    );
  }

  const remove = async (post: ColumnPost) => {
    if (!window.confirm(`"${post.title}" 초안을 삭제할까요?`)) return;
    await fetch(`/api/admin/columns/${post.id}`, { method: "DELETE" });
    await loadPosts();
  };

  const approvedKnowledge = knowledge.filter((item) => item.approved);
  const remainingKnowledgeUses = approvedKnowledge.reduce(
    (total, item) => total + Math.max(0, 3 - Number(item.use_count || 0)),
    0,
  );
  const knowledgeLevel = remainingKnowledgeUses === 0
    ? "empty"
    : remainingKnowledgeUses <= 3 ? "low" : "enough";
  const areaShortages = EXPERTISE_AREAS
    .filter((area) => area.value !== "general")
    .map((area) => {
      const areaItems = approvedKnowledge.filter((item) => (item.expertise_area || "general") === area.value);
      const remaining = areaItems.reduce((total, item) => total + Math.max(0, 3 - Number(item.use_count || 0)), 0);
      return { ...area, count: areaItems.length, remaining };
    })
    .filter((area) => area.remaining <= 3);

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h1 className="text-3xl font-bold">울림 칼럼 관리</h1>
          <p className="prose-muted mt-1">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/columns/knowledge" className="inline-flex items-center gap-2 rounded-sm border border-[var(--line)] bg-white px-5 py-3 font-bold">
            <BookOpen size={18} /> 노하우 자료실
          </Link>
          <Link href="/admin/columns/ai-new" className="btn-gradient inline-flex items-center gap-2 rounded-sm px-5 py-3 font-bold text-white">
            <Bot size={18} /> AI 초안
          </Link>
          <button onClick={() => void signOut()} className="inline-flex items-center gap-2 px-3 py-2 text-sm">
            <LogOut size={17} /> 로그아웃
          </button>
        </div>
      </div>

      {areaShortages.length > 0 && (
        <div className="mt-4 flex flex-col gap-4 rounded-sm border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <p className="font-bold">특정 전문 분야의 원천자료가 부족합니다</p>
              <p className="mt-1 text-sm text-[#5f5750]">
                {areaShortages.map((area) => `${area.label} ${area.remaining}회`).join(" · ")}
                {" · "}자료실에서 맞춤 인터뷰 요청서를 확인해 주세요.
              </p>
            </div>
          </div>
          <Link href="/admin/columns/knowledge" className="shrink-0 rounded-sm border border-current bg-white px-4 py-2 text-center text-sm font-bold">
            인터뷰 요청서 보기
          </Link>
        </div>
      )}

      <div className={`mt-8 flex flex-col gap-4 rounded-sm border p-5 sm:flex-row sm:items-center sm:justify-between ${
        knowledgeLevel === "empty"
          ? "border-red-200 bg-red-50"
          : knowledgeLevel === "low" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"
      }`}>
        <div className="flex gap-3">
          {knowledgeLevel === "enough"
            ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" />
            : <AlertTriangle className={`mt-0.5 shrink-0 ${knowledgeLevel === "empty" ? "text-red-700" : "text-amber-700"}`} />}
          <div>
            <p className="font-bold">
              {knowledgeLevel === "empty" ? "노하우 원천자료가 부족합니다"
                : knowledgeLevel === "low" ? "노하우 원천자료가 곧 부족해집니다"
                  : "노하우 원천자료가 충분합니다"}
            </p>
            <p className="mt-1 text-sm text-[#5f5750]">
              승인 자료 {approvedKnowledge.length}개 · 예상 활용 여유 {remainingKnowledgeUses}회
              {knowledgeLevel !== "enough" && " · 새 인터뷰나 사례를 추가해 주세요."}
            </p>
          </div>
        </div>
        <Link href="/admin/columns/knowledge" className="shrink-0 rounded-sm border border-current bg-white px-4 py-2 text-center text-sm font-bold">
          원천자료 추가하기
        </Link>
      </div>

      <EditorialSchedule hasKnowledge={remainingKnowledgeUses > 0} />

      <div className="mt-10 overflow-x-auto rounded-sm border border-[var(--line)] bg-white">
        {loadingPosts ? <p className="p-8">칼럼을 불러오는 중입니다.</p> : posts.length === 0 ? (
          <p className="p-8 text-[var(--muted)]">아직 저장된 칼럼이 없습니다.</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[var(--surface-strong)]">
              <tr><th className="p-4">제목</th><th className="p-4">유형</th><th className="p-4">상태</th><th className="p-4">작성일</th><th className="p-4">관리</th></tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-t border-[var(--line)]">
                  <td className="p-4"><p className="font-bold">{post.title}</p><p className="text-xs text-[var(--muted)]">/columns/{post.slug}</p></td>
                  <td className="p-4">{post.content_kind}</td>
                  <td className="p-4">
                    <span className="inline-flex items-center gap-1">{post.published ? <Eye size={15} /> : <EyeOff size={15} />}{post.published ? "공개" : "비공개"}</span>
                  </td>
                  <td className="p-4">{new Date(post.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="p-4">
                    <div className="flex gap-3">
                      <Link href={`/admin/columns/edit/${post.id}`} aria-label="수정"><Edit size={18} /></Link>
                      <button onClick={() => void remove(post)} aria-label="삭제"><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="min-h-[70vh] bg-[#fffaf7]">
      <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
        <Link
          href="/admin"
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold"
        >
          ← 통합 관리로 돌아가기
        </Link>
        {children}
      </div>
    </section>
  );
}
