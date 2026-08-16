"use client";

import {
  CalendarDays,
  FileText,
  LogIn,
  LogOut,
  Palette,
  ShieldCheck,
} from "lucide-react";
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

        {/*
          발행 횟수만 적습니다.

          예전에는 '향후 2주 초안 일정'을 그대로 보여 줬습니다.
          그 날짜는 원고를 만드는 날이지 네이버에 올리는 날이 아닙니다.
          포스팅하는 분에게는 날짜가 어긋난 표로만 보여 혼란을 줬습니다.
          실제 올리는 날은 원고가 준비된 뒤에 정해지므로, 주간 횟수만 안내합니다.
        */}
        <section className="mt-10">
          <div className="mb-4 flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[var(--primary)]">
              <CalendarDays size={20} />
            </span>
            <div>
              <h2 className="text-2xl font-bold">블로그 발행 횟수</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                대표님 승인이 끝난 원고만 위 작업 목록에 나타납니다. 목록에 뜨는 대로 올려 주시면 됩니다.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {PUBLISHING_CADENCE.map((blog) => {
              const Icon = blog.icon;
              return (
                <div key={blog.name} className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${blog.tone}`}>
                      <Icon size={19} />
                    </span>
                    <div className="min-w-0">
                      <strong className="block">{blog.name}</strong>
                      <small className="mt-0.5 block text-[var(--muted)]">주 {blog.perWeek}회</small>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm leading-6">
                    {blog.parts.map((part) => (
                      <li key={part.label} className="flex items-baseline justify-between gap-3">
                        <span className="text-[var(--muted)]">{part.label}</span>
                        <span className="font-bold">주 {part.count}회</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

/** 블로그별 주간 발행 횟수. 실제 올리는 날짜는 원고가 준비된 뒤에 정해집니다. */
const PUBLISHING_CADENCE = [
  {
    name: "컨설팅 블로그",
    perWeek: 5,
    icon: FileText,
    tone: "bg-orange-50 text-[var(--primary)]",
    parts: [
      { label: "울림 콘텐츠형", count: 2 },
      { label: "정보성", count: 3 },
    ],
  },
  {
    name: "디자인 블로그",
    perWeek: 2,
    icon: Palette,
    tone: "bg-stone-100 text-stone-600",
    parts: [
      { label: "포트폴리오", count: 1 },
      { label: "정보형 또는 인사이트형", count: 1 },
    ],
  },
];
