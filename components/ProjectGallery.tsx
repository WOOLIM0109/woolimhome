"use client";

import Image from "next/image";
import { useState } from "react";
import { X } from "lucide-react";
import { projectDocCategories } from "@/data/content";

export default function ProjectGallery() {
  const [active, setActive] = useState(projectDocCategories[0].key);
  const [zoom, setZoom] = useState<string | null>(null);
  const current = projectDocCategories.find((c) => c.key === active)!;

  return (
    <div>
      {/* 탭 */}
      <div className="flex flex-wrap gap-2">
        {projectDocCategories.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setActive(cat.key)}
            className={`rounded-full px-5 py-2.5 text-sm font-bold transition ${
              active === cat.key
                ? "bg-[var(--primary)] text-white shadow-[var(--shadow-button)]"
                : "border border-[var(--line)] bg-white text-[#3a2e25] hover:border-[#ecceba]"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <p className="prose-muted mt-6 max-w-3xl text-sm">{current.description}</p>

      {/* 이미지 그리드 */}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {current.images.map((src, index) => (
          <button
            key={`${current.key}-${index}`}
            type="button"
            onClick={() => setZoom(src)}
            className="card card-hover group overflow-hidden p-0 text-left"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--surface-strong)]">
              <Image
                src={src}
                alt={`${current.label} 포트폴리오 ${index + 1}`}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover transition duration-300 group-hover:scale-[1.04]"
              />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-[#2d241d]">{current.label}</span>
              <span className="text-xs font-semibold text-[var(--primary)]">크게 보기</span>
            </div>
          </button>
        ))}
      </div>

      {/* 확대 모달 */}
      {zoom && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
            aria-label="닫기"
          >
            <X size={22} />
          </button>
          <div className="relative max-h-[88vh] w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <Image
              src={zoom}
              alt="포트폴리오 확대 이미지"
              width={1280}
              height={960}
              className="h-auto max-h-[88vh] w-full rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
