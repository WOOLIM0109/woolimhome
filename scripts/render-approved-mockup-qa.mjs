/** Offline, synthetic fixtures only. No PPT, environment files, database or AI. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

import { APPROVED_MOCKUP_SUITES } from "../lib/portfolio/approved-mockup-suites.ts";
import { APPROVED_16X9_BACKGROUNDS, resolveApprovedMockupSlots } from "../lib/portfolio/approved-16x9-templates.ts";
import { renderApprovedMockupSuite } from "../lib/portfolio/approved-mockup-suite-renderer.ts";

globalThis.fetch = () => { throw new Error("Offline mockup QA must not perform network requests."); };
sharp.concurrency(2);
const repo = process.cwd();
const output = path.join(repo, ".codex-tmp", "mockup-stage-1");
const fontfile = path.join(repo, "public", "fonts", "Paperlogy-7Bold.ttf");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const labels = { "16:9": "16:9", a4_landscape: "A4 가로", a4_portrait: "A4 세로" };
const colors = ["#23449c", "#06796f", "#ba4834", "#7850a4", "#a87625", "#2478aa", "#365747", "#b64475"];
const subjects = ["프로젝트 방향", "핵심 목표", "정보 구조", "실행 순서", "디자인 원칙", "주요 구성", "기대 효과", "결과 정리"];

async function textLayer(text, left, top, width, size, color = "#172b46", align = "left") {
  return {
    input: await sharp({ text: {
      text: `<span foreground="${color}">${xml(text)}</span>`,
      font: `Paperlogy 7Bold ${size}`, fontfile, width: Math.max(1, Math.round(width)),
      align, rgba: true, wrap: "word-char",
    } }).png().toBuffer(),
    left: Math.round(left), top: Math.round(top),
  };
}

async function fixture(ratio, index, variant) {
  const width = ratio < 1 ? 900 : 1600;
  const height = Math.round(width / ratio);
  const accent = colors[(index + variant * 3) % colors.length];
  const dark = (index + variant) % 4 === 0;
  const bg = dark ? "#122641" : "#fcfcfa";
  const ink = dark ? "#ffffff" : "#172b46";
  const muted = dark ? "#acc0d7" : "#6c7c8b";
  const margin = Math.round(width * 0.065);
  const number = String(index + 1).padStart(2, "0");
  const radius = width * 0.092;
  const centerX = width * 0.77;
  const centerY = height * (ratio < 1 ? 0.51 : 0.6);
  const rows = Array.from({ length: 4 }, (_, row) => {
    const y = height * 0.49 + row * height * 0.072;
    return `<rect x="${margin}" y="${y}" width="${width * (0.38 - row * 0.035)}" height="${height * 0.018}" rx="${height * 0.009}" fill="${muted}" opacity="${0.7 - row * 0.1}"/>`;
  }).join("");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${bg}"/>
    <rect x="9" y="9" width="${width - 18}" height="${height - 18}" fill="none" stroke="${accent}" stroke-width="6"/>
    <rect x="0" y="0" width="${width}" height="${height * 0.018}" fill="${accent}"/>
    <path d="M${margin} ${height * 0.355} H${width - margin}" stroke="${accent}" stroke-width="3"/>
    ${rows}
    <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="${accent}"/>
    <rect x="${width * 0.7}" y="${height * 0.79}" width="${width * 0.095}" height="${width * 0.095}" fill="none" stroke="${accent}" stroke-width="5"/>
    <path d="M${margin} ${height * 0.92} H${width - margin}" stroke="${muted}" opacity="0.3"/>
  </svg>`;
  const layers = await Promise.all([
    textLayer(`WOOLIM / SAMPLE ${variant ? "B" : "A"}`, margin, height * 0.07, width * 0.8, width * 0.019, muted),
    textLayer(subjects[(index + variant * 2) % subjects.length], margin, height * 0.17, width * 0.84, width * 0.039, ink),
    textLayer(`SLIDE ${number}`, margin, height * 0.285, width * 0.55, width * 0.018, accent),
    textLayer(number, centerX - radius * 0.78, centerY - radius * 0.45, radius * 1.56, width * 0.06, "#ffffff", "center"),
    textLayer("배치·비율 확인용 가상 장표", margin, height * 0.948, width * 0.8, width * 0.014, muted),
  ]);
  return { index, buffer: await sharp(Buffer.from(svg)).composite(layers).png().toBuffer() };
}

function guideSvg(template, geometry, assignments) {
  const lookup = new Map(assignments.map((item) => [item.slotId, item]));
  const outlines = geometry.slots.map((slot) => {
    const points = slot.polygon.map((p) => `${p.x},${p.y}`).join(" ");
    const center = slot.polygon.reduce((p, next) => ({ x: p.x + next.x / 4, y: p.y + next.y / 4 }), { x: 0, y: 0 });
    const x = Math.max(55, Math.min(template.canvas.width - 55, center.x));
    const y = Math.max(30, Math.min(template.canvas.height - 30, center.y));
    return `<polygon points="${points}" fill="none" stroke="#ec3f75" stroke-width="2"/>
      <rect x="${x - 48}" y="${y - 16}" width="96" height="32" rx="16" fill="#162337"/>
      <text x="${x}" y="${y + 6}" text-anchor="middle" font-family="sans-serif" font-size="17" fill="white">SLIDE ${lookup.get(slot.slotId).sourceSlideIndex + 1}</text>`;
  }).join("");
  const groups = [
    ...template.rails.map((rail) => ({ ids: resolveApprovedMockupSlots(template).filter((slot) => slot.railId === rail.id).map((slot) => slot.id) })),
    ...(template.edgeAlignments || []).map((group) => ({ ids: group.slotIds })),
  ];
  const lines = groups.flatMap((group) => {
    const card = geometry.slots.find((slot) => slot.slotId === group.ids[0]);
    if (!card) return [];
    return [[0, 1], [3, 2]].map(([a, b]) => {
      const p = card.polygon[a]; const q = card.polygon[b];
      const dx = q.x - p.x; const dy = q.y - p.y;
      return `<line x1="${p.x - dx * 7}" y1="${p.y - dy * 7}" x2="${p.x + dx * 7}" y2="${p.y + dy * 7}" stroke="#00b8e8" stroke-width="2.5" stroke-dasharray="12 6"/>`;
    });
  }).join("");
  return Buffer.from(`<svg width="${template.canvas.width}" height="${template.canvas.height}" xmlns="http://www.w3.org/2000/svg">${lines}${outlines}</svg>`);
}

async function overview(suiteDir, assets, filename) {
  const placements = [
    { left: 40, top: 80, width: 840, height: 840 },
    { left: 940, top: 80, width: 600, height: 338 },
    { left: 1560, top: 80, width: 600, height: 338 },
    { left: 940, top: 540, width: 600, height: 338 },
    { left: 1560, top: 540, width: 600, height: 338 },
  ];
  const layers = [];
  for (const [index, asset] of assets.entries()) {
    const p = placements[index];
    layers.push({ input: await sharp(asset.bytes).resize(p.width, p.height, { fit: "contain" }).png().toBuffer(), left: p.left, top: p.top });
    layers.push(await textLayer(index === 0 ? "THUMBNAIL" : `BODY ${index}`, p.left, p.top - 45, p.width, 24));
  }
  await sharp({ create: { width: 2200, height: 960, channels: 3, background: "#f5f3ef" } })
    .composite(layers).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(path.join(suiteDir, filename));
}

await fs.mkdir(output, { recursive: true });
// A reviewed baseline is never silently regenerated by this command.
const baselinePath = path.join(repo, "docs", "portfolio-mockup-references", "stage-1-lock.json");
const baseline = await fs.readFile(baselinePath, "utf8").then(JSON.parse).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (baseline) {
  const current = APPROVED_MOCKUP_SUITES.flatMap((suite) => [suite.thumbnail, ...suite.bodyTemplates]);
  if (baseline.templates.length !== current.length) throw new Error("검수 기준의 템플릿 개수가 달라졌습니다.");
  for (const template of current) {
    const expected = baseline.templates.find((entry) => entry.templateId === template.id);
    const fingerprint = hash(Buffer.from(JSON.stringify({ template, background: APPROVED_16X9_BACKGROUNDS[template.backgroundId] })));
    if (!expected || expected.geometryHash !== fingerprint) throw new Error(`검수한 틀이 변경됐습니다. 기준파일을 자동 갱신하지 않습니다: ${template.id}`);
  }
  for (const asset of baseline.assetHashes) {
    const assetPath = path.resolve(repo, asset.file);
    if (!assetPath.startsWith(repo + path.sep)) throw new Error("기준 에셋 경로가 저장소 밖입니다.");
    if (hash(await fs.readFile(assetPath)) !== asset.sha256) throw new Error(`검수한 에셋이 변경됐습니다: ${asset.file}`);
  }
  console.log("Reviewed geometry and asset baseline matched");
}
const records = [];
const locks = [];
for (const suite of APPROVED_MOCKUP_SUITES) {
  const slug = suite.aspectClass.replace(":", "x");
  const suiteDir = path.join(output, slug);
  await fs.mkdir(path.join(suiteDir, "swap"), { recursive: true });
  const templates = [suite.thumbnail, ...suite.bodyTemplates];
  const count = Math.max(...templates.map((template) => resolveApprovedMockupSlots(template).length));
  const titles = [
    `${labels[suite.aspectClass]} 목업 템플릿`,
    `${labels[suite.aspectClass]} 생활폐기물 수집·운반·대행용역 입찰제안서 — 운영계획 및 서비스 개선 방향`,
  ];
  const rendered = [];
  for (let variant = 0; variant < 2; variant += 1) {
    const slides = [];
    for (let index = 0; index < count; index += 1) slides.push(await fixture(suite.thumbnail.slideAspectRatio, index, variant));
    const result = await renderApprovedMockupSuite({ aspectClass: suite.aspectClass, slides, title: titles[variant] });
    for (const [index, asset] of result.assets.entries()) {
      const targetDir = variant ? path.join(suiteDir, "swap") : suiteDir;
      await fs.writeFile(path.join(targetDir, asset.outputName), asset.bytes);
      if (!variant) {
        await sharp(asset.bytes).composite([{ input: guideSvg(templates[index], result.geometry[index], asset.slotAssignments), left: 0, top: 0 }])
          .jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toFile(path.join(suiteDir, `guides-${asset.outputName}`));
        locks.push({ suiteId: suite.suiteId, templateId: asset.templateId, version: asset.templateVersion, geometryHash: asset.geometryHash, template: templates[index], background: APPROVED_16X9_BACKGROUNDS[templates[index].backgroundId] });
      }
    }
    await overview(suiteDir, result.assets, variant ? "overview-swap.jpg" : "overview.jpg");
    rendered.push(result);
  }
  const swapChecks = rendered[0].assets.map((before, i) => {
    const after = rendered[1].assets[i];
    const positions = (asset) => asset.slotAssignments.map(({ contentHash: ignored, ...assignment }) => { void ignored; return assignment; });
    const geometryUnchanged = before.geometryHash === after.geometryHash
      && JSON.stringify(positions(before)) === JSON.stringify(positions(after));
    const pixelsChanged = hash(before.bytes) !== hash(after.bytes);
    if (!geometryUnchanged || !pixelsChanged) throw new Error(`Swap proof failed: ${before.templateId}`);
    return { templateId: before.templateId, geometryUnchanged, pixelsChanged };
  });
  records.push({
    label: labels[suite.aspectClass], slug, contract: rendered[0].contract,
    geometry: rendered[0].geometry, swapChecks,
    assets: rendered[0].assets.map(({ bytes, ...asset }) => ({ ...asset, fileHash: hash(bytes) })),
    visualReview: "pending-human-inspection",
  });
  console.log(`${labels[suite.aspectClass]}: 5 templates, geometry + full-slot + swap checks passed`);
}

const dependencies = ["public/images/woolim-logo-cropped.png", "public/fonts/Paperlogy-7Bold.ttf", "public/images/mockup-templates/a4-portrait-dark-wood.png"];
const assetHashes = [];
for (const file of dependencies) assetHashes.push({ file, sha256: hash(await fs.readFile(path.join(repo, file))) });
await fs.writeFile(path.join(output, "geometry-lock-candidate.json"), JSON.stringify({ schemaVersion: 1, assetHashes, templates: locks }, null, 2) + "\n");
await fs.writeFile(path.join(output, "qa-results.json"), JSON.stringify({ offline: true, syntheticSlidesOnly: true, suites: records }, null, 2) + "\n");

const sections = records.map((record) => `<section><h2>${xml(record.label)} <small>썸네일 1 · BODY 4</small></h2>
  <p>필수 장표 최소 ${record.contract.minimumUniqueSlideCount}장 · 배치 검사 통과 · 두 벌 교체 검사 통과</p>
  <img class="overview" src="${record.slug}/overview.jpg" alt="${xml(record.label)} 전체 템플릿"/>
  <div class="cards">${record.assets.map((asset, index) => `<button class="card" data-base="${record.slug}/${asset.outputName}" data-guide="${record.slug}/guides-${asset.outputName}" data-swap="${record.slug}/swap/${asset.outputName}" data-title="${xml(record.label)} / ${index ? `BODY ${index}` : "THUMBNAIL"}"><img src="${record.slug}/${asset.outputName}" alt="${xml(asset.templateId)}"/><strong>${index ? `BODY ${index}` : "THUMBNAIL"}</strong><span>${asset.slotAssignments.length}개 슬롯</span></button>`).join("")}</div></section>`).join("");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>울림 · 목업 1단계 검토</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f3ef;color:#233040;font:16px/1.6 "Malgun Gothic",sans-serif}main{max-width:1400px;margin:auto;padding:44px 28px}h1{margin:0;font-size:34px}header p{max-width:850px;color:#596271}section{margin:50px 0}h2{font-size:26px;margin:0}small{font-size:15px;color:#697282;font-weight:400;margin-left:12px}.overview{width:100%;border-radius:10px}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-top:18px}.card{background:white;border:1px solid #ddd8d0;border-radius:8px;padding:10px;cursor:pointer;text-align:left;color:inherit}.card img{width:100%;height:145px;object-fit:contain}.card strong,.card span{display:block;margin-top:5px}.card span{font-size:13px;color:#6b7280}dialog{border:0;border-radius:12px;width:min(1550px,96vw);max-height:96vh;padding:18px;background:#f5f3ef}dialog::backdrop{background:#111b2ddd}dialog img{display:block;max-width:100%;max-height:78vh;margin:15px auto;object-fit:contain}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.toolbar button{padding:9px 15px;border:1px solid #d8d0c7;border-radius:6px;cursor:pointer;background:white}.toolbar button.active{background:#f16b23;color:white;border-color:#f16b23}#close{margin-left:auto}footer{font-size:14px;color:#687181;border-top:1px solid #ddd;padding-top:20px}@media(max-width:800px){main{padding:24px 12px}.cards{grid-template-columns:repeat(2,1fr)}h1{font-size:26px}.card img{height:130px}}</style>
<main><header><h1>목업 틀 고정 · 1단계 결과</h1><p>같은 틀에 서로 다른 시험 장표 두 벌을 끼웠습니다. 이미지를 누르면 기본 결과, 평행 기준선, 장표 교체본을 비교할 수 있습니다. 모든 장표는 가상 시험 자료이며 실제 고객 원본이나 개인정보를 사용하지 않았습니다.</p></header>${sections}<footer>자동 검사는 좌표·규격·슬롯 채움·교체 전후 배치를 확인합니다. Codex 시각 검수 기록은 별도 검수 보고서에 남깁니다. 이 화면은 로컬 확인용이며 운영 배포 상태를 뜻하지 않습니다.</footer></main>
<dialog><div class="toolbar"><strong id="dialog-title"></strong><button data-mode="base">기본 결과</button><button data-mode="guide">평행 기준선</button><button data-mode="swap">장표 교체본</button><button id="close">닫기</button></div><img id="full-image" alt="확대 결과"></dialog>
<script>const dialog=document.querySelector('dialog');let selected;function show(mode){document.querySelector('#full-image').src=selected.dataset[mode];document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));}document.querySelectorAll('.card').forEach(card=>card.addEventListener('click',()=>{selected=card;document.querySelector('#dialog-title').textContent=card.dataset.title;show('base');dialog.showModal();}));document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.mode)));document.querySelector('#close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});</script></html>`;
await fs.writeFile(path.join(output, "index.html"), html);
console.log(`Review gallery: ${path.join(output, "index.html")}`);
