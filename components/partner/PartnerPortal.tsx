"use client";

import Image from "next/image";
import {
  CalendarDays,
  FileText,
  LogIn,
  LogOut,
  Palette,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import PartnerQueue from "./PartnerQueue";

export default function PartnerPortal() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();

  if (loading) {
    return (
      <section className="back-office min-h-[70vh] px-5 py-24 text-center text-sm text-[var(--muted)]">
        로그인 상태를 확인하고 있습니다.
      </section>
    );
  }

  if (!user) {
    return (
      <section className="back-office min-h-[70vh] px-5 py-20">
        <div className="mx-auto max-w-lg border border-[var(--line)] bg-white p-10 text-center">
          <p className="eyebrow justify-center text-xs">외주 담당자 전용</p>
          <h1 className="mt-5 text-3xl font-bold">네이버 블로그 포스팅 작업실</h1>
          <p className="prose-muted mt-4">
            전달받은 본인 Google 계정으로 로그인해 주세요.
            승인된 컨설팅·디자인 블로그 작업물만 확인할 수 있습니다.
          </p>
          <button
            onClick={() => void signInWithGoogle("/partner")}
            className="btn-gradient mt-8 inline-flex h-12 items-center gap-2 px-6 font-bold text-white"
          >
            <LogIn size={18} /> Google로 로그인
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="back-office min-h-screen px-5 py-9 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto max-w-[1280px]">
        {/*
          머리글은 짙은 상자로 띄우지 않습니다. 공개 사이트는 제목 아래 선
          한 줄로 구역을 나누므로, 관리자 화면과 같은 모양으로 맞춥니다.
        */}
        <header className="flex flex-col gap-6 border-b border-[#262626] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-4">
            <Image
              src="/images/woolim-logo-cropped.png"
              alt=""
              width={80}
              height={55}
              className="mt-1 h-10 w-[48px] shrink-0 object-contain"
            />
            <div>
              <p className="eyebrow text-[11px]">울림컴퍼니 · 외주 담당자 전용</p>
              <h1 className="mt-3 text-[clamp(28px,2.6vw,38px)] font-bold leading-[1.3]">네이버 블로그 포스팅 작업실</h1>
              <p className="prose-muted mt-3 max-w-3xl text-[17px]">
                대표님이 승인한 컨설팅 블로그와 디자인 블로그 원고만 전달됩니다.
                원고와 이미지를 네이버에 옮긴 뒤 발행 주소를 등록해 주세요.
              </p>
            </div>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-xs text-[var(--muted)]">로그인 계정</p>
            <p className="mt-1 text-sm font-bold">{user.email}</p>
            <button
              onClick={() => void signOut()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] underline underline-offset-4 transition-colors hover:text-[#eb6826]"
            >
              <LogOut size={14} /> 로그아웃
            </button>
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
        <section className="mt-12">
          <div className="flex items-start gap-3">
            <span className="mt-1 shrink-0 text-[#eb6826]">
              <CalendarDays size={20} strokeWidth={1.6} />
            </span>
            <div>
              <h2 className="text-2xl font-bold">블로그 발행 횟수</h2>
              <p className="prose-muted mt-2 text-[15px]">
                대표님 승인이 끝난 원고만 위 작업 목록에 나타납니다. 목록에 뜨는 대로 올려 주시면 됩니다.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {PUBLISHING_CADENCE.map((blog) => {
              const Icon = blog.icon;
              return (
                <div key={blog.name} className="border border-[var(--line)] bg-white p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--line)] text-[#eb6826]">
                      <Icon size={19} strokeWidth={1.6} />
                    </span>
                    <div className="min-w-0">
                      <strong className="block text-[17px]">{blog.name}</strong>
                      <small className="mt-0.5 block text-[var(--muted)]">주 {blog.perWeek}회</small>
                    </div>
                  </div>
                  <dl className="mt-5 border-t border-[var(--line)] text-sm">
                    {blog.parts.map((part) => (
                      <div key={part.label} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-2.5">
                        <dt className="text-[var(--muted)]">{part.label}</dt>
                        <dd className="font-bold">주 {part.count}회</dd>
                      </div>
                    ))}
                  </dl>
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
    parts: [
      { label: "울림 콘텐츠형", count: 2 },
      { label: "정보성", count: 3 },
    ],
  },
  {
    name: "디자인 블로그",
    perWeek: 2,
    icon: Palette,
    parts: [
      { label: "포트폴리오", count: 1 },
      { label: "정보형 또는 인사이트형", count: 1 },
    ],
  },
];
