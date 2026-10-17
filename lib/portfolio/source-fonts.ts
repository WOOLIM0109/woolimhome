import type JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

/** Conservative source preflight: includes unused master/theme declarations. */
export async function readPptxSourceFonts(zip: JSZip): Promise<string[]> {
  const entries = Object.values(zip.files).filter(entry => /^ppt\/.*\.xml$/i.test(entry.name) && !entry.dir);
  if (!entries.length || entries.length > 5000) throw new Error("SOURCE_FONT_INSPECTION_REQUIRED");
  const names = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size !== "number" || size > 4 * 1024 * 1024 || (totalBytes += size) > 64 * 1024 * 1024) {
      throw new Error("SOURCE_FONT_INSPECTION_REQUIRED");
    }
    const xml = await entry.async("string");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("SOURCE_FONT_INSPECTION_REQUIRED");
    let invalid = false;
    const rejectXml = () => { invalid = true; };
    const doc = new DOMParser({ errorHandler: { warning: rejectXml, error: rejectXml, fatalError: rejectXml } }).parseFromString(xml, "application/xml");
    if (invalid || !doc?.documentElement) throw new Error("SOURCE_FONT_INSPECTION_REQUIRED");
    const elements = doc.getElementsByTagName("*");
    for (let i = 0; i < elements.length; i++) {
      const name = elements.item(i)?.getAttribute("typeface")?.trim();
      if (name) names.add(name);
    }
  }
  if (!names.size) throw new Error("SOURCE_FONT_INSPECTION_REQUIRED");
  return [...names].sort();
}
