"use client";

import {
  CalendarDays,
  ChevronDown,
  FileText,
  LogIn,
  LogOut,
  Palette,
  ShieldCheck,
} from "lucide-react";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";
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

        <section className="mt-10">
          <div className="mb-4 flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[var(--primary)]">
              <CalendarDays size={20} />
            </span>
            <div>
              <h2 className="text-2xl font-bold">향후 2주 블로그 초안 일정</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                필요한 블로그 일정만 펼쳐서 확인해 주세요. 대표님 승인이 끝난 원고만 위 작업 목록에 표시됩니다.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <details className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 marker:content-none sm:px-6">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[var(--primary)]">
                    <FileText size={19} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block">컨설팅 블로그 일정</strong>
                    <small className="mt-0.5 block text-[var(--muted)]">정보형·울림 콘텐츠형 초안</small>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm font-bold text-[var(--muted)]">
                  <span className="group-open:hidden">일정 보기</span>
                  <span className="hidden group-open:inline">일정 접기</span>
                  <ChevronDown className="transition-transform group-open:rotate-180" size={18} />
                </span>
              </summary>
              <div className="border-t border-[var(--line)] p-3 sm:p-5">
                <TwoWeekSchedule
                  channel="naver_consulting"
                  statusHeading="작업실 표시"
                  statusText="대표 승인 후 작업 목록에 표시"
                />
              </div>
            </details>

            <details className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 marker:content-none sm:px-6">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600">
                    <Palette size={19} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block">디자인 블로그 일정</strong>
                    <small className="mt-0.5 block text-[var(--muted)]">포트폴리오·기획·디자인 콘텐츠 초안</small>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm font-bold text-[var(--muted)]">
                  <span className="group-open:hidden">일정 보기</span>
                  <span className="hidden group-open:inline">일정 접기</span>
                  <ChevronDown className="transition-transform group-open:rotate-180" size={18} />
                </span>
              </summary>
              <div className="border-t border-[var(--line)] p-3 sm:p-5">
                <TwoWeekSchedule
                  channel="naver_design"
                  statusHeading="작업실 표시"
                  statusText="대표 승인 후 작업 목록에 표시"
                />
              </div>
            </details>
          </div>
        </section>
      </div>
    </section>
  );
}
