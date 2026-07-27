"use client";

import { LogIn, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import PartnerQueue from "./PartnerQueue";

export default function PartnerPortal() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();

  if (loading) {
    return (
      <section className="min-h-[70vh] bg-[#fffaf7] px-5 py-24 text-center text-sm text-[var(--muted)]">
        로그인 상태를 확인하고 있습니다.
      </section>
    );
  }

  if (!user) {
    return (
      <section className="min-h-[70vh] bg-[#fffaf7] px-5 py-20">
        <div className="mx-auto max-w-lg rounded-3xl border border-[var(--line)] bg-white p-8 text-center shadow-[var(--shadow-card)] sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-[var(--primary)]">
            <ShieldCheck size={28} />
          </span>
          <p className="mt-6 text-sm font-bold text-[var(--primary)]">외주 담당자 전용</p>
          <h1 className="mt-2 text-3xl font-bold">네이버 블로그 포스팅 작업실</h1>
          <p className="prose-muted mt-4 leading-7">
            전달받은 본인 Google 계정으로 로그인해 주세요.
            승인된 컨설팅·디자인 블로그 작업물만 확인할 수 있습니다.
          </p>
          <button
            onClick={() => void signInWithGoogle("/partner")}
            className="btn-gradient mt-8 inline-flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-white"
          >
            <LogIn size={18} /> Google로 로그인
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#fffaf7] px-4 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-[#241a15] px-6 py-7 text-white shadow-[var(--shadow-card)] sm:px-9 sm:py-9">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold text-[#ff9a5e]">울림컴퍼니 · 외주 담당자 전용</p>
              <h1 className="mt-2 text-3xl font-bold sm:text-4xl">네이버 블로그 포스팅 작업실</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-white/70">
                대표님이 승인한 컨설팅 블로그와 디자인 블로그 원고만 전달됩니다.
                원고와 이미지를 네이버에 옮긴 뒤 발행 주소를 등록해 주세요.
              </p>
            </div>
            <div className="shrink-0 text-left sm:text-right">
              <p className="text-xs text-white/50">로그인 계정</p>
              <p className="mt-1 text-sm font-bold">{user.email}</p>
              <button
                onClick={() => void signOut()}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/60 underline underline-offset-4 hover:text-white"
              >
                <LogOut size={14} /> 로그아웃
              </button>
            </div>
          </div>
        </header>

        <PartnerQueue onUnauthorized={() => void signOut()} />
      </div>
    </section>
  );
}

