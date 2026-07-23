"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { portfolioProjects, projectDocCategories } from "@/data/content";

type PortfolioProject = (typeof portfolioProjects)[number];

export default function ProjectGallery() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedProject, setSelectedProject] = useState<PortfolioProject | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  const visibleProjects = useMemo(
    () =>
      activeCategory === "all"
        ? portfolioProjects
        : portfolioProjects.filter((project) => project.category === activeCategory),
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
      if (event.key === "ArrowLeft") {
        setActiveImage((current) => (current - 1 + imageCount) % imageCount);
      }
      if (event.key === "ArrowRight") {
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
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={`rounded-full px-5 py-2.5 text-sm font-bold transition ${
            activeCategory === "all"
              ? "bg-[var(--primary)] text-white shadow-[var(--shadow-button)]"
              : "border border-[var(--line)] bg-white text-[#3a2e25] hover:border-[#ecceba]"
          }`}
        >
          전체
        </button>
        {projectDocCategories.map((category) => (
          <button
            key={category.key}
            type="button"
            onClick={() => setActiveCategory(category.key)}
            className={`rounded-full px-5 py-2.5 text-sm font-bold transition ${
              activeCategory === category.key
                ? "bg-[var(--primary)] text-white shadow-[var(--shadow-button)]"
                : "border border-[var(--line)] bg-white text-[#3a2e25] hover:border-[#ecceba]"
            }`}
          >
            {category.label}
          </button>
        ))}
      </div>

      <p className="prose-muted mt-5 text-sm">
        프로젝트를 선택하면 울림컴퍼니가 기획·디자인한 주요 페이지를 크게 확인할 수 있습니다.
      </p>

      {visibleProjects.length > 0 ? (
        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => openProject(project)}
              className="card card-hover group overflow-hidden p-0 text-left"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-[var(--surface-strong)]">
                <Image
                  src={project.cover}
                  alt={`${project.company} ${project.type} 표지`}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover transition duration-300 group-hover:scale-[1.025]"
                />
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">
                  <Images size={14} />
                  4장 보기
                </span>
              </div>
              <div className="px-5 py-5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--primary)]">
                  <span>{project.type}</span>
                  <span className="text-[var(--line)]">|</span>
                  <span className="text-[var(--muted)]">{project.industry}</span>
                </div>
                <h2 className="mt-2 text-xl font-black tracking-tight text-[#241b15]">{project.company}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{project.title}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-7 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-14 text-center">
          <p className="font-bold text-[#3a2e25]">해당 분야의 프로젝트를 정리하고 있습니다.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">준비되는 순서대로 업데이트하겠습니다.</p>
        </div>
      )}

      {selectedProject && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-3 sm:p-6"
          onClick={closeProject}
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedProject.company} 프로젝트 상세`}
        >
          <div
            className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-[#17120f] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 text-white sm:px-6">
              <div>
                <p className="text-xs font-bold text-[#ff9a63]">
                  {selectedProject.type} · {selectedProject.industry}
                </p>
                <h2 className="mt-1 text-lg font-black sm:text-2xl">{selectedProject.company}</h2>
                <p className="mt-1 text-xs text-white/60 sm:text-sm">{selectedProject.title}</p>
              </div>
              <button
                type="button"
                onClick={closeProject}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="프로젝트 상세 닫기"
              >
                <X size={21} />
              </button>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
              <Image
                src={selectedProject.images[activeImage]}
                alt={`${selectedProject.company} ${selectedProject.type} 이미지 ${activeImage + 1}`}
                width={1600}
                height={900}
                className="max-h-[70vh] w-full object-contain"
                priority
              />
              <button
                type="button"
                onClick={showPreviousImage}
                className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/80 sm:left-4"
                aria-label="이전 이미지"
              >
                <ChevronLeft size={26} />
              </button>
              <button
                type="button"
                onClick={showNextImage}
                className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/80 sm:right-4"
                aria-label="다음 이미지"
              >
                <ChevronRight size={26} />
              </button>
            </div>

            <div className="flex items-center justify-center gap-2 border-t border-white/10 px-4 py-4">
              {selectedProject.images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  className={`h-2.5 rounded-full transition ${
                    activeImage === index ? "w-8 bg-[#ff7a3d]" : "w-2.5 bg-white/35 hover:bg-white/60"
                  }`}
                  aria-label={`${index + 1}번 이미지 보기`}
                  aria-current={activeImage === index ? "true" : undefined}
                />
              ))}
              <span className="ml-2 text-xs font-semibold text-white/60">
                {activeImage + 1} / {selectedProject.images.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
