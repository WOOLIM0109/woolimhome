import sharp from "sharp";
import type { ApprovedMockupTitleBox } from "./approved-16x9-templates.ts";
import { approvedMockupAssetPath } from "./approved-mockup-runtime.ts";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function wrapTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  if (characters.length <= 20) return normalized;
  const midpoint = Math.floor(characters.length / 2);
  const spaces = characters.map((character, index) => character === " " ? index : -1)
    .filter((index) => index > 0);
  const splitAt = spaces.reduce((best, current) => (
    Math.abs(current - midpoint) < Math.abs(best - midpoint) ? current : best
  ), spaces[0] ?? midpoint);
  return `${characters.slice(0, splitAt).join("").trim()}\n${characters.slice(splitAt).join("").trim()}`;
}

/** Fixed maximum font size: long titles shrink, short titles never grow. */
export async function renderApprovedMockupTitle(
  title: string | null | undefined,
  box: ApprovedMockupTitleBox,
  runtimeRoot?: string,
) {
  const wrapped = wrapTitle(title || "");
  if (!wrapped) return null;
  const rendered = await sharp({
    text: {
      text: `<span foreground="${box.color || "#27313a"}">${escapeXml(wrapped)}</span>`,
      font: `Paperlogy 7Bold ${box.fontSize}`,
      fontfile: approvedMockupAssetPath("/fonts/Paperlogy-7Bold.ttf", runtimeRoot),
      dpi: 72,
      align: box.align || "right",
      rgba: true,
      spacing: 0,
      wrap: "none",
    },
  }).png().toBuffer();
  const { data, info } = await sharp(rendered)
    .resize({ width: box.width, height: box.height, fit: "inside", withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  const align = box.align || "right";
  const offset = align === "left" ? 0 : align === "center"
    ? Math.round((box.width - info.width) / 2) : box.width - info.width;
  return { input: data, left: box.left + offset, top: box.top };
}
