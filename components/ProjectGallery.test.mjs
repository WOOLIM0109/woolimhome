import assert from "node:assert/strict";
import test from "node:test";
import { portfolioProjects } from "../data/content.ts";
import { galleryProjectUrl, resolveGalleryProject } from "../lib/portfolio/project-gallery-url.ts";

const pptProjects = portfolioProjects.filter((project) => ["intro", "proposal", "report"].includes(project.category));
const irProjects = portfolioProjects.filter((project) => project.category === "ir");

test("PPT deep link selects mirae-int from the page's projects", () => {
  const selection = resolveGalleryProject("?project=mirae-int", pptProjects, "all");
  assert.equal(selection?.project, pptProjects.find((project) => project.id === "mirae-int"));
  assert.equal(selection?.activeCategory, "all");
});

test("deep link resets a category that would hide the project and keeps a matching category", () => {
  assert.equal(resolveGalleryProject("?project=mirae-int", pptProjects, "intro")?.activeCategory, "all");
  assert.equal(resolveGalleryProject("?project=mirae-int", pptProjects, "proposal")?.activeCategory, "proposal");
});

test("PPT and business/IR deep links stay within their page's project scope", () => {
  assert.equal(resolveGalleryProject("?project=mirae-int", irProjects, "ir"), null);
  const irProject = irProjects[0];
  assert.ok(irProject);
  assert.equal(resolveGalleryProject(`?project=${irProject.id}`, pptProjects, "all"), null);
  const selection = resolveGalleryProject(`?project=${irProject.id}`, irProjects, "ir");
  assert.equal(selection?.project, irProject);
  assert.equal(selection?.activeCategory, "ir");
});

test("unknown, missing, empty and malformed project values do not select a project", () => {
  for (const search of ["", "?utm_source=email", "?project", "?project=", "?project=missing", "?project=%", "?project=%00", "?project=../mirae-int"]) {
    assert.equal(resolveGalleryProject(search, pptProjects, "intro"), null, search);
  }
});

test("closing removes only project while preserving the path, other query values and hash", () => {
  const result = galleryProjectUrl("https://www.woolimcompany.kr/portfolio/ppt?project=mirae-int&utm_source=email&tag=a&tag=b#works", null);
  assert.equal(result, "/portfolio/ppt?utm_source=email&tag=a&tag=b#works");
  assert.equal(galleryProjectUrl("https://www.woolimcompany.kr/portfolio/ppt?project=mirae-int", null), "/portfolio/ppt");
});

test("opening and changing projects update only the project query value", () => {
  const opened = galleryProjectUrl("https://www.woolimcompany.kr/portfolio/ppt?utm_source=email#works", "mirae-int");
  assert.equal(opened, "/portfolio/ppt?utm_source=email&project=mirae-int#works");
  const changed = galleryProjectUrl(`https://www.woolimcompany.kr${opened}`, pptProjects[0].id);
  assert.equal(changed, `/portfolio/ppt?utm_source=email&project=${pptProjects[0].id}#works`);
});
