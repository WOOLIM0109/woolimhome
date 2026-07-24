"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Bot, Edit, Eye, EyeOff, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { ColumnPost } from "@/lib/columns/types";

const ADMIN_EMAIL = "miseong0928@gmail.com";

export default function AdminColumnsPage() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [posts, setPosts] = useState<ColumnPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;

  const loadPosts = async () => {
    const response = await fetch("/api/admin/columns", { cache: "no-store" });
    if (response.ok) setPosts(await response.json());
    setLoadingPosts(false);
  };

  useEffect(() => {
    if (!loading && user && isAdmin) {
      fetch("/api/admin/columns", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : [])
        .then((data: ColumnPost[]) => setPosts(data))
        .finally(() => setLoadingPosts(false));
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
        <p className="mt-3">{user.email}</p>
        <button onClick={() => void signOut()} className="mt-6 underline">로그아웃</button>
      </AdminShell>
    );
  }

  const remove = async (post: ColumnPost) => {
    if (!window.confirm(`"${post.title}" 초안을 삭제할까요?`)) return;
    await fetch(`/api/admin/columns/${post.id}`, { method: "DELETE" });
    await loadPosts();
  };

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
  return <section className="min-h-[70vh] bg-[#fffaf7]"><div className="mx-auto max-w-6xl px-5 py-16 lg:px-8">{children}</div></section>;
}
