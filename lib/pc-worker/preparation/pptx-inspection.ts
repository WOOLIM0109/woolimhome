import { createHash } from "node:crypto";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import sharp from "sharp";
import { classifyImageRegion, imageRegionStats } from "../../portfolio/photo-detect.ts";

export const PREPARATION_RULE_VERSION = "local-preparation-2";
export type PreparationAspect = "16:9" | "a4_landscape" | "a4_portrait" | "4:3" | "unknown";
export type PreparationPageSizeVariant =
  | "widescreen_16_9"
  | "iso_a4_landscape"
  | "iso_a4_portrait"
  | "powerpoint_a4_preset_landscape"
  | "standard_4_3"
  | "custom"
  | "unknown";
export type InspectionIssue = { code: string; detail: string };
export type SlideInspection = {
  sourceSlideNumber: number;
  hidden: boolean;
  title: string;
  contentHash: string;
  fonts: string[];
  missingFonts: string[];
  embeddedUnverifiedFonts: string[];
  issues: InspectionIssue[];
  metrics: { textCharacters: number; shapes: number; pictures: number; charts: number;
    tables: number; tableCoverage: number; photoCoverage: number; photoCount: number;
    textCoverage: number; layoutSignature: string };
};
export type PptxInspection = {
  version: string; sourceHash: string; sourceBytes: number; totalSlides: number;
  width: number; height: number; aspect: PreparationAspect;
  pageSizeVariant: PreparationPageSizeVariant; slideSizeType?: string;
  issues: InspectionIssue[]; slides: SlideInspection[];
};
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const issue = (code: string, detail: string): InspectionIssue => ({ code, detail });
type El = Element;
function descendants(node: Document | El, name: string): El[] {
  return Array.from(node.getElementsByTagName("*")).filter((el) => el.localName === name);
}
function children(node: El | undefined, name?: string): El[] {
  if (!node) return [];
  return Array.from(node.childNodes).filter((n): n is El => n.nodeType === 1)
    .filter((n) => !name || n.localName === name);
}
function one(node: Document | El | undefined, name: string) { return node && descendants(node, name)[0]; }
// PowerPoint also stores p14:sldId entries in section/extension lists. They
// refer back to slides, not additional presentation pages. Only the direct
// presentation-namespace list defines the actual order and source numbering.
function presentationChild(document: Document, name: string) {
  const root = document.documentElement;
  const matches = children(root, name).filter(el => el.namespaceURI === root.namespaceURI);
  if (matches.length !== 1) throw new Error(`INVALID_PRESENTATION_${name.toUpperCase()}`);
  return matches[0];
}
function presentationSlideIds(document: Document) {
  const list = presentationChild(document, "sldIdLst");
  return children(list, "sldId").filter(el => el.namespaceURI === document.documentElement.namespaceURI);
}
function xml(text: string, part: string): Document {
  if (text.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`UNSAFE_XML: ${part}`);
  const errors: string[] = [];
  const document = new DOMParser({ errorHandler: { warning: (m) => errors.push(m), error: (m) => errors.push(m), fatalError: (m) => errors.push(m) } }).parseFromString(text, "application/xml");
  if (errors.length || !document.documentElement) throw new Error(`INVALID_XML: ${part}`);
  return document as unknown as Document;
}
type SafeZipEntry = {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
  dataEnd: number;
  recordEnd: number;
  localHeaderOffset: number;
};
type SafeZip = {
  entries: ReadonlyMap<string, SafeZipEntry>;
  read: (name: string, maximumBytes?: number) => Buffer | null;
};

const ZIP_ENTRY_LIMIT = 64 * 1024 * 1024;
const ZIP_TOTAL_LIMIT = 256 * 1024 * 1024;
const XML_PART_LIMIT = 8 * 1024 * 1024;

const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function checkedAdd(left: number, right: number, code: string) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < left || sum < right) throw new Error(code);
  return sum;
}
function safeZipName(buffer: Buffer, start: number, length: number, utf8: boolean) {
  const end = checkedAdd(start, length, "INVALID_PPTX_DIRECTORY");
  if (end > buffer.length) throw new Error("INVALID_PPTX_DIRECTORY");
  const bytes = buffer.subarray(start, end);
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) throw new Error("UNSUPPORTED_PPTX_PART_NAME_ENCODING");
  const name = bytes.toString("utf8");
  if (!name || name.includes("�") || /[\\:\x00]/.test(name) || name.startsWith("/")
    || name.split("/").some((segment, index, parts) => segment === ".." || (!segment && index < parts.length - 1))
    || path.posix.normalize(name) !== name) {
    throw new Error("UNSAFE_PPTX_PART_NAME");
  }
  return { name, bytes };
}

/**
 * Validate the complete central directory and every referenced local header
 * before any deflate stream is opened. JSZip trusts central-directory sizes;
 * a forged small size can otherwise expand far past the declared bound before
 * its eventual length check. This reader applies an output cap while inflating.
 * ZIP64 and multi-disk archives are deliberately not accepted.
 */
function validateZip(buffer: Buffer): SafeZip {
  if (buffer.length > 256 * 1024 * 1024) throw new Error("PPTX_TOO_LARGE: maximum 256 MiB");
  if (buffer.length < 22) throw new Error("INVALID_PPTX_ZIP");
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("INVALID_PPTX_ZIP");
  // A comment can contain a second end-of-directory view and make Office and
  // the inspector disagree about the package. PPTX producers do not need it.
  if (buffer.readUInt16LE(eocd + 20) !== 0 || eocd !== buffer.length - 22) throw new Error("UNSUPPORTED_PPTX_ZIP_COMMENT");
  const disk = buffer.readUInt16LE(eocd + 4);
  const directoryDisk = buffer.readUInt16LE(eocd + 6);
  const diskCount = buffer.readUInt16LE(eocd + 8);
  const count = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (count > 5000 || disk || directoryDisk || diskCount !== count
    || count === 0xffff || directorySize === 0xffffffff || offset === 0xffffffff) {
    throw new Error("UNSUPPORTED_PPTX_ZIP");
  }
  const declaredDirectoryEnd = checkedAdd(offset, directorySize, "INVALID_PPTX_DIRECTORY");
  if (declaredDirectoryEnd !== eocd) throw new Error("INVALID_PPTX_DIRECTORY");
  let cursor = offset, total = 0;
  const names = new Set<string>();
  const localOffsets = new Set<number>();
  const entries = new Map<string, SafeZipEntry>();
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("INVALID_PPTX_DIRECTORY");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const centralCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const entryDisk = buffer.readUInt16LE(cursor + 34);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const end = checkedAdd(
      checkedAdd(checkedAdd(cursor + 46, nameLength, "INVALID_PPTX_DIRECTORY"), extraLength, "INVALID_PPTX_DIRECTORY"),
      commentLength,
      "INVALID_PPTX_DIRECTORY",
    );
    if (end > declaredDirectoryEnd || entryDisk || localHeaderOffset === 0xffffffff
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("UNSUPPORTED_PPTX_ZIP");
    }
    const centralName = safeZipName(buffer, cursor + 46, nameLength, Boolean(flags & 0x0800));
    const foldedName = centralName.name.toLocaleLowerCase("en-US");
    if (names.has(foldedName)) throw new Error("UNSAFE_PPTX_PART_NAME");
    names.add(foldedName);
    total = checkedAdd(total, uncompressedSize, "UNSUPPORTED_PPTX_SIZE_OR_ENCRYPTION");
    if (uncompressedSize > ZIP_ENTRY_LIMIT || total > ZIP_TOTAL_LIMIT || (flags & 1)
      || (flags & ~(0x0006 | 0x0008 | 0x0800))
      || ![0, 8].includes(method) || localHeaderOffset >= offset || localOffsets.has(localHeaderOffset)) {
      throw new Error("UNSUPPORTED_PPTX_SIZE_OR_ENCRYPTION");
    }
    localOffsets.add(localHeaderOffset);
    if (localHeaderOffset + 30 > offset || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error("INVALID_PPTX_LOCAL_HEADER");
    }
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    const localMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const localCrc = buffer.readUInt32LE(localHeaderOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localHeaderOffset + 22);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localName = safeZipName(
      buffer,
      localHeaderOffset + 30,
      localNameLength,
      Boolean(localFlags & 0x0800),
    );
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength
      || !localName.bytes.equals(centralName.bytes)) {
      throw new Error("INVALID_PPTX_LOCAL_HEADER");
    }
    const hasDescriptor = Boolean(flags & 0x0008);
    if ((!hasDescriptor && (localCrc !== centralCrc
      || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize))
      || (hasDescriptor && ((localCrc && localCrc !== centralCrc)
        || (localCompressedSize && localCompressedSize !== compressedSize)
        || (localUncompressedSize && localUncompressedSize !== uncompressedSize)))) {
      throw new Error("INVALID_PPTX_LOCAL_HEADER");
    }
    const dataOffset = checkedAdd(
      checkedAdd(localHeaderOffset + 30, localNameLength, "INVALID_PPTX_LOCAL_HEADER"),
      localExtraLength,
      "INVALID_PPTX_LOCAL_HEADER",
    );
    const dataEnd = checkedAdd(dataOffset, compressedSize, "INVALID_PPTX_LOCAL_HEADER");
    if (dataEnd > offset) throw new Error("INVALID_PPTX_LOCAL_HEADER");
    let recordEnd = dataEnd;
    if (hasDescriptor) {
      let descriptor = dataEnd;
      if (descriptor + 4 <= offset && buffer.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
      if (descriptor + 12 > offset
        || buffer.readUInt32LE(descriptor) !== centralCrc
        || buffer.readUInt32LE(descriptor + 4) !== compressedSize
        || buffer.readUInt32LE(descriptor + 8) !== uncompressedSize) {
        throw new Error("INVALID_PPTX_DATA_DESCRIPTOR");
      }
      recordEnd = descriptor + 12;
    }
    entries.set(centralName.name, {
      name: centralName.name,
      flags,
      method,
      crc32: centralCrc,
      compressedSize,
      uncompressedSize,
      dataOffset,
      dataEnd,
      recordEnd,
      localHeaderOffset,
    });
    cursor = end;
  }
  if (cursor !== declaredDirectoryEnd) throw new Error("INVALID_PPTX_DIRECTORY");
  const ranges = [...entries.values()].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index - 1].recordEnd > ranges[index].localHeaderOffset) throw new Error("OVERLAPPING_PPTX_ENTRIES");
  }

  const readCache = new Map<string, Buffer>();
  return {
    entries,
    read(name: string, maximumBytes = ZIP_ENTRY_LIMIT) {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.uncompressedSize > maximumBytes) throw new Error(`PPTX_PART_TOO_LARGE: ${name}`);
      const cached = readCache.get(name);
      if (cached) return cached;
      const compressed = buffer.subarray(entry.dataOffset, entry.dataEnd);
      let value: Buffer;
      if (entry.method === 0) {
        if (entry.compressedSize !== entry.uncompressedSize) throw new Error(`INVALID_STORED_PPTX_PART: ${name}`);
        value = Buffer.from(compressed);
      } else {
        try {
          value = inflateRawSync(compressed, { maxOutputLength: Math.min(maximumBytes, entry.uncompressedSize) + 1 });
        } catch {
          throw new Error(`UNSAFE_PPTX_EXPANSION: ${name}`);
        }
      }
      if (value.length !== entry.uncompressedSize) throw new Error(`PPTX_PART_SIZE_MISMATCH: ${name}`);
      if (crc32(value) !== entry.crc32) throw new Error(`PPTX_PART_CRC_MISMATCH: ${name}`);
      readCache.set(name, value);
      return value;
    },
  };
}
type Rel = { target: string; type: string; external: boolean };
function resolveRelationshipTarget(sourcePart: string, rawTarget: string) {
  let decoded: string;
  try {
    decoded = decodeURI(rawTarget);
  } catch {
    throw new Error("UNSAFE_PPTX_RELATIONSHIP");
  }
  // OPC relationship targets may be package-root absolute (`/ppt/...`). They
  // are not filesystem paths. Strip exactly that package marker, then apply
  // the same traversal checks as relative package targets. Encoded reserved
  // separators are rejected instead of being interpreted inconsistently.
  if (!decoded || /[\\:\x00?#]/.test(decoded) || /%(?:00|2f|3a|5c)/i.test(decoded)) {
    throw new Error("UNSAFE_PPTX_RELATIONSHIP");
  }
  const packageAbsolute = decoded.startsWith("/");
  const withoutRoot = packageAbsolute ? decoded.slice(1) : decoded;
  if (!withoutRoot || withoutRoot.startsWith("/") || withoutRoot.includes("//")) {
    throw new Error("UNSAFE_PPTX_RELATIONSHIP");
  }
  const stack = packageAbsolute ? [] : path.posix.dirname(sourcePart).split("/").filter((segment) => Boolean(segment) && segment !== ".");
  for (const segment of withoutRoot.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!stack.length) throw new Error("UNSAFE_PPTX_RELATIONSHIP");
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  const normalized = stack.join("/");
  if (!normalized || normalized === ".." || normalized.startsWith("../")
    || normalized.startsWith("/") || /[\\:\x00]/.test(normalized)) {
    throw new Error("UNSAFE_PPTX_RELATIONSHIP");
  }
  return normalized;
}
type PreparationPageSizeClassification = Readonly<{
  aspect: PreparationAspect;
  pageSizeVariant: PreparationPageSizeVariant;
}>;
const POWERPOINT_A4_LANDSCAPE = Object.freeze({ widthEmu: 9_906_000, heightEmu: 6_858_000, type: "A4" });

export function classifyPreparationPageSize(
  width: number,
  height: number,
  slideSizeType?: string,
): PreparationPageSizeClassification {
  if (!(width > 0 && height > 0)) return { aspect: "unknown", pageSizeVariant: "unknown" };
  if (Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width === POWERPOINT_A4_LANDSCAPE.widthEmu
    && height === POWERPOINT_A4_LANDSCAPE.heightEmu
    && slideSizeType === POWERPOINT_A4_LANDSCAPE.type) {
    return { aspect: "a4_landscape", pageSizeVariant: "powerpoint_a4_preset_landscape" };
  }
  const ratio = width / height;
  for (const [aspect, target, pageSizeVariant] of [
    ["16:9", 16 / 9, "widescreen_16_9"],
    ["a4_landscape", 297 / 210, "iso_a4_landscape"],
    ["a4_portrait", 210 / 297, "iso_a4_portrait"],
    ["4:3", 4 / 3, "standard_4_3"],
  ] as const) {
    if (Math.abs(ratio / target - 1) <= .005) return { aspect, pageSizeVariant };
  }
  return { aspect: "unknown", pageSizeVariant: "custom" };
}

export function classifyPreparationAspect(width: number, height: number, slideSizeType?: string): PreparationAspect {
  return classifyPreparationPageSize(width, height, slideSizeType).aspect;
}
const normalizedFont = (s: string) => s.normalize("NFKC").replace(/^@/, "").replace(/\s/g, "").toLowerCase();
type Rect = { x: number; y: number; w: number; h: number };
function unionCoverage(rectangles: Rect[], width: number, height: number) {
  const rects = rectangles.map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y),
    r: Math.min(width, r.x + r.w), b: Math.min(height, r.y + r.h) })).filter((r) => r.r > r.x && r.b > r.y);
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.r]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const spans = rects.filter((r) => r.x < xs[i] && r.r > xs[i - 1]).map((r) => [r.y, r.b]).sort((a,b) => a[0]-b[0]);
    let bottom = 0, covered = 0;
    for (const [top, b] of spans) { covered += Math.max(0, b - Math.max(top, bottom)); bottom = Math.max(bottom, b); }
    area += (xs[i] - xs[i - 1]) * covered;
  }
  return Math.min(1, area / (width * height));
}

/** Read-only OOXML inspection. Body text is used for hashes, not retained in the report. */
export async function inspectPptx(buffer: Buffer, options: { installedFonts: readonly string[] }): Promise<PptxInspection> {
  const archive = validateZip(buffer);
  if ([...archive.entries.keys()].some((p) => /vbaproject\.bin$/i.test(p))) throw new Error("MACROS_NOT_ALLOWED");
  const cache = new Map<string, Document>();
  async function part(name: string) {
    if (!cache.has(name)) {
      const bytes = archive.read(name, XML_PART_LIMIT); if (!bytes) throw new Error(`MISSING_PPTX_PART: ${name}`);
      cache.set(name, xml(bytes.toString("utf8"), name));
    }
    return cache.get(name)!;
  }
  const relationshipCache = new Map<string, Map<string, Rel>>();
  async function relationshipPart(rname: string, sourcePart: string): Promise<Map<string, Rel>> {
    if (relationshipCache.has(rname)) return relationshipCache.get(rname)!;
    if (!archive.entries.has(rname)) return new Map();
    const values = new Map<string, Rel>();
    for (const r of descendants(await part(rname), "Relationship")) {
      const id = r.getAttribute("Id") || "";
      if (!id || values.has(id)) throw new Error("INVALID_PPTX_RELATIONSHIP_ID");
      const raw = r.getAttribute("Target") || "", external = r.getAttribute("TargetMode") === "External";
      const type = r.getAttribute("Type") || "";
      if (/\/vbaProject$/i.test(type)) throw new Error("MACROS_NOT_ALLOWED");
      if (external && !/\/hyperlink$/.test(type)) throw new Error("EXTERNAL_CONTENT_NOT_ALLOWED");
      const target = external ? raw : resolveRelationshipTarget(sourcePart, raw);
      values.set(id, { target, type, external });
    }
    relationshipCache.set(rname, values);
    return values;
  }
  async function rels(name: string): Promise<Map<string, Rel>> {
    const rname = path.posix.join(path.posix.dirname(name), "_rels", path.posix.basename(name) + ".rels");
    return relationshipPart(rname, name);
  }
  // Validate every relationship part, including unused ones, before Office can
  // resolve remote/OLE/media content during export.
  for (const name of [...archive.entries.keys()].filter((n) => n.endsWith(".rels"))) {
    const sourcePart = name === "_rels/.rels"
      ? ""
      : path.posix.join(path.posix.dirname(path.posix.dirname(name)), path.posix.basename(name, ".rels"));
    await relationshipPart(name, sourcePart);
  }
  const contentTypes = await part("[Content_Types].xml");
  const declaredContentTypes = [...descendants(contentTypes,"Default"), ...descendants(contentTypes,"Override")];
  if (declaredContentTypes.some((entry) => /macroEnabled|vbaProject/i.test(entry.getAttribute("ContentType") || ""))) {
    throw new Error("MACROS_NOT_ALLOWED");
  }
  const rootRelationships = await relationshipPart("_rels/.rels", "");
  const officeDocuments = [...rootRelationships.values()].filter((entry) => /\/officeDocument$/.test(entry.type));
  if (officeDocuments.length !== 1 || officeDocuments[0].external || !archive.entries.has(officeDocuments[0].target)) {
    throw new Error("INVALID_OFFICE_DOCUMENT_RELATIONSHIP");
  }
  const presentationName = officeDocuments[0].target;
  const presentationType = descendants(contentTypes,"Override").find((entry) => {
    const partName = entry.getAttribute("PartName") || "";
    return partName === `/${presentationName}`;
  })?.getAttribute("ContentType") || "";
  if (!/presentationml\.presentation\.main\+xml$/.test(presentationType)) throw new Error("INVALID_PRESENTATION_CONTENT_TYPE");
  const presentation = await part(presentationName), relationships = await rels(presentationName);
  const size = presentationChild(presentation, "sldSz");
  const slideIds = presentationSlideIds(presentation);
  const widthEmu = Number(size?.getAttribute("cx")), heightEmu = Number(size?.getAttribute("cy"));
  if (!(widthEmu > 0 && heightEmu > 0)) throw new Error("INVALID_SLIDE_SIZE");
  const slideSizeType = size?.hasAttribute("type") ? size.getAttribute("type") || "" : undefined;
  const pageSize = classifyPreparationPageSize(widthEmu, heightEmu, slideSizeType);
  const report: PptxInspection = { version: PREPARATION_RULE_VERSION, sourceHash: sha256(buffer), sourceBytes: buffer.length,
    totalSlides: slideIds.length, width: widthEmu / 12700, height: heightEmu / 12700,
    aspect: pageSize.aspect, pageSizeVariant: pageSize.pageSizeVariant, slideSizeType, issues: [], slides: [] };
  if (!report.totalSlides || report.totalSlides > 500) throw new Error("UNSUPPORTED_SLIDE_COUNT: expected 1..500");
  if (report.aspect === "unknown" || report.aspect === "4:3") report.issues.push(issue("NO_APPROVED_SUITE", report.aspect));
  const installed = new Set(options.installedFonts.map(normalizedFont));
  const embedded = new Set(descendants(presentation, "embeddedFont")
    .map((e) => normalizedFont(one(e,"font")?.getAttribute("typeface") || "")).filter(Boolean));
  const seenParts = new Set<string>();
  for (const [index, sldId] of slideIds.entries()) {
    const s: SlideInspection = { sourceSlideNumber: index + 1, hidden: false, title: "", contentHash: "", fonts: [], missingFonts: [], embeddedUnverifiedFonts: [], issues: [],
      metrics: { textCharacters: 0, shapes: 0, pictures: 0, charts: 0, tables: 0, tableCoverage: 0, photoCoverage: 0, photoCount: 0, textCoverage: 0, layoutSignature: "" } };
    report.slides.push(s);
    try {
      const relationship = relationships.get(sldId.getAttribute("r:id") || "");
      if (!relationship || relationship.external || !/\/slide$/.test(relationship.type) || seenParts.has(relationship.target)) throw new Error("INVALID_SLIDE_RELATIONSHIP");
      seenParts.add(relationship.target);
      const slide = await part(relationship.target), sr = await rels(relationship.target);
      s.hidden = slide.documentElement.getAttribute("show") === "0";
      if (s.hidden) s.issues.push(issue("HIDDEN", "숨김 장표"));
      // Follow this slide's actual layout -> master -> theme chain. Unrelated
      // package masters must never affect this slide's font result.
      type InheritedPart = { kind: "slideLayout" | "slideMaster" | "theme"; name: string;
        document: Document; relationships: Map<string, Rel> };
      const inherited: InheritedPart[] = []; let rr = sr;
      for (const type of ["slideLayout", "slideMaster", "theme"]) {
        const links = [...rr.values()].filter((r) => r.type.endsWith("/" + type) && !r.external);
        if (links.length > 1) throw new Error(`AMBIGUOUS_${type.toUpperCase()}_RELATIONSHIP`);
        const link = links[0];
        if (!link) break;
        const linkedRelationships = await rels(link.target);
        inherited.push({ kind: type as InheritedPart["kind"], name: link.target,
          document: await part(link.target), relationships: linkedRelationships });
        rr = linkedRelationships;
      }
      const fonts = new Set<string>();
      const textParts: string[] = [], signatures: string[] = [], mediaHashes: string[] = [];
      const tableRects: Rect[] = [], photoRects: Rect[] = [], textRects: Rect[] = [];
      const layout = inherited.find((entry) => entry.kind === "slideLayout")?.document;
      const master = inherited.find((entry) => entry.kind === "slideMaster")?.document;
      const theme = inherited.find((entry) => entry.kind === "theme")?.document;
      const addIssueOnce = (code: string, detail: string) => {
        if (!s.issues.some((entry) => entry.code === code)) s.issues.push(issue(code, detail));
      };
      function resolveFace(face: string, script: "latin" | "ea", text: string, language: string) {
        if (!face.startsWith("+")) return face;
        const font = one(theme, face.startsWith("+mj") ? "majorFont" : "minorFont");
        if (!font) return "";
        if (script === "latin") return one(font, "latin")?.getAttribute("typeface") || "";
        const genericEastAsian = one(font, "ea")?.getAttribute("typeface") || "";
        if (genericEastAsian) return genericEastAsian;
        const normalizedLanguage = language.toLowerCase();
        const scriptName = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(text) || normalizedLanguage.startsWith("ko")
          ? "Hang"
          : /[\u3040-\u30ff]/u.test(text) || normalizedLanguage.startsWith("ja")
            ? "Jpan"
            : /[\u3400-\u9fff]/u.test(text) && /^(zh-cn|zh-sg)/.test(normalizedLanguage)
              ? "Hans"
              : /[\u3400-\u9fff]/u.test(text) && /^(zh-tw|zh-hk|zh-mo)/.test(normalizedLanguage)
                ? "Hant"
              : "";
        if (!scriptName) return "";
        return descendants(font, "font")
          .find((entry) => entry.getAttribute("script") === scriptName)
          ?.getAttribute("typeface") || "";
      }
      function placeholderType(placeholder: El | undefined) {
        if (!placeholder) return "body";
        return placeholder.getAttribute("type") || "obj";
      }
      function matchingPlaceholder(document: Document | undefined, reference: El | undefined) {
        if (!document || !reference) return undefined;
        const placeholders = descendants(document, "sp").filter((candidate) => one(candidate, "ph"));
        const indexValue = reference.getAttribute("idx");
        if (indexValue !== null && indexValue !== "") {
          const indexed = placeholders.filter((candidate) => one(candidate, "ph")?.getAttribute("idx") === indexValue);
          return indexed.length === 1 ? indexed[0] : undefined;
        }
        const typeValue = placeholderType(reference);
        const typed = placeholders.filter((candidate) => placeholderType(one(candidate, "ph")) === typeValue);
        return typed.length === 1 ? typed[0] : undefined;
      }
      function paragraphLevel(paragraph: El) {
        const raw = Number(children(paragraph, "pPr")[0]?.getAttribute("lvl") || 0);
        return Number.isInteger(raw) && raw >= 0 && raw <= 8 ? raw : 0;
      }
      function levelDefault(container: Document | El | undefined, level: number) {
        if (!container) return undefined;
        return one(one(container, `lvl${level + 1}pPr`), "defRPr");
      }
      function shapeListDefault(shape: El | undefined, level: number) {
        return levelDefault(one(one(shape, "txBody"), "lstStyle"), level);
      }
      function masterTextStyle(type: string) {
        if (!master) return undefined;
        if (/title|ctrTitle/.test(type)) return one(master, "titleStyle");
        if (type === "body" || type === "obj" || type === "subTitle") return one(master, "bodyStyle");
        return one(master, "otherStyle");
      }
      function directTypeface(property: El | undefined, script: "latin" | "ea") {
        return children(property as El, script)[0]?.getAttribute("typeface") || "";
      }
      function inspectText(shape: El) {
        for (const run of [...descendants(shape, "r"), ...descendants(shape, "fld")]) {
          const text = one(run, "t")?.textContent || ""; if (!text.trim()) continue;
          textParts.push(text); s.metrics.textCharacters += text.length;
          const paragraph = run.parentNode as El;
          const ph = one(shape, "ph");
          const phType = placeholderType(ph);
          const layoutShape = matchingPlaceholder(layout, ph);
          const masterShape = matchingPlaceholder(master, one(layoutShape, "ph") || ph);
          const level = paragraphLevel(paragraph);
          const paragraphProperties = children(paragraph, "pPr")[0];
          const localCandidates = [
            children(run, "rPr")[0],
            children(paragraphProperties, "defRPr")[0],
            shapeListDefault(shape, level),
          ].filter((value): value is El => Boolean(value));
          const candidates = [
            ...localCandidates,
            shapeListDefault(layoutShape, level),
            shapeListDefault(masterShape, level),
            levelDefault(masterTextStyle(phType), level),
            levelDefault(one(presentation, "defaultTextStyle"), level),
          ].filter((value): value is El => Boolean(value));
          const language = candidates.map((candidate) => candidate.getAttribute("lang") || "").find(Boolean) || "";
          const scripts = [/[\p{Script=Latin}0-9]/u.test(text) ? "latin" : "",
            /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(text) ? "ea" : ""]
            .filter((value): value is "latin" | "ea" => Boolean(value));
          if ([...text].some((character) => /\p{L}/u.test(character)
            && !/[\p{Script=Latin}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character))) {
            addIssueOnce("FONT_UNRESOLVED", "복합 문자권 글꼴 상속은 로컬 렌더 검수 필요");
          }
          for (const script of scripts) {
            const applicableCandidates = one(shape,"tbl") ? localCandidates : candidates;
            let face = applicableCandidates.map((candidate) => directTypeface(candidate, script)).find(Boolean) || "";
            if (!face) {
              if (one(shape,"tbl")) {
                addIssueOnce("FONT_UNRESOLVED", "표 스타일의 간접 글꼴 상속은 로컬 렌더 검수 필요");
                continue;
              }
              const ref = one(shape,"fontRef")?.getAttribute("idx")
                || one(layoutShape,"fontRef")?.getAttribute("idx")
                || one(masterShape,"fontRef")?.getAttribute("idx");
              face = `+${ref === "major" || /title|ctrTitle/.test(phType) ? "mj" : "mn"}-${script === "ea" ? "ea" : "lt"}`;
            }
            face = resolveFace(face, script, text, language);
            if (face) fonts.add(face);
            else addIssueOnce("FONT_UNRESOLVED", "테마/상속 글꼴을 확정할 수 없음");
          }
        }
      }
      type Transform = { sx: number; sy: number; tx: number; ty: number };
      type WalkScope = { relationships: Map<string, Rel>; inherited: boolean; partName: string };
      const uninspectableNames = new Set([
        "AlternateContent", "oleObj", "videoFile", "audioFile", "quickTimeFile",
        "contentPart", "custData", "webVideoPr", "audioCd", "wavAudioFile",
      ]);
      function requiresObjectReview(shape: El) {
        return [shape, ...descendants(shape, "AlternateContent")]
          .some((node) => uninspectableNames.has(node.localName))
          || descendants(shape, "oleObj").length > 0
          || descendants(shape, "videoFile").length > 0
          || descendants(shape, "audioFile").length > 0
          || descendants(shape, "quickTimeFile").length > 0
          || descendants(shape, "contentPart").length > 0
          || descendants(shape, "custData").length > 0
          || descendants(shape, "webVideoPr").length > 0
          || descendants(shape, "audioCd").length > 0
          || descendants(shape, "wavAudioFile").length > 0;
      }
      async function inspectBlip(blip: El, rect: Rect, scope: WalkScope) {
        s.metrics.pictures++;
        const link = scope.relationships.get(blip.getAttribute("r:embed") || "");
        const image = link && !link.external && /\/image$/.test(link.type) ? archive.read(link.target) : null;
        if (!image) {
          addIssueOnce(
            scope.inherited ? "INHERITED_MEDIA_UNRESOLVED" : "MEDIA_UNRESOLVED",
            `${scope.partName}: 이미지 참조를 확인할 수 없음`,
          );
          return;
        }
        mediaHashes.push(sha256(image));
        let illustration = false;
        try {
          const raw = await sharp(image, {limitInputPixels: 40_000_000})
            .flatten({ background: "#ffffff" })
            .resize(64,64,{fit:"fill",kernel:"nearest"})
            .removeAlpha()
            .toColourspace("srgb")
            .raw()
            .toBuffer();
          const areaShare = rect.w * rect.h / (widthEmu * heightEmu);
          illustration = classifyImageRegion(imageRegionStats(raw, 64, areaShare)).kind === "illustration";
        } catch {
          addIssueOnce(
            scope.inherited ? "INHERITED_MEDIA_UNRESOLVED" : "MEDIA_CLASSIFICATION_REVIEW",
            `${scope.partName}: 벡터/이미지 분류는 로컬 육안 검수 필요`,
          );
        }
        if (!illustration && rect.w*rect.h/(widthEmu*heightEmu)>.01) photoRects.push(rect);
      }
      async function walk(container: El, transform: Transform, scope: WalkScope) {
        for (const shape of children(container)) {
          if (shape.localName === "AlternateContent") {
            addIssueOnce(
              scope.inherited ? "INHERITED_OBJECT_REVIEW" : "UNINSPECTABLE_OBJECT",
              `${scope.partName}: 대체/외부 개체는 로컬 미리보기에서 확인 필요`,
            );
            continue;
          }
          if (!["sp", "pic", "graphicFrame", "grpSp", "cxnSp"].includes(shape.localName)) continue;
          if (scope.inherited && shape.localName !== "grpSp" && one(shape, "ph")) continue;
          const xf = one(shape, "xfrm"), off = xf && children(xf,"off")[0], ext = xf && children(xf,"ext")[0];
          const x = Number(off?.getAttribute("x") || 0), y = Number(off?.getAttribute("y") || 0);
          const w = Number(ext?.getAttribute("cx") || 0), h = Number(ext?.getAttribute("cy") || 0);
          const rect = { x: x * transform.sx + transform.tx, y: y * transform.sy + transform.ty, w: w * transform.sx, h: h * transform.sy };
          if (shape.localName === "grpSp") {
            const co = xf && children(xf,"chOff")[0], ce = xf && children(xf,"chExt")[0];
            const sx = rect.w / (Number(ce?.getAttribute("cx")) || w || 1), sy = rect.h / (Number(ce?.getAttribute("cy")) || h || 1);
            await walk(shape,{ sx, sy, tx: rect.x - Number(co?.getAttribute("x") || 0)*sx, ty: rect.y - Number(co?.getAttribute("y") || 0)*sy },scope); continue;
          }
          s.metrics.shapes++;
          const rotation = Number(xf?.getAttribute("rot") || 0);
          const transformFlags = `${rotation}:${xf?.getAttribute("flipH") || "0"}:${xf?.getAttribute("flipV") || "0"}`;
          signatures.push([scope.partName, shape.localName, transformFlags,
            ...[rect.x/widthEmu,rect.y/heightEmu,rect.w/widthEmu,rect.h/heightEmu].map((v) => Math.round(v*1000))].join(":"));
          inspectText(shape);
          if (descendants(shape,"t").length) textRects.push(rect);
          if (!s.title && one(shape,"ph") && /title|ctrTitle/.test(one(shape,"ph")?.getAttribute("type") || "")) s.title = descendants(shape,"t").map((t) => t.textContent).join(" ").slice(0,160);
          if (one(shape,"tbl")) { s.metrics.tables++; tableRects.push(rect); }
          if (one(shape,"chart") || one(shape,"relIds")) s.metrics.charts++;
          if (requiresObjectReview(shape)) {
            addIssueOnce(
              scope.inherited ? "INHERITED_OBJECT_REVIEW" : "UNINSPECTABLE_OBJECT",
              `${scope.partName}: OLE/오디오/비디오/대체 개체는 로컬 미리보기에서 확인 필요`,
            );
          } else if (shape.localName === "graphicFrame"
            && !one(shape,"tbl") && !one(shape,"chart") && !one(shape,"relIds")) {
            addIssueOnce(
              scope.inherited ? "INHERITED_OBJECT_REVIEW" : "UNINSPECTABLE_OBJECT",
              `${scope.partName}: 분류할 수 없는 graphicFrame은 로컬 미리보기에서 확인 필요`,
            );
          }
          const blips = descendants(shape,"blip");
          if (shape.localName === "pic" && !blips.length) {
            addIssueOnce(
              scope.inherited ? "INHERITED_MEDIA_UNRESOLVED" : "MEDIA_UNRESOLVED",
              `${scope.partName}: 그림 참조가 없음`,
            );
          }
          for (const blip of blips) {
            await inspectBlip(blip,rect,scope);
          }
        }
      }
      const tree = one(slide,"spTree"); if (!tree) throw new Error("MISSING_SLIDE_TREE");
      await walk(tree,{sx:1,sy:1,tx:0,ty:0},{relationships:sr,inherited:false,partName:"slide"});
      const slideTreeBlips = new Set(descendants(tree,"blip"));
      for (const blip of descendants(slide,"blip").filter((entry) => !slideTreeBlips.has(entry))) {
        await inspectBlip(blip,{x:0,y:0,w:widthEmu,h:heightEmu},{
          relationships:sr,inherited:false,partName:"slide background",
        });
      }
      // Rendered layout/master objects participate in font, density and media
      // checks. Placeholder definitions are used only for inheritance; their
      // sample text is not visible slide content.
      const layoutPart = inherited.find((entry) => entry.kind === "slideLayout");
      const masterPart = inherited.find((entry) => entry.kind === "slideMaster");
      if (layoutPart) {
        const layoutTree = one(layoutPart.document,"spTree");
        if (layoutTree) await walk(layoutTree,{sx:1,sy:1,tx:0,ty:0},{
          relationships:layoutPart.relationships,inherited:true,partName:"slideLayout",
        });
        const treeBlips = new Set(layoutTree ? descendants(layoutTree,"blip") : []);
        for (const blip of descendants(layoutPart.document,"blip").filter((entry) => !treeBlips.has(entry))) {
          await inspectBlip(blip,{x:0,y:0,w:widthEmu,h:heightEmu},{
            relationships:layoutPart.relationships,inherited:true,partName:"slideLayout background",
          });
        }
      }
      const showMasterShapes = slide.documentElement.getAttribute("showMasterSp") !== "0"
        && layoutPart?.document.documentElement.getAttribute("showMasterSp") !== "0";
      if (masterPart && showMasterShapes) {
        const masterTree = one(masterPart.document,"spTree");
        if (masterTree) await walk(masterTree,{sx:1,sy:1,tx:0,ty:0},{
          relationships:masterPart.relationships,inherited:true,partName:"slideMaster",
        });
        const treeBlips = new Set(masterTree ? descendants(masterTree,"blip") : []);
        for (const blip of descendants(masterPart.document,"blip").filter((entry) => !treeBlips.has(entry))) {
          await inspectBlip(blip,{x:0,y:0,w:widthEmu,h:heightEmu},{
            relationships:masterPart.relationships,inherited:true,partName:"slideMaster background",
          });
        }
      }
      s.fonts=[...fonts].sort(); s.missingFonts=s.fonts.filter((f)=>!installed.has(normalizedFont(f)) && !embedded.has(normalizedFont(f)));
      s.embeddedUnverifiedFonts=s.fonts.filter((f)=>!installed.has(normalizedFont(f)) && embedded.has(normalizedFont(f)));
      s.metrics.tableCoverage=unionCoverage(tableRects,widthEmu,heightEmu);
      s.metrics.photoCoverage=unionCoverage(photoRects,widthEmu,heightEmu); s.metrics.photoCount=photoRects.length;
      s.metrics.textCoverage=unionCoverage(textRects,widthEmu,heightEmu);
      // Arrays are serialized structurally. Delimiter concatenation made
      // distinct run sequences such as ["a", "b|c"] and ["a|b", "c"] hash
      // identically, which could incorrectly classify a changed slide as an
      // exact duplicate.
      s.metrics.layoutSignature=sha256(JSON.stringify(signatures.sort()));
      s.contentHash=sha256(JSON.stringify({version:2,textParts,mediaHashes,
        layoutSignature:s.metrics.layoutSignature}));
      if (!s.metrics.textCharacters && !s.metrics.pictures && !s.metrics.charts && s.metrics.shapes < 2) {
        s.issues.push(issue("EMPTY_OR_DECORATION_ONLY", "빈 장표 또는 배경 도형만 있음"));
      }
      if (s.metrics.tableCoverage>=.45) s.issues.push(issue("TABLE_DENSE", "표 면적 45% 이상"));
      if (s.metrics.photoCoverage>=.45 || (s.metrics.photoCount>=3 && s.metrics.photoCoverage>=.30)) s.issues.push(issue("PHOTO_DENSE", "사진 추정 연속톤 이미지 면적 45% 이상 또는 3개 이상·면적 30% 이상. 추상 그래픽은 로컬 이미지 확인 후 재분류 가능"));
    } catch (error) { s.issues.push(issue("CORRUPT_SLIDE", error instanceof Error ? error.message : "장표 검사 실패")); }
  }
  return report;
}

/** @internal Raw text exists only in memory and must never be logged or persisted. */
export type PptxRedactionPrimitive = {
  key: string;
  kind: "text" | "image" | "chart" | "object";
  rect: { x: number; y: number; width: number; height: number } | null;
  text: string;
  metadata: string;
  geometryReview: boolean;
  /** The text may extend beyond the stored box; candidate-specific review is required. */
  textBoundsReview?: boolean;
};
export type PptxRedactionPrimitiveSlide = {
  sourceSlideNumber: number;
  slideContentHash: string;
  primitives: PptxRedactionPrimitive[];
  warnings: string[];
};

/**
 * Extract local-only redaction primitives from selected slides. This exposes
 * text solely to the in-process rule detector; callers must discard it after
 * classification and must not serialize the returned structure.
 */
export async function extractPptxRedactionPrimitives(
  buffer: Buffer,
  slideNumbers: readonly number[],
): Promise<{ sourceHash: string; slides: PptxRedactionPrimitiveSlide[] }> {
  if (!slideNumbers.length || new Set(slideNumbers).size !== slideNumbers.length
    || slideNumbers.some((number) => !Number.isInteger(number) || number < 1)) {
    throw new Error("INVALID_REDACTION_SLIDE_NUMBERS");
  }
  // Reuse the full security/integrity pass (macro, external relationship,
  // content type, CRC, bounded inflate) before reading any selected content.
  const inspection = await inspectPptx(buffer,{installedFonts:[]});
  if (slideNumbers.some((number) => number > inspection.totalSlides)) {
    throw new Error("INVALID_REDACTION_SLIDE_NUMBERS");
  }
  const archive = validateZip(buffer);
  const documents = new Map<string, Document>();
  async function readPart(name: string) {
    if (!documents.has(name)) {
      const bytes = archive.read(name,XML_PART_LIMIT);
      if (!bytes) throw new Error(`MISSING_PPTX_PART: ${name}`);
      documents.set(name,xml(bytes.toString("utf8"),name));
    }
    return documents.get(name)!;
  }
  const relationshipCache = new Map<string, Map<string, Rel>>();
  async function relationshipPart(name: string, sourcePart: string) {
    if (relationshipCache.has(name)) return relationshipCache.get(name)!;
    const result = new Map<string, Rel>();
    if (archive.entries.has(name)) {
      for (const entry of descendants(await readPart(name),"Relationship")) {
        const id=entry.getAttribute("Id") || "", raw=entry.getAttribute("Target") || "";
        if (!id || result.has(id)) throw new Error("INVALID_PPTX_RELATIONSHIP_ID");
        const external=entry.getAttribute("TargetMode")==="External";
        result.set(id,{target:external?raw:resolveRelationshipTarget(sourcePart,raw),
          type:entry.getAttribute("Type") || "",external});
      }
    }
    relationshipCache.set(name,result);
    return result;
  }
  const partRelationships = (name: string) => relationshipPart(
    path.posix.join(path.posix.dirname(name),"_rels",path.posix.basename(name)+".rels"),name,
  );
  const rootRelationships=await relationshipPart("_rels/.rels","");
  const officeDocuments=[...rootRelationships.values()].filter((entry)=>/\/officeDocument$/.test(entry.type));
  if(officeDocuments.length!==1 || officeDocuments[0].external) throw new Error("INVALID_OFFICE_DOCUMENT_RELATIONSHIP");
  const presentationName=officeDocuments[0].target;
  const presentation=await readPart(presentationName), presentationRelationships=await partRelationships(presentationName);
  const slideIds=presentationSlideIds(presentation);
  const widthEmu=Number(presentationChild(presentation,"sldSz").getAttribute("cx"));
  const heightEmu=Number(presentationChild(presentation,"sldSz").getAttribute("cy"));
  type RawRect={x:number;y:number;width:number;height:number};
  type Transform={sx:number;sy:number;tx:number;ty:number};
  type Scope={kind:"slide"|"slideLayout"|"slideMaster";name:string;document:Document;
    relationships:Map<string,Rel>;inherited:boolean};
  function normalizeRect(rect: RawRect): PptxRedactionPrimitive["rect"] {
    const left=Math.max(0,Math.min(widthEmu,rect.x));
    const top=Math.max(0,Math.min(heightEmu,rect.y));
    const right=Math.max(0,Math.min(widthEmu,rect.x+rect.width));
    const bottom=Math.max(0,Math.min(heightEmu,rect.y+rect.height));
    if(!(right>left && bottom>top)) return null;
    return {x:left/widthEmu,y:top/heightEmu,width:(right-left)/widthEmu,height:(bottom-top)/heightEmu};
  }
  function exactPlaceholder(document: Document | undefined, reference: El | undefined) {
    if(!document || !reference) return undefined;
    const shapes=descendants(document,"sp").filter((shape)=>one(shape,"ph"));
    const index=reference.getAttribute("idx");
    if(index!==null && index!=="") {
      const matches=shapes.filter((shape)=>one(shape,"ph")?.getAttribute("idx")===index);
      return matches.length===1?matches[0]:undefined;
    }
    const type=reference.getAttribute("type") || "obj";
    const matches=shapes.filter((shape)=>(one(shape,"ph")?.getAttribute("type") || "obj")===type);
    return matches.length===1?matches[0]:undefined;
  }
  function shapeTransform(shape: El, layout: Document | undefined, master: Document | undefined) {
    const placeholder=one(shape,"ph");
    const layoutShape=exactPlaceholder(layout,placeholder);
    const masterShape=exactPlaceholder(master,one(layoutShape,"ph") || placeholder);
    const options=[shape,layoutShape,masterShape];
    return options.map((option)=>one(option,"xfrm")).find((candidate)=>{
      const extent=candidate && children(candidate,"ext")[0];
      return Number(extent?.getAttribute("cx"))>0 && Number(extent?.getAttribute("cy"))>0;
    });
  }
  function transformedRect(xfrm: El | undefined, transform: Transform) {
    if(!xfrm) return null;
    const offset=children(xfrm,"off")[0], extent=children(xfrm,"ext")[0];
    const x=Number(offset?.getAttribute("x")), y=Number(offset?.getAttribute("y"));
    const width=Number(extent?.getAttribute("cx")), height=Number(extent?.getAttribute("cy"));
    if(![x,y,width,height].every(Number.isFinite) || !(width>0 && height>0)) return null;
    const rect={x:x*transform.sx+transform.tx,y:y*transform.sy+transform.ty,
      width:width*transform.sx,height:height*transform.sy};
    const rotation=Number(xfrm.getAttribute("rot") || 0)/60000*Math.PI/180;
    if(!rotation) return rect;
    const centerX=rect.x+rect.width/2, centerY=rect.y+rect.height/2;
    const rotatedWidth=Math.abs(rect.width*Math.cos(rotation))+Math.abs(rect.height*Math.sin(rotation));
    const rotatedHeight=Math.abs(rect.width*Math.sin(rotation))+Math.abs(rect.height*Math.cos(rotation));
    return {x:centerX-rotatedWidth/2,y:centerY-rotatedHeight/2,width:rotatedWidth,height:rotatedHeight};
  }
  const results:PptxRedactionPrimitiveSlide[]=[];
  for(const sourceSlideNumber of slideNumbers) {
    const inspected=inspection.slides[sourceSlideNumber-1];
    const primitives:PptxRedactionPrimitive[]=[], warnings=new Set<string>();
    if(inspected.issues.some((entry)=>entry.code==="CORRUPT_SLIDE")) warnings.add("SLIDE_INSPECTION_INCOMPLETE");
    try {
      const slideRelationship=presentationRelationships.get(slideIds[sourceSlideNumber-1].getAttribute("r:id") || "");
      if(!slideRelationship || slideRelationship.external) throw new Error("INVALID_SLIDE_RELATIONSHIP");
      const slide=await readPart(slideRelationship.target), slideRelationships=await partRelationships(slideRelationship.target);
      const inherited:Scope[]=[];
      let currentRelationships=slideRelationships;
      for(const kind of ["slideLayout","slideMaster"] as const) {
        const links=[...currentRelationships.values()].filter((entry)=>entry.type.endsWith("/"+kind)&&!entry.external);
        if(links.length!==1) { warnings.add("INHERITANCE_CHAIN_UNRESOLVED_REQUIRES_LOCAL_REVIEW"); break; }
        const document=await readPart(links[0].target), relationships=await partRelationships(links[0].target);
        inherited.push({kind,name:links[0].target,document,relationships,inherited:true});
        currentRelationships=relationships;
      }
      const layout=inherited.find((entry)=>entry.kind==="slideLayout")?.document;
      const master=inherited.find((entry)=>entry.kind==="slideMaster")?.document;
      const emit=(input:Omit<PptxRedactionPrimitive,"rect">&{rawRect:RawRect|null})=>{
        const rect=input.rawRect?normalizeRect(input.rawRect):null;
        if(!rect) warnings.add("GEOMETRY_UNRESOLVED");
        primitives.push({key:input.key,kind:input.kind,rect,text:input.text,metadata:input.metadata,
          geometryReview:input.geometryReview || !rect,
          ...(input.textBoundsReview?{textBoundsReview:true}:{})});
      };
      function shapeMetadata(shape:El) {
        const properties=one(shape,"cNvPr");
        return [properties?.getAttribute("name"),properties?.getAttribute("descr"),properties?.getAttribute("title")]
          .filter(Boolean).join(" ");
      }
      // DrawingML splits visually contiguous text into arbitrary runs for
      // styling. Never insert characters between runs: doing so can turn a
      // visible email/identifier into a different string and evade matching.
      // Paragraphs remain separated so content from independent lines is not
      // accidentally fused into a new token.
      function directText(node:El) {
        const paragraphs=descendants(node,"p");
        if(paragraphs.length) return paragraphs
          .map((paragraph)=>descendants(paragraph,"t").map((entry)=>entry.textContent || "").join(""))
          .join("\n").trim();
        return descendants(node,"t").map((entry)=>entry.textContent || "").join("").trim();
      }
      const inheritedVisiblePlaceholderTypes=new Set(["dt","ftr","sldNum","hdr"]);
      function xmlBoolean(value:string|null):boolean|undefined {
        if(value==="1" || value==="true") return true;
        if(value==="0" || value==="false") return false;
        return undefined;
      }
      function inheritedPlaceholderDisabled(type:string) {
        // Header/footer properties on the layout override the master. Missing
        // properties do not prove invisibility, so only explicit false skips
        // inherited content. Local slide shapes are always scanned separately.
        for(const document of [layout,master]) {
          if(!document) continue;
          const headers=children(document.documentElement,"hf");
          if(headers.length>1) { warnings.add("HEADER_FOOTER_VISIBILITY_UNRESOLVED");return false; }
          if(!headers.length) continue;
          const value=headers[0].getAttribute(type);
          // Within an existing p:hf, omitted attributes default to true; an
          // empty layout p:hf must not inherit a disabling master attribute.
          if(value===null || value==="") return false;
          const enabled=xmlBoolean(value);
          if(enabled===undefined) warnings.add("HEADER_FOOTER_VISIBILITY_UNRESOLVED");
          return enabled===false;
        }
        return false;
      }
      const uninspectableObjectNames=["oleObj","videoFile","audioFile","quickTimeFile","contentPart",
        "webVideoPr","audioCd","wavAudioFile"] as const;
      const hasUninspectableObject=(shape:El)=>uninspectableObjectNames
        .some((name)=>descendants(shape,name).length>0);
      function textBoundsNeedReview(shape:El) {
        if(!descendants(shape,"t").length) return false;
        return descendants(shape,"bodyPr").some((bodyPr)=>{
          const vertical=bodyPr.getAttribute("vert") || "horz";
          return vertical!=="horz"
            || bodyPr.getAttribute("vertOverflow")==="overflow"
            || bodyPr.getAttribute("horzOverflow")==="overflow"
            || bodyPr.getAttribute("wrap")==="none"
            || descendants(bodyPr,"spAutoFit").length>0
            || descendants(bodyPr,"noAutofit").length>0
            || descendants(bodyPr,"prstTxWarp").length>0;
        });
      }
      async function walk(container:El,transform:Transform,scope:Scope,keyPrefix:string,forcedRect:RawRect|null=null) {
        for(const [position,shape] of children(container).entries()) {
          const key=`${keyPrefix}/${position}-${shape.localName}`;
          if(shape.localName==="AlternateContent") {
            emit({key,kind:"object",rawRect:forcedRect,text:directText(shape),metadata:"alternate content",geometryReview:true});
            warnings.add("UNINSPECTABLE_OBJECT_REVIEW");
            continue;
          }
          if(!["sp","pic","graphicFrame","grpSp","cxnSp"].includes(shape.localName)) continue;
          // cNvPr.hidden is a rendering flag, not an empty/false attribute
          // truthiness check. In particular hidden="0" remains visible.
          if(xmlBoolean(one(shape,"cNvPr")?.getAttribute("hidden")??null)===true) continue;
          const inheritedPlaceholder=scope.inherited && shape.localName!=="grpSp" && one(shape,"ph");
          if(inheritedPlaceholder) {
            const placeholderType=one(shape,"ph")?.getAttribute("type") || "obj";
            // Ordinary master/layout placeholder text is authoring sample text,
            // not rendered slide content. Header/footer/date/number fields may
            // be visible and cannot be resolved without PowerPoint rendering,
            // so scan them but keep the slide fail-closed for local review.
            if(!inheritedVisiblePlaceholderTypes.has(placeholderType)
              || inheritedPlaceholderDisabled(placeholderType) || !directText(shape)) continue;
            warnings.add("INHERITED_PLACEHOLDER_VISIBILITY_REQUIRES_LOCAL_REVIEW");
          }
          const xfrm=shapeTransform(shape,layout,master);
          const rawRect=forcedRect || transformedRect(xfrm,transform);
          const rotated=Boolean(Number(xfrm?.getAttribute("rot") || 0));
          const flipped=xmlBoolean(xfrm?.getAttribute("flipH")??null)===true
            || xmlBoolean(xfrm?.getAttribute("flipV")??null)===true;
          if(rotated) warnings.add("ROTATED_GEOMETRY_REVIEW");
          if(flipped) warnings.add("FLIPPED_GEOMETRY_REVIEW");
          const emitGroupFallback=()=>{
            const groupText=directText(shape);
            if(groupText) emit({key,kind:"text",rawRect,text:groupText,metadata:shapeMetadata(shape),geometryReview:true});
            if(descendants(shape,"blip").length) emit({key:key+"/media",kind:"image",rawRect,text:"",metadata:shapeMetadata(shape),geometryReview:true});
            if(descendants(shape,"chart").length||descendants(shape,"relIds").length) {
              emit({key:key+"/chart",kind:"chart",rawRect,text:"",metadata:shapeMetadata(shape),geometryReview:true});
            }
            if(hasUninspectableObject(shape)) {
              emit({key:key+"/object",kind:"object",rawRect,text:"",metadata:shapeMetadata(shape),geometryReview:true});
              warnings.add("UNINSPECTABLE_OBJECT_REVIEW");
            }
          };
          if(shape.localName==="grpSp") {
            if(!rawRect || rotated || flipped) {
              emitGroupFallback();
              warnings.add("GROUP_GEOMETRY_REVIEW");
              continue;
            }
            const childOffset=xfrm&&children(xfrm,"chOff")[0], childExtent=xfrm&&children(xfrm,"chExt")[0];
            const childWidth=Number(childExtent?.getAttribute("cx")),childHeight=Number(childExtent?.getAttribute("cy"));
            if(!(childWidth>0&&childHeight>0)) {
              emit({key,kind:"text",rawRect,text:directText(shape),metadata:shapeMetadata(shape),geometryReview:true});
              warnings.add("GROUP_GEOMETRY_REVIEW");
              continue;
            }
            const sx=rawRect.width/childWidth,sy=rawRect.height/childHeight;
            const rotatedDescendant=descendants(shape,"xfrm")
              .some((candidate)=>Number(candidate.getAttribute("rot") || 0)!==0);
            if(rotatedDescendant && Math.abs(sx-sy)>Math.max(Math.abs(sx),Math.abs(sy),1)*1e-9) {
              // Rotation composed with non-uniform group scaling is not
              // representable by the simple scale/translate transform below.
              // Mask/review the conservative group outer box instead of an
              // under-sized child box.
              emitGroupFallback();
              warnings.add("GROUP_TRANSFORM_REQUIRES_LOCAL_REVIEW");
              continue;
            }
            await walk(shape,{sx,sy,tx:rawRect.x-Number(childOffset?.getAttribute("x")||0)*sx,
              ty:rawRect.y-Number(childOffset?.getAttribute("y")||0)*sy},scope,key);
            continue;
          }
          const textBoundsReview=textBoundsNeedReview(shape);
          // Autofit/wrap flags are common in ordinary design text. They only
          // require a blocking bounds decision when the detector finds an
          // actual disclosure candidate in this primitive.
          const geometryReview=rotated||flipped||!rawRect||Boolean(inheritedPlaceholder)||textBoundsReview;
          const table=one(shape,"tbl");
          const mergedTable=Boolean(table&&descendants(table,"tc").some((cell)=>
            Number(cell.getAttribute("rowSpan") || 1)>1 || Number(cell.getAttribute("gridSpan") || 1)>1
            || cell.getAttribute("hMerge")==="1" || cell.getAttribute("vMerge")==="1"));
          if(table && rawRect && !geometryReview && !mergedTable) {
            const columns=children(one(table,"tblGrid"),"gridCol").map((entry)=>Number(entry.getAttribute("w")));
            const rows=children(table,"tr"),columnTotal=columns.reduce((sum,value)=>sum+value,0);
            const rowHeights=rows.map((entry)=>Number(entry.getAttribute("h"))),rowTotal=rowHeights.reduce((sum,value)=>sum+value,0);
            if(columnTotal>0&&rowTotal>0&&columns.every((value)=>value>0)&&rowHeights.every((value)=>value>0)) {
              let yOffset=0;
              for(const [rowIndex,row] of rows.entries()) {
                let columnIndex=0;
                for(const [cellIndex,cell] of children(row,"tc").entries()) {
                  const span=Math.max(1,Number(cell.getAttribute("gridSpan"))||1);
                  const xOffset=columns.slice(0,columnIndex).reduce((sum,value)=>sum+value,0);
                  const cellWidth=columns.slice(columnIndex,columnIndex+span).reduce((sum,value)=>sum+value,0);
                  emit({key:`${key}/r${rowIndex}c${cellIndex}`,kind:"text",rawRect:{
                    x:rawRect.x+rawRect.width*xOffset/columnTotal,y:rawRect.y+rawRect.height*yOffset/rowTotal,
                    width:rawRect.width*cellWidth/columnTotal,height:rawRect.height*rowHeights[rowIndex]/rowTotal,
                  },text:directText(cell),metadata:shapeMetadata(shape),geometryReview:false});
                  columnIndex+=span;
                }
                yOffset+=rowHeights[rowIndex];
              }
            } else {
              emit({key,kind:"text",rawRect,text:directText(table),metadata:shapeMetadata(shape),geometryReview:true});
              warnings.add("TABLE_GEOMETRY_REVIEW");
            }
          } else if(table) {
            emit({key,kind:"text",rawRect,text:directText(table),metadata:shapeMetadata(shape),geometryReview:true,textBoundsReview});
            warnings.add("TABLE_GEOMETRY_REVIEW");
          } else {
            const text=directText(shape);
            if(text) emit({key,kind:"text",rawRect,text,metadata:shapeMetadata(shape),geometryReview,textBoundsReview});
          }
          if(shape.localName==="pic" || descendants(shape,"blip").length) {
            emit({key:key+"/media",kind:"image",rawRect,text:"",metadata:shapeMetadata(shape),geometryReview});
            warnings.add("IMAGE_CONTENT_REQUIRES_LOCAL_REVIEW");
          }
          if(shape.localName==="graphicFrame"&&!table) {
            const chart=Boolean(one(shape,"chart")||one(shape,"relIds"));
            emit({key:key+"/graphic",kind:chart?"chart":"object",rawRect,text:directText(shape),metadata:shapeMetadata(shape),geometryReview});
            warnings.add(chart?"CHART_CONTENT_REQUIRES_LOCAL_REVIEW":"UNINSPECTABLE_OBJECT_REVIEW");
          }
          if(hasUninspectableObject(shape)) {
            // OLE/video/audio can be attached to ordinary sp/pic containers,
            // not just graphicFrame. Emit a required object primitive so a
            // warning can never be mistaken for a safe slide.
            emit({key:key+"/embedded-object",kind:"object",rawRect,text:"",metadata:shapeMetadata(shape),geometryReview:true});
            warnings.add("UNINSPECTABLE_OBJECT_REVIEW");
          }
        }
      }
      const slideScope:Scope={kind:"slide",name:slideRelationship.target,document:slide,
        relationships:slideRelationships,inherited:false};
      const slideTree=one(slide,"spTree");
      if(!slideTree) throw new Error("MISSING_SLIDE_TREE");
      await walk(slideTree,{sx:1,sy:1,tx:0,ty:0},slideScope,"slide");
      const slideTreeBlips=new Set(descendants(slideTree,"blip"));
      for(const [position] of descendants(slide,"blip").filter((entry)=>!slideTreeBlips.has(entry)).entries()) {
        emit({key:`slide/background-${position}`,kind:"image",rawRect:{x:0,y:0,width:widthEmu,height:heightEmu},
          text:"",metadata:"background image",geometryReview:false});
        warnings.add("IMAGE_CONTENT_REQUIRES_LOCAL_REVIEW");
      }
      const visibleInherited=inherited.filter((scope)=>scope.kind==="slideLayout"
        || (xmlBoolean(slide.documentElement.getAttribute("showMasterSp"))!==false
          && xmlBoolean(layout?.documentElement.getAttribute("showMasterSp")??null)!==false));
      for(const scope of visibleInherited) {
        const tree=one(scope.document,"spTree");
        if(tree) await walk(tree,{sx:1,sy:1,tx:0,ty:0},scope,scope.kind);
        const treeBlips=new Set(tree?descendants(tree,"blip"):[]);
        for(const [position] of descendants(scope.document,"blip").filter((entry)=>!treeBlips.has(entry)).entries()) {
          emit({key:`${scope.kind}/background-${position}`,kind:"image",rawRect:{x:0,y:0,width:widthEmu,height:heightEmu},
            text:"",metadata:"background image",geometryReview:false});
          warnings.add("IMAGE_CONTENT_REQUIRES_LOCAL_REVIEW");
        }
      }
    } catch {
      warnings.add("SLIDE_REDACTION_EXTRACTION_INCOMPLETE");
    }
    results.push({sourceSlideNumber,slideContentHash:inspected.contentHash,primitives,warnings:[...warnings].sort()});
  }
  return {sourceHash:inspection.sourceHash,slides:results};
}
