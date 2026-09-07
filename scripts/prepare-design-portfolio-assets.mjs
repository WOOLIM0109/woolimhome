import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const sourceDirectory = process.argv[2];

if (!sourceDirectory) {
  throw new Error("Usage: node scripts/prepare-design-portfolio-assets.mjs <source-directory>");
}

const outputRoot = path.join(process.cwd(), "public", "images", "design-portfolio");

const jobs = [
  ["krotary-02.jpg", "k-rotary/01.webp"],
  ["ieoon-lockup.png", "yearon-dayhug/01.webp"],
  ["ieoon-symbol.png", "yearon-dayhug/02.webp"],
  ["dayhug-lockup.png", "yearon-dayhug/03.webp"],
  ["sinacell-01.png", "sinacell/01.webp"],
  ["sinacell-02.png", "sinacell/02.webp"],
  ["sinacell-03.png", "sinacell/03.webp"],
  ["awesome-card-01.png", "awesome-card/01.webp"],
  ["awesome-card-02.png", "awesome-card/02.webp"],
  ["awesome-card-03.png", "awesome-card/03.webp"],
  ["awesome-card-04.png", "awesome-card/04.webp"],
  ["pamity-invite.jpg", "pamity-invite/01.webp"],
  ["hpc-poster.jpg", "hpc-poster/01.webp"],
  ["dong-eui-poster.png", "startup-poster/01.webp"],
  ["future-science-banner.jpg", "future-science/01.webp"],
  ["battery-aa.jpg", "battery-label/01.webp"],
  ["battery-aaa.jpg", "battery-label/02.webp"],
];

for (const [sourceName, outputName] of jobs) {
  const sourcePath = path.join(sourceDirectory, sourceName);
  const outputPath = path.join(outputRoot, outputName);

  await fs.access(sourcePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await sharp(sourcePath)
    .rotate()
    .resize({ width: 1800, height: 2200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 5 })
    .toFile(outputPath);

  const { size } = await fs.stat(outputPath);
  console.log(`${outputName}\t${Math.round(size / 1024)} KB`);
}
