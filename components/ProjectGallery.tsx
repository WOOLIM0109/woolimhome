"use client";

import styles from "./PortfolioSuccess.module.css";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { portfolioProjects, projectDocCategories } from "@/data/content";

type PortfolioProject = (typeof portfolioProjects)[number];
type ProjectCategory = (typeof projectDocCategories)[number]["key"];

export default function ProjectGallery({
  allowedCategories,
  defaultCategory = "all",
}: {
  allowedCategories?: ProjectCategory[];
  defaultCategory?: ProjectCategory | "all";
}) {
  const availableCategories = useMemo(
    () => allowedCategories
      ? projectDocCategories.filter((category) => allowedCategories.includes(category.key))
      : projectDocCategories,
    [allowedCategories],
  );
  const [activeCategory, setActiveCategory] = useState<ProjectCategory | "all">(
    defaultCategory === "all" || availableCategories.some((category) => category.key === defaultCategory)
      ? defaultCategory
      : "all",
  );
  const [selectedProject, setSelectedProject] = useState<PortfolioProject | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  const visibleProjects = useMemo(
    () => {
      const scoped = allowedCategories
        ? portfolioProjects.filter((project) => allowedCategories.includes(project.category))
        : portfolioProjects;
      return activeCategory === "all"
        ? scoped
        : scoped.filter((project) => project.category === activeCategory);
    },
    [activeCategory, allowedCategories],
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
    <div className={styles.gallery}>
      <div className={styles.filters} role="group" aria-label="프로젝트 종류">
        <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={styles.filter}
          aria-pressed={activeCategory === "all"}
        >
          전체
        </button>
        {availableCategories.map((category) => (
          <button
            key={category.key}
            type="button"
            onClick={() => setActiveCategory(category.key)}
            className={styles.filter}
            aria-pressed={activeCategory === category.key}
          >
            {category.label}
          </button>
        ))}
      </div>

      <p className="prose-muted mt-5 text-base lg:text-[17px]">
        프로젝트를 선택하면 울림컴퍼니가 기획·디자인한 주요 페이지를 크게 확인할 수 있습니다.
      </p>

      {visibleProjects.length > 0 ? (
        <div className={styles.projectGrid}>
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => openProject(project)}
              className={`${styles.project} group`}
            >
              <div className={styles.projectImage}>
                <Image
                  src={`/images/projects/${project.id}/thumbnail.webp`}
                  alt={`${project.company} ${project.type} 표지`}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-contain transition duration-300 group-hover:scale-[1.025]"
                />
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 bg-black/65 px-3 py-1.5 text-[14px] font-bold text-white backdrop-blur">
                  <Images size={14} />
                  4장 보기
                </span>
              </div>
              <div className={styles.projectCopy}>
                <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#eb6826]">
                  <span>{project.type}</span>
                  <span className="text-[var(--line)]">|</span>
                  <span className="text-[var(--muted)]">{project.industry}</span>
                </div>
                <h2 className="mt-2 text-xl font-bold tracking-tight text-[#171717]">{project.company}</h2>
                <p className="mt-1 text-base lg:text-[17px] text-[var(--muted)]">{project.title}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-7 border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-14 text-center">
          <p className="font-bold text-[#171717]">해당 분야의 프로젝트를 정리하고 있습니다.</p>
          <p className="mt-2 text-base lg:text-[17px] text-[var(--muted)]">준비되는 순서대로 업데이트하겠습니다.</p>
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
            className={styles.dialog}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.dialogHeader}>
              <div>
                <p className="text-[14px] font-bold text-[#eb6826]">
                  {selectedProject.type} · {selectedProject.industry}
                </p>
                <h2 className="mt-1 text-lg font-bold sm:text-2xl">{selectedProject.company}</h2>
                <p className="mt-1 text-[14px] text-[#737373] sm:text-base lg:text-[17px]">{selectedProject.title}</p>
              </div>
              <button
                type="button"
                onClick={closeProject}
                className={styles.dialogClose}
                aria-label="프로젝트 상세 닫기"
              >
                <X size={21} />
              </button>
            </div>

            <div className={styles.slideStage}>
              <Image
                src={selectedProject.images[activeImage]}
                alt={`${selectedProject.company} ${selectedProject.type} 이미지 ${activeImage + 1}`}
                width={1600}
                height={900}
                className="max-h-[70vh] w-full object-contain"
                loading="eager"
              />
              <button
                type="button"
                onClick={showPreviousImage}
                className="absolute left-2 flex h-11 w-11 items-center justify-center bg-black/55 text-white backdrop-blur transition hover:bg-black/80 sm:left-4"
                aria-label="이전 이미지"
              >
                <ChevronLeft size={26} />
              </button>
              <button
                type="button"
                onClick={showNextImage}
                className="absolute right-2 flex h-11 w-11 items-center justify-center bg-black/55 text-white backdrop-blur transition hover:bg-black/80 sm:right-4"
                aria-label="다음 이미지"
              >
                <ChevronRight size={26} />
              </button>
            </div>

            <div className={styles.dialogFooter}>
              {selectedProject.images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  className={`h-2.5  transition ${
                    activeImage === index ? "w-8 bg-[#eb6826]" : "w-2.5 bg-[#d0d0d0] hover:bg-[#aaaaaa]"
                  }`}
                  aria-label={`${index + 1}번 이미지 보기`}
                  aria-current={activeImage === index ? "true" : undefined}
                />
              ))}
              <span className="ml-2 text-[14px] font-semibold text-[#737373]">
                {activeImage + 1} / {selectedProject.images.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}