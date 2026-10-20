import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
export type AttachmentLink = { fileName: string; fileExt: string; sourceUrl: string };
const FILE = /([^<>"/\\|?*]{1,200}\.(?:hwpx?|pdf|zip))(?=\s|$|[),])/i;
// Only the configured public agencies may initiate downloads. External destinations
// require an inspected adapter; this also prevents attacker-controlled DNS rebinding.
const ATTACHMENT_DOMAINS = ["bizinfo.go.kr", "mss.go.kr", "k-startup.go.kr", "sbiz24.kr", "semas.or.kr",
  "btp.or.kr", "smart-factory.kr", "ripc.org", "fanfandaero.kr", "yeongdo.go.kr", "busanstartup.kr",
  "kspo.or.kr", "gjtp.or.kr", "touraz.kr", "bsbukgu.go.kr", "bepa.kr", "bsdonggu.go.kr", "mssmiv.com", "smtech.go.kr"];

function decode(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "");
}
function plain(value: string) {
  return decode(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function attribute(tag: string, key: string) {
  return decode(tag.match(new RegExp(`\\b${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] || "");
}

/** Direct downloads and the standard eGov file handler used by public agencies. */
export function extractAttachments(html: string, baseUrl: string): AttachmentLink[] {
  const links: AttachmentLink[] = [];
  const seen = new Set<string>();
  const pattern = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(pattern)) {
    const tag = match[2];
    const label = plain(match[3]);
    let href = attribute(tag, "data-href") || attribute(tag, "href");
    const busanFile = attribute(tag, "data-idx");
    if (new URL(baseUrl).hostname.endsWith("busanstartup.kr") && /^\d+$/.test(busanFile)) {
      href = `/download_total_idx.do?f_idx=${busanFile}&type=${encodeURIComponent(attribute(tag, "data-type"))}`;
    }
    const handler = `${href} ${attribute(tag, "onclick")}`;
    const egov = handler.match(/(?:fn_egov_downFile|fn_fileDown)\(\s*['"](FILE_[^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*\)/i);
    if (egov) href = `/cmm/fms/fileDown.do?atchFileId=${encodeURIComponent(egov[1])}&fileSn=${egov[2]}`;
    const sports = handler.match(/fn_fileDown\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
    if (new URL(baseUrl).hostname.endsWith("spobiz.kspo.or.kr") && sports) {
      href = `/front/sportsHistory/sportsBissMng/applBissFileDownload.do?${new URLSearchParams({ orgFileName: sports[1], saveFileName: sports[2], filePath: sports[3] })}`;
    }
    if (!href || /^(?:javascript:|#|mailto:|tel:)/i.test(href)) continue;
    if (!/filedown|download|atchfile|\/getFile(?:[?/.]|$)|\.(?:hwpx?|pdf|zip)(?:[?#]|$)/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href, baseUrl); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const ancestors: Array<{ name: string; start: number }> = [];
    for (const element of html.slice(0, match.index).matchAll(/<(\/?)(li|dl|tr)\b[^>]*>/gi)) {
      const name = element[2].toLowerCase();
      if (!element[1]) ancestors.push({ name, start: element.index! });
      else {
        const index = ancestors.map((parent) => parent.name).lastIndexOf(name);
        if (index >= 0) ancestors.splice(index);
      }
    }
    const container = ancestors.reverse().map((parent) =>
      plain(html.slice(parent.start, match.index! + match[0].length)),
    ).find((text) => FILE.test(text)) || "";
    let urlName = url.searchParams.get("wonFileName") || url.searchParams.get("orgFileName") || url.pathname.split("/").pop() || "";
    try { urlName = decodeURIComponent(urlName); } catch { /* preserve URL */ }
    const name = [attribute(tag, "download"), attribute(tag, "title"), label, container, urlName]
      .map((candidate) => candidate.match(FILE)?.[1]?.trim()).find(Boolean);
    const fileName = name || `첨부-${links.length + 1}`;
    links.push({ fileName, fileExt: name?.match(/\.(hwpx?|pdf|zip)$/i)?.[1]?.toLowerCase() || "unknown", sourceUrl: url.href });
  }
  return links.slice(0, 50);
}

export function isPrivateAddress(ip: string) {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("::ffff:")) return true;
    return lower === "::" || lower === "::1" || /^(?:fc|fd|fe[89ab]|ff)/.test(lower);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublicUrl(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw new Error("첨부 URL 형식 거부");
  }
  if (!ATTACHMENT_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error("검증되지 않은 외부 첨부 호스트");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("비공개 네트워크 URL 거부");
}

export class AttachmentTooLarge extends Error {
  constructor() { super("파일당 30MB 초과"); }
}

/** Bounded streaming and redirect checks; never include request URLs or headers in errors. */
export async function fetchAttachmentResource(sourceUrl: string, maxBytes = MAX_ATTACHMENT_BYTES, timeoutMs = 20_000,
  form?: { method: "POST"; body: URLSearchParams }) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(sourceUrl);
  for (let redirect = 0; redirect <= 5; redirect++) {
    await assertPublicUrl(url);
    const response = await fetch(url, {
      redirect: "manual", signal, cache: "no-store",
      ...(form ? { method: form.method, body: form.body } : {}),
      headers: { "User-Agent": "Mozilla/5.0 WoolimSupportCollector/1.0", "Accept-Language": "ko-KR,ko;q=0.9" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("다운로드 이동 주소 없음");
      url = new URL(location, url);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && form)) form = undefined;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`기관 HTTP ${response.status}`); }
    if (Number(response.headers.get("content-length") || 0) > maxBytes) {
      await response.body?.cancel(); throw new AttachmentTooLarge();
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("다운로드 본문 없음");
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AttachmentTooLarge(); }
      chunks.push(chunk.value);
    }
    return { bytes: Buffer.concat(chunks), headers: response.headers, url: url.href };
  }
  throw new Error("다운로드 이동 횟수 초과");
}

export function attachmentFileName(headers: Headers, fallback: string, bytes: Uint8Array) {
  const disposition = headers.get("content-disposition") || "";
  const extended = disposition.match(/filename\*\s*=\s*([\w-]+)'[^']*'([^;]+)/i);
  let name = extended?.[2]
    || disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    || disposition.match(/filename\s*=\s*([^;]+)/i)?.[1];
  if (name) {
    try {
      if (extended && !/^utf-?8$/i.test(extended[1])) {
        const raw = name.trim().replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        name = new TextDecoder(extended[1], { fatal: true }).decode(Buffer.from(raw, "latin1"));
      } else name = decodeURIComponent(name.trim());
    } catch { /* preserve raw name */ }
  }
  if (name && /[\x80-\xff]/.test(name) && !/[^\x00-\xff]/.test(name)) {
    const raw = Buffer.from(name, "latin1");
    try { name = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
    catch { const korean = new TextDecoder("euc-kr").decode(raw); if (!korean.includes("\ufffd")) name = korean; }
  }
  name = (name || fallback).split(/[\\/]/).pop()!.replace(/[\x00-\x1f]/g, "").slice(0, 200) || "첨부";
  let ext = name.match(/\.(hwpx?|pdf|zip)$/i)?.[1]?.toLowerCase();
  if (!ext) {
    const signature = Buffer.from(bytes.subarray(0, 8));
    ext = signature.subarray(0, 4).toString() === "%PDF" ? "pdf"
      : signature.toString("hex") === "d0cf11e0a1b11ae1" ? "hwp"
      : signature.subarray(0, 2).toString() === "PK"
        ? (Buffer.from(bytes).includes(Buffer.from("Contents/section")) ? "hwpx" : "zip") : "unknown";
    if (ext !== "unknown") name += `.${ext}`;
  }
  return { fileName: name, fileExt: ext };
}
