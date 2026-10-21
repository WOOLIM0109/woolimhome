import { inflateRawSync } from "node:zlib";
import { Readable } from "node:stream";
import CFB from "cfb";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

// 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
// https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf
export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_ATTACHMENTS = 10;
const MAX_ZIP_ENTRIES = 2000;
const MAX_TEXT_CHARS = 2_000_000;
const MAX_PDF_PAGES = 500;
const MAX_XML_DEPTH = 256;

export type TextExtractionResult = {
  status: "extracted" | "no_text" | "failed" | "skipped";
  text: string;
  textChars: number;
  error: string | null;
};

export type ExpandedAttachment = {
  fileName: string;
  fileExt: "hwp" | "hwpx" | "pdf";
  bytes: Buffer;
};

export class AttachmentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentLimitError";
  }
}

function result(status: TextExtractionResult["status"], text = "", error: string | null = null): TextExtractionResult {
  // PostgreSQL text rejects U+0000. Preserve every other character and evidence marker.
  // Parser size checks run before this boundary, so NULs cannot bypass input limits.
  text = text.replace(/\u0000/g, "");
  return { status, text, textChars: text.length, error };
}

function extension(fileNameOrExt: string) {
  return fileNameOrExt.toLowerCase().replace(/^.*[.]/, "").replace(/^\./, "");
}

function assertInputSize(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentLimitError("파일 크기 30MB 초과");
}

function assertTextSize(text: string) {
  if (text.length > MAX_TEXT_CHARS) throw new AttachmentLimitError("추출 글자 수 제한 초과");
}

function paragraphText(paragraphs: string[]) {
  return paragraphs
    .map((value) => value.replace(/\r/g, "").trim())
    .filter(Boolean)
    .map((value, index) => `[para.${index + 1}] ${value}`)
    .join("\n\n");
}

function decodeArchiveName(input: Uint8Array | string[]) {
  const bytes = Array.isArray(input) ? Uint8Array.from(input.map((byte) => Number(byte))) : input;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

async function readZip(bytes: Uint8Array) {
  assertInputSize(bytes);
  const zip = await JSZip.loadAsync(bytes, { decodeFileName: decodeArchiveName });
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) throw new AttachmentLimitError("ZIP 항목 수 제한 초과");
  let declaredSize = 0;
  for (const entry of entries) {
    // JSZip keeps central-directory sizes on _data without decompressing the entry.
    const metadata = entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
    declaredSize += metadata._data?.uncompressedSize ?? 0;
    if (declaredSize > MAX_ARCHIVE_BYTES) throw new AttachmentLimitError("ZIP 해제 크기 100MB 초과");
    const originalName = (entry.unsafeOriginalName ?? entry.name).replace(/\\/g, "/");
    if (originalName.split("/").includes("..") || originalName.startsWith("/") || /^[a-z]:/i.test(originalName)) {
      throw new AttachmentLimitError("안전하지 않은 ZIP 파일 경로");
    }
  }
  return zip;
}

async function readZipEntry(entry: JSZip.JSZipObject, maxBytes: number) {
  const stream = entry.nodeStream("nodebuffer") as Readable;
  const chunks: Buffer[] = [];
  let size = 0;
  // Enforce actual inflated size as well, so a forged central directory cannot bypass limits.
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.pause();
        stream.destroy?.();
        reject(new AttachmentLimitError("ZIP 파일 해제 크기 제한 초과"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return Buffer.concat(chunks, size);
}

/** Expand supported leaf documents only; nested archives are never followed. */
export async function expandZipAttachments(bytes: Uint8Array): Promise<ExpandedAttachment[]> {
  const zip = await readZip(bytes);
  const files = Object.values(zip.files).filter((entry) => !entry.dir && /\.(hwp|hwpx|pdf)$/i.test(entry.name));
  const expanded: ExpandedAttachment[] = [];
  let totalSize = 0;
  for (const entry of files.slice(0, MAX_ZIP_ATTACHMENTS)) {
    const content = await readZipEntry(entry, Math.min(MAX_ATTACHMENT_BYTES, MAX_ARCHIVE_BYTES - totalSize));
    totalSize += content.length;
    expanded.push({
      // Retain relative folders to disambiguate two files with the same basename.
      fileName: entry.name.replace(/\\/g, "/"),
      fileExt: extension(entry.name) as ExpandedAttachment["fileExt"],
      bytes: content,
    });
  }
  return expanded;
}

function elementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function renderHwpxNode(node: Element, depth = 0): string {
  if (depth > MAX_XML_DEPTH) throw new AttachmentLimitError("HWPX XML 깊이 제한 초과");
  const name = node.localName;
  if (name === "t") return node.textContent ?? "";
  if (name === "lineBreak") return "\n";
  if (name === "tab") return "\t";
  if (name === "tbl") {
    return "\n" + elementChildren(node)
      .filter((row) => row.localName === "tr")
      .map((row) => elementChildren(row)
        .filter((cell) => cell.localName === "tc")
        .map((cell) => renderHwpxNode(cell, depth + 1).replace(/\s*\n\s*/g, " ").trim())
        .join(" | "))
      .join("\n") + "\n";
  }
  const text = elementChildren(node).map((child) => renderHwpxNode(child, depth + 1)).join("");
  return name === "p" ? text + "\n" : text;
}

async function extractHwpx(bytes: Uint8Array): Promise<TextExtractionResult> {
  const zip = await readZip(bytes);
  const sections = Object.values(zip.files)
    .filter((entry) => /^Contents\/section\d+\.xml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (!sections.length) return result("failed", "", "HWPX 본문 구역 없음");
  const paragraphs: string[] = [];
  let inflatedSize = 0;
  let textSize = 0;
  for (const section of sections) {
    const content = await readZipEntry(section, Math.min(MAX_ATTACHMENT_BYTES, MAX_ARCHIVE_BYTES - inflatedSize));
    inflatedSize += content.length;
    const xml = content.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return result("failed", "", "HWPX 외부 엔터티 금지");
    let invalidXml = false;
    const document = new DOMParser({
      errorHandler: {
        warning: () => { invalidXml = true; },
        error: () => { invalidXml = true; },
        fatalError: () => { invalidXml = true; },
      },
    }).parseFromString(xml, "application/xml");
    if (invalidXml || !document.documentElement) return result("failed", "", "HWPX XML 형식 오류");
    const text = renderHwpxNode(document.documentElement);
    textSize += text.length;
    if (textSize > MAX_TEXT_CHARS) throw new AttachmentLimitError("추출 글자 수 제한 초과");
    paragraphs.push(...text.split("\n"));
  }
  const text = paragraphText(paragraphs);
  assertTextSize(text);
  return text ? result("extracted", text) : result("no_text", "", "본문 글자 없음");
}

/** Hancom HWP 5.0, table 6: codes 1–23 except 10/13 occupy eight WCHARs. */
function decodeHwpParagraph(bytes: Buffer) {
  if (bytes.length % 2) throw new Error("invalid_hwp_text");
  let text = "";
  for (let offset = 0; offset < bytes.length;) {
    const code = bytes.readUInt16LE(offset);
    if (code >= 32) {
      text += String.fromCharCode(code);
      offset += 2;
    } else if (code > 0 && code < 24 && code !== 10 && code !== 13) {
      if (offset + 16 > bytes.length) throw new Error("invalid_hwp_control");
      if (code === 9) text += "\t";
      offset += 16;
    } else {
      if (code === 10 || code === 13) text += "\n";
      if (code === 24) text += "-";
      if (code === 30 || code === 31) text += " ";
      offset += 2;
    }
  }
  return text;
}

function extractHwp(bytes: Uint8Array): TextExtractionResult {
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) return result("failed", "", "HWP OLE 형식 오류");
  const container = CFB.read(buffer, { type: "buffer" });
  const headerEntry = CFB.find(container, "FileHeader");
  if (!headerEntry) return result("failed", "", "HWP FileHeader 없음");
  const header = Buffer.from(headerEntry.content);
  if (header.length < 40 || header.toString("ascii", 0, 17) !== "HWP Document File" || header[35] !== 5) {
    return result("failed", "", "HWP 5.0 형식 오류");
  }
  const flags = header.readUInt32LE(36);
  if (flags & 4) return result("no_text", "", "배포용 문서");
  if (flags & (2 | 16 | 256 | 1024 | 8192)) return result("no_text", "", "암호화 또는 보안 문서");
  const sections = container.FullPaths.map((path, index) => ({ path, entry: container.FileIndex[index] }))
    .filter(({ path }) => /\/BodyText\/Section\d+$/i.test(path))
    .sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
  if (!sections.length) return result("failed", "", "HWP 본문 구역 없음");
  const paragraphs: string[] = [];
  let inflatedSize = 0;
  let textSize = 0;
  for (const { entry } of sections) {
    const content = Buffer.from(entry.content);
    const section = flags & 1
      ? inflateRawSync(content, { maxOutputLength: MAX_ARCHIVE_BYTES - inflatedSize })
      : content;
    inflatedSize += section.length;
    if (inflatedSize > MAX_ARCHIVE_BYTES) throw new AttachmentLimitError("HWP 해제 크기 100MB 초과");
    for (let offset = 0; offset < section.length;) {
      if (offset + 4 > section.length) throw new Error("invalid_hwp_record");
      const record = section.readUInt32LE(offset);
      const tag = record & 0x3ff;
      let size = record >>> 20;
      offset += 4;
      if (size === 0xfff) {
        if (offset + 4 > section.length) throw new Error("invalid_hwp_record");
        size = section.readUInt32LE(offset);
        offset += 4;
      }
      if (offset + size > section.length) throw new Error("invalid_hwp_record");
      if (tag === 67) {
        const text = decodeHwpParagraph(section.subarray(offset, offset + size));
        textSize += text.length;
        if (textSize > MAX_TEXT_CHARS) throw new AttachmentLimitError("추출 글자 수 제한 초과");
        paragraphs.push(text);
      }
      offset += size;
    }
  }
  const text = paragraphText(paragraphs);
  assertTextSize(text);
  return text ? result("extracted", text) : result("no_text", "", "본문 글자 없음");
}

async function extractPdf(bytes: Uint8Array): Promise<TextExtractionResult> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    verbosity: 0,
    disableAutoFetch: true,
    disableStream: true,
    maxImageSize: 16_777_216,
  });
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new AttachmentLimitError("PDF 쪽 수 500쪽 초과");
    const { text: pages } = await extractPdfText(pdf, { mergePages: false });
    const rawText = pages.join("\n");
    assertTextSize(rawText);
    if (rawText.trim().length < 50) return result("no_text", "", "스캔본 추정");
    const text = pages.map((page, index) => `\n\n[p.${index + 1}]\n${page.trim()}`).join("");
    assertTextSize(text);
    return result("extracted", text);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Errors intentionally contain fixed descriptions, never document text or library diagnostics. */
export async function extractAttachmentText(bytes: Uint8Array, fileNameOrExt: string): Promise<TextExtractionResult> {
  try {
    assertInputSize(bytes);
    switch (extension(fileNameOrExt)) {
      case "hwp": return extractHwp(bytes);
      case "hwpx": return await extractHwpx(bytes);
      case "pdf": return await extractPdf(bytes);
      case "zip": return result("skipped", "", "ZIP은 개별 첨부로 펼쳐 처리");
      default: return result("skipped", "", "지원하지 않는 파일 형식");
    }
  } catch (error) {
    if (error instanceof AttachmentLimitError) return result("skipped", "", error.message);
    return result("failed", "", "첨부 문서 형식 오류 또는 추출 실패");
  }
}
