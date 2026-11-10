export function resolveGalleryProject<
  Project extends { id: string; category: string },
  Category extends string,
>(search: string, projects: readonly Project[], activeCategory: Category) {
  const projectId = new URLSearchParams(search).get("project");
  if (!projectId) return null;

  const project = projects.find((item) => item.id === projectId);
  if (!project) return null;

  return {
    project,
    activeCategory: activeCategory === "all" || activeCategory === project.category
      ? activeCategory
      : "all" as const,
  };
}

export function galleryProjectUrl(href: string, projectId: string | null) {
  const url = new URL(href);
  if (projectId === null) url.searchParams.delete("project");
  else url.searchParams.set("project", projectId);

  return `${url.pathname}${url.search}${url.hash}`;
}
