"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Images, Star, X } from "lucide-react";
import {
  designPortfolioCategories,
  designPortfolioProjects,
  getDesignCategoryLabel,
} from "@/data/design-portfolio";

type PortfolioProject = (typeof designPortfolioProjects)[number];
type CategoryKey = (typeof designPortfolioCategories)[number]["key"];

const stageTone: Record<PortfolioProject["preview"], string> = {
  spread: "bg-[#edf3ea]",
  identity: "bg-[#f1edf5]",
  mockup: "bg-[#edf2f6]",
  square: "bg-[#fff0d9]",
  poster: "bg-[#e9f2f0]",
  banner: "bg-[#e6f2ed]",
};

function ProjectPreview({ project }: { project: PortfolioProject }) {
  const cover = project.images[0];
  const secondary = project.images[1] ?? cover;

  return (
    <div className={`relative aspect-[4/3] overflow-hidden ${stageTone[project.preview]}`}>
      {project.preview === "spread" && (
        <div className="absolute inset-0 flex items-center justify-center p-5 sm:p-7">
          <div className="relative aspect-[2.09/1] w-full overflow-hidden bg-white shadow-[0_18px_38px_rgba(42,56,36,0.2)]">
            <Image
              src={cover.src}
              alt={cover.alt}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-contain"
            />
          </div>
        </div>
      )}

      {project.preview === "identity" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="relative h-[48%] w-[86%] bg-white shadow-[0_18px_38px_rgba(71,45,84,0.16)]">
            <Image
              src={cover.src}
              alt={cover.alt}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-contain p-7"
            />
          </div>
          <div className="absolute bottom-[12%] right-[9%] h-[24%] w-[24%] bg-white shadow-[0_12px_28px_rgba(71,45,84,0.18)]">
            <Image src={secondary.src} alt={secondary.alt} fill sizes="120px" className="object-contain p-3" />
          </div>
        </div>
      )}

      {project.preview === "mockup" && (
        <div className="absolute inset-0 flex items-center justify-center p-5 sm:p-7">
          <div className="relative h-full w-full overflow-hidden bg-white shadow-[0_18px_38px_rgba(42,56,36,0.18)]">
            <Image
              src={cover.src}
              alt={cover.alt}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </div>
        </div>
      )}

      {project.preview === "square" && (
        <div className="absolute inset-0 flex items-center justify-center p-5">
          {project.images.length > 1 && (
            <div className="absolute left-[12%] top-[15%] aspect-square w-[53%] rotate-[-4deg] overflow-hidden bg-white shadow-[0_14px_28px_rgba(72,48,21,0.18)]">
              <Image src={secondary.src} alt={secondary.alt} fill sizes="260px" className="object-contain p-1" />
            </div>
          )}
          <div className="relative ml-[16%] aspect-square w-[62%] rotate-[2deg] overflow-hidden bg-white shadow-[0_18px_38px_rgba(72,48,21,0.22)]">
            <Image
              src={cover.src}
              alt={cover.alt}
              fill
              sizes="(max-width: 768px) 65vw, 22vw"
              className="object-contain p-1"
            />
          </div>
        </div>
      )}

      {project.preview === "poster" && (
        <div className="absolute inset-0 flex items-center justify-center p-5">
          <div className="relative h-[88%] w-[50%] overflow-hidden bg-white shadow-[0_18px_38px_rgba(32,62,58,0.22)]">
            <Image
              src={cover.src}
              alt={cover.alt}
              fill
              sizes="(max-width: 768px) 55vw, 18vw"
              className="object-contain"
            />
          </div>
        </div>
      )}

      {project.preview === "banner" && (
        <div className="absolute inset-0 flex items-center justify-center p-5">
          <div className="relative aspect-[3.17/1] w-[92%] overflow-hidden bg-white shadow-[0_18px_36px_rgba(27,72,60,0.2)]">
            <Image
              src={cover.src}
              alt={cover.alt}
              fill
              sizes="(max-width: 768px) 90vw, 31vw"
              className="object-contain"
            />
          </div>
        </div>
      )}

      {project.featured && (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-white/92 px-2.5 py-1.5 text-xs font-black text-[#b94c18] shadow-sm backdrop-blur-sm">
          <Star size={14} aria-hidden="true" fill="currentColor" />
          대표작
        </span>
      )}

      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md bg-[#17120f]/78 px-2.5 py-1.5 text-xs font-bold text-white backdrop-blur-sm">
        <Images size={14} aria-hidden="true" />
        {project.images.length}
      </span>
    </div>
  );
}

export default function DesignPortfolioGallery() {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("all");
  const [selectedProject, setSelectedProject] = useState<PortfolioProject | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  const visibleProjects = useMemo(
    () =>
      activeCategory === "all"
        ? designPortfolioProjects
        : designPortfolioProjects.filter((project) => project.category === activeCategory),
    [activeCategory],
  );

  function openProject(project: PortfolioProject) {
    setSelectedProject(project);
    setActiveImage(0);
  }

  function closeProject() {
    setSelectedProject(null);
    setActiveImage(0);
  }

  function showPreviousImage() {
    if (!selectedProject) return;
    setActiveImage((current) => (current - 1 + selectedProject.images.length) % selectedProject.images.length);
  }

  function showNextImage() {
    if (!selectedProject) return;
    setActiveImage((current) => (current + 1) % selectedProject.images.length);
  }

  useEffect(() => {
    if (!selectedProject) return;

    const imageCount = selectedProject.images.length;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeProject();
      if (event.key === "ArrowLeft" && imageCount > 1) {
        setActiveImage((current) => (current - 1 + imageCount) % imageCount);
      }
      if (event.key === "ArrowRight" && imageCount > 1) {
        setActiveImage((current) => (current + 1) % imageCount);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedProject]);

  return (
    <div>
      <div className="overflow-x-auto pb-2" role="group" aria-label="디자인 포트폴리오 종류">
        <div className="flex w-max min-w-full gap-1 rounded-lg border border-[var(--line)] bg-[#f6f2ee] p-1">
          {designPortfolioCategories.map((category) => (
            <button
              key={category.key}
              type="button"
              onClick={() => setActiveCategory(category.key)}
              className={`whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-bold transition ${
                activeCategory === category.key
                  ? "bg-white text-[#241b15] shadow-[0_5px_16px_rgba(48,36,29,0.12)]"
                  : "text-[var(--muted)] hover:bg-white/70 hover:text-[#241b15]"
              }`}
              aria-pressed={activeCategory === category.key}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-b border-[var(--line)] pb-4 text-sm">
        <p className="font-bold text-[#34281f]">
          {activeCategory === "all"
            ? "전체 작업"
            : designPortfolioCategories.find((category) => category.key === activeCategory)?.label}
        </p>
        <p className="text-[var(--muted)]">{visibleProjects.length}개 프로젝트</p>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visibleProjects.map((project) => (
          <button
            id={project.id}
            key={project.id}
            type="button"
            onClick={() => openProject(project)}
            className="group scroll-mt-28 overflow-hidden rounded-lg border border-[var(--line)] bg-white text-left shadow-[var(--shadow-card)] transition duration-200 hover:-translate-y-1 hover:border-[#dec1ac] hover:shadow-[var(--shadow-float)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--primary)]"
            aria-label={`${project.client} ${project.title} 상세 보기`}
          >
            <ProjectPreview project={project} />
            <span className="block p-5">
              <span className="text-xs font-bold text-[var(--primary)]">
                {getDesignCategoryLabel(project.category)}
              </span>
              <strong className="mt-2 block text-xl font-black text-[#241b15]">{project.client}</strong>
              <span className="mt-1 block text-sm font-semibold text-[#50443b]">{project.title}</span>
              <span className="mt-3 block text-sm leading-6 text-[var(--muted)]">{project.deliverables}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="mt-8 border-t border-[var(--line)] pt-5 text-sm leading-7 text-[var(--muted)]">
        공개 가능한 범위의 실제 제작물을 사용했으며, 고객 정보와 일부 세부 내용은 공개 범위에 맞춰 정리했습니다.
      </p>

      {selectedProject && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/82 p-3 sm:p-6"
          onClick={closeProject}
          role="dialog"
          aria-modal="true"
          aria-labelledby="design-project-title"
        >
          <div
            className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-[#17120f] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 text-white sm:px-6">
              <div>
                <p className="text-xs font-bold text-[#ff9a63]">
                  {getDesignCategoryLabel(selectedProject.category)} · {selectedProject.deliverables}
                </p>
                <h2 id="design-project-title" className="mt-1 text-lg font-black sm:text-2xl">
                  {selectedProject.client}
                </h2>
                <p className="mt-1 text-xs text-white/65 sm:text-sm">{selectedProject.title}</p>
              </div>
              <button
                type="button"
                onClick={closeProject}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="프로젝트 상세 닫기"
                title="닫기"
                autoFocus
              >
                <X size={21} aria-hidden="true" />
              </button>
            </div>

            <div className="relative min-h-[54vh] flex-1 bg-[#e9e6e1] sm:min-h-[64vh]">
              <Image
                src={selectedProject.images[activeImage].src}
                alt={selectedProject.images[activeImage].alt}
                fill
                sizes="100vw"
                className="object-contain p-3 sm:p-7"
                priority
              />
              {selectedProject.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={showPreviousImage}
                    className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/58 text-white backdrop-blur-sm transition hover:bg-black/80 sm:left-4"
                    aria-label="이전 이미지"
                    title="이전 이미지"
                  >
                    <ChevronLeft size={26} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={showNextImage}
                    className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/58 text-white backdrop-blur-sm transition hover:bg-black/80 sm:right-4"
                    aria-label="다음 이미지"
                    title="다음 이미지"
                  >
                    <ChevronRight size={26} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>

            <div className="flex min-h-14 items-center justify-center gap-2 overflow-x-auto border-t border-white/10 px-4 py-3">
              {selectedProject.images.length > 1 &&
                selectedProject.images.map((image, index) => (
                  <button
                    key={image.src}
                    type="button"
                    onClick={() => setActiveImage(index)}
                    className={`h-2.5 rounded-full transition ${
                      activeImage === index ? "w-8 bg-[#ff7a3d]" : "w-2.5 bg-white/35 hover:bg-white/60"
                    }`}
                    aria-label={`${index + 1}번 이미지 보기`}
                    aria-current={activeImage === index ? "true" : undefined}
                  />
                ))}
              <span className="ml-2 text-xs font-semibold text-white/65">
                {activeImage + 1} / {selectedProject.images.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
