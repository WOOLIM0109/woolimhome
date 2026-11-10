import assert from "node:assert/strict";
import test from "node:test";
import { designPortfolioProjects } from "../data/design-portfolio.ts";
import { galleryProjectUrl, resolveGalleryProject } from "../lib/portfolio/project-gallery-url.ts";

test("design gallery selects the linked project from its own portfolio", () => {
  const selection = resolveGalleryProject("?project=yuwol-kitchen", designPortfolioProjects, "all");
  assert.equal(selection?.project, designPortfolioProjects.find((project) => project.id === "yuwol-kitchen"));
  assert.equal(selection?.activeCategory, "all");
  assert.equal(resolveGalleryProject("?project=mirae-int", designPortfolioProjects, "all"), null);
});

test("design gallery resets a mismatched category and keeps a matching category", () => {
  const search = "?project=yuwol-kitchen";
  assert.equal(resolveGalleryProject(search, designPortfolioProjects, "editorial")?.activeCategory, "all");
  assert.equal(resolveGalleryProject(search, designPortfolioProjects, "branding")?.activeCategory, "branding");
});

test("design gallery ignores missing, empty, unknown, and malformed project values", () => {
  for (const search of ["", "?source=email", "?project=", "?project=unknown", "?project=%E0%A4%A", "?project=%20", "?project=../yuwol-kitchen"]) {
    assert.equal(resolveGalleryProject(search, designPortfolioProjects, "all"), null, search);
  }
});

test("closing a design project removes only project while retaining other query values and the hash", () => {
  assert.equal(
    galleryProjectUrl("https://www.woolimcompany.kr/portfolio/design?source=email&project=yuwol-kitchen&tag=logo&tag=print#portfolio", null),
    "/portfolio/design?source=email&tag=logo&tag=print#portfolio",
  );
  assert.equal(
    galleryProjectUrl("https://www.woolimcompany.kr/portfolio/design?project=yuwol-kitchen", null),
    "/portfolio/design",
  );
});

test("opening and changing design projects replace the project value without adding image state", () => {
  const opened = galleryProjectUrl("https://www.woolimcompany.kr/portfolio/design?source=email#portfolio", "yuwol-kitchen");
  assert.equal(opened, "/portfolio/design?source=email&project=yuwol-kitchen#portfolio");
  const changed = galleryProjectUrl(`https://www.woolimcompany.kr${opened}`, "yearon-dayhug");
  assert.equal(changed, "/portfolio/design?source=email&project=yearon-dayhug#portfolio");
  assert.equal(new URL(changed, "https://www.woolimcompany.kr").searchParams.has("image"), false);
});
