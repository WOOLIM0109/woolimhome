"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, FileSearch, ShieldCheck, X } from "lucide-react";

type SuccessEvidenceDialogProps = {
  slug: string;
  company: string;
  title: string;
  wins: string[];
  image?: string;
  imageAlt?: string;
  evidenceNotice: string;
  tone?: "light" | "dark";
};

export default function SuccessEvidenceDialog({
  slug,
  company,
  title,
  wins,
  image,
  imageAlt,
  evidenceNotice,
  tone = "light",
}: SuccessEvidenceDialogProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const triggerClass = tone === "dark"
    ? "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/8 px-4 text-sm font-bold text-white transition hover:bg-white/14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    : "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#e5cdbd] bg-[#fff9f4] px-4 text-sm font-bold text-[var(--primary)] transition hover:border-[var(--primary)] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]";

  return (
    <>
      <button ref={triggerRef} type="button" className={triggerClass} onClick={() => setOpen(true)}>
        <FileSearch size={17} aria-hidden="true" />
        {image ? "성과 근거" : "성과 내역"} {wins.length}건 보기
      </button>

      {open && (
        <div
          id={`evidence-${slug}`}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/82 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={closeDialog}
        >
          <div
            className={`flex max-h-[94vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl ${image ? "max-w-5xl" : "max-w-2xl"}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-bold text-[var(--primary)]">성공사례 상세 · {company}</p>
                <h2 id={titleId} className="mt-1 text-lg font-black leading-7 text-[#211811] sm:text-2xl">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f2ede8] text-[#3b2d24] transition hover:bg-[#e8dfd7]"
                aria-label="성과 근거 닫기"
                title="닫기"
                autoFocus
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className={`grid min-h-0 flex-1 overflow-y-auto ${image ? "lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]" : ""}`}>
              {image && (
                <div className="relative min-h-[44vh] border-b border-[var(--line)] bg-[#ece9e5] lg:min-h-[64vh] lg:border-b-0 lg:border-r">
                  <Image
                    src={image}
                    alt={imageAlt || `${company} 성공사례 공개 자료`}
                    fill
                    sizes="(max-width: 1024px) 100vw, 58vw"
                    className="object-contain p-3 sm:p-6"
                    priority
                  />
                </div>
              )}

              <div className="p-5 sm:p-7">
                {!image && (
                  <div className="mb-7 flex gap-4 rounded-lg border border-[#ead8ca] bg-[#fff8f1] p-4 sm:p-5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[var(--primary)] shadow-sm">
                      <ShieldCheck size={22} aria-hidden="true" />
                    </span>
                    <div>
                      <strong className="text-base text-[#211811]">원본 자료는 비공개입니다</strong>
                      <p className="mt-1 text-xs leading-6 text-[var(--muted)]">
                        고객사를 식별할 수 있는 정보가 포함된 문서는 공개 범위가 확인된 사본만 홈페이지에 제공합니다.
                      </p>
                    </div>
                  </div>
                )}
                <p className="text-xs font-bold uppercase text-[var(--primary)]">Verified results</p>
                <h3 className="mt-2 text-2xl font-black text-[#211811]">공개된 선정 내역</h3>
                <ul className="mt-6 space-y-4">
                  {wins.map((win) => (
                    <li key={win} className="flex gap-3 text-sm leading-7 text-[#3d3027]">
                      <CheckCircle2 className="mt-1 shrink-0 text-[var(--primary)]" size={18} aria-hidden="true" />
                      <span>{win}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-7 rounded-lg border border-[#ead8ca] bg-[#fff8f1] p-4">
                  <p className="flex gap-2 text-sm font-bold text-[#4b382d]">
                    <ShieldCheck className="mt-0.5 shrink-0 text-[var(--primary)]" size={17} aria-hidden="true" />
                    공개 범위 안내
                  </p>
                  <p className="mt-2 text-xs leading-6 text-[var(--muted)]">{evidenceNotice}</p>
                </div>
                <p className="mt-5 text-xs leading-6 text-[var(--muted)]">
                  {image
                    ? "원본 전체 문서가 아닌 성과 확인에 필요한 일부 내용만 제공하며, 계약 및 상담 과정에서 추가 확인이 가능합니다."
                    : "성과 수치와 사업명은 기존 공개 내역을 기준으로 정리했으며, 원본 문서는 홈페이지에서 제공하지 않습니다."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
