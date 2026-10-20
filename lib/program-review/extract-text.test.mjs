import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import CFB from "cfb";
import JSZip from "jszip";
import {
  AttachmentLimitError,
  MAX_ATTACHMENT_BYTES,
  MAX_ZIP_ATTACHMENTS,
  expandZipAttachments,
  extractAttachmentText,
} from "./extract-text.ts";

const fixture = (name) => readFile(new URL(`../../test-fixtures/program-review/${name}`, import.meta.url));

function hwpRecord(tag, body, extended = false) {
  const header = Buffer.alloc(extended ? 8 : 4);
  header.writeUInt32LE(((extended ? 0xfff : body.length) << 20 | tag) >>> 0);
  if (extended) header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function hwpDocument(records, flags = 1) {
  const container = CFB.utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write("HWP Document File");
  header[35] = 5;
  header.writeUInt32LE(flags, 36);
  CFB.utils.cfb_add(container, "FileHeader", header);
  CFB.utils.cfb_add(container, "BodyText/Section0", flags & 1 ? deflateRawSync(records) : records);
  return CFB.write(container, { type: "buffer" });
}

const xml = (text) => `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${text}</hs:sec>`;
const p = (text) => `<hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`;

test("실제 공고 HWP에서 신청자격·제출서류 및 근거 문단 번호를 추출한다", async () => {
  const extracted = await extractAttachmentText(await fixture("agro-industrial-2026.hwp"), "notice.HWP");
  assert.equal(extracted.status, "extracted");
  // 원문 제목은 '신청 자격'처럼 띄어 쓰므로 원문의 공백은 보존한다.
  assert.ok(extracted.text.replace(/\s/g, "").includes("신청자격"));
  assert.ok(extracted.text.replace(/\s/g, "").includes("제출서류"));
  assert.match(extracted.text, /\[para\.1\]/);
  assert.match(extracted.text, /농공상융합형/);
  assert.equal(extracted.textChars, extracted.text.length);
  assert.equal(extracted.error, null);
});

test("실제 HWPX 공고의 본문과 표 셀 경계를 보존한다", async () => {
  const extracted = await extractAttachmentText(await fixture("social-enterprise-2026.hwpx"), "hwpx");
  assert.equal(extracted.status, "extracted");
  assert.match(extracted.text, /사회적기업/);
  assert.match(extracted.text, /제출서류/);
  assert.match(extracted.text, / \| /);
  assert.match(extracted.text, /\[para\.\d+\]/);
});

test("실제 PDF 공고의 11쪽을 순서대로 표시한다", async () => {
  const extracted = await extractAttachmentText(await fixture("social-enterprise-2026.pdf"), "pdf");
  assert.equal(extracted.status, "extracted");
  assert.match(extracted.text, /^\n\n\[p\.1\]\n/);
  assert.equal([...extracted.text.matchAll(/\[p\.\d+\]/g)].length, 11);
  assert.match(extracted.text, /\[p\.11\]/);
  assert.match(extracted.text, /사회적기업/);
  assert.match(extracted.text, /제출서류/);
});

test("실제 배포 ZIP의 빈 신청양식 6개를 독립 첨부로 펼쳐 추출한다", async () => {
  const files = await expandZipAttachments(await fixture("invention-procurement-2026.zip"));
  assert.equal(files.length, 6);
  assert.ok(files.every((file) => file.fileExt === "hwp" && file.bytes.length > 0));
  for (const file of files) {
    const extracted = await extractAttachmentText(file.bytes, file.fileExt);
    assert.equal(extracted.status, "extracted", file.fileName);
    assert.match(extracted.text, /\[para\.\d+\]/);
  }
});

test("HWP 압축·비압축, 12비트 확장 크기와 인라인/확장 제어문자를 처리한다", async () => {
  const inline = Buffer.alloc(16, 65);
  inline.writeUInt16LE(9, 0);
  inline.writeUInt16LE(9, 14);
  const extended = Buffer.alloc(16, 66);
  extended.writeUInt16LE(2, 0);
  extended.writeUInt16LE(2, 14);
  const oneChar = Buffer.from([25, 0]);
  const body = Buffer.concat([
    extended, Buffer.from("신청", "utf16le"), oneChar, Buffer.from("자격", "utf16le"),
    inline, Buffer.from("제출서류\r다음 문단", "utf16le"),
  ]);
  const ignored = hwpRecord(68, Buffer.from("본문 아님", "utf16le"));
  for (const flags of [0, 1]) {
    const extracted = await extractAttachmentText(hwpDocument(Buffer.concat([ignored, hwpRecord(67, body, true)]), flags), "hwp");
    assert.equal(extracted.status, "extracted");
    assert.match(extracted.text, /신청자격\t제출서류\n다음 문단/);
    assert.doesNotMatch(extracted.text, /본문 아님|AAAA|BBBB/);
  }
});

test("배포용·암호화 HWP에서 미리보기나 본문을 우회 추출하지 않는다", async () => {
  const records = hwpRecord(67, Buffer.from("문서 본문", "utf16le"));
  const distribution = await extractAttachmentText(hwpDocument(records, 5), "hwp");
  assert.deepEqual(distribution, { status: "no_text", text: "", textChars: 0, error: "배포용 문서" });
  const encrypted = await extractAttachmentText(hwpDocument(records, 3), "hwp");
  assert.equal(encrypted.status, "no_text");
  assert.equal(encrypted.textChars, 0);
});

test("손상된 HWP 레코드는 일부 글자를 정상 추출로 보고하지 않는다", async () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE((100 << 20) | 67);
  const extracted = await extractAttachmentText(hwpDocument(header), "hwp");
  assert.equal(extracted.status, "failed");
  assert.equal(extracted.text, "");
});

test("HWPX 구역 숫자 순서와 표 행/셀 경계를 유지한다", async () => {
  const zip = new JSZip();
  zip.file("Contents/section10.xml", xml(p("마지막")));
  zip.file("Contents/section2.xml", xml(p("신청자격") + `<hp:tbl><hp:tr><hp:tc>${p("첫 셀")}</hp:tc><hp:tc>${p("둘째 셀")}${p("둘째 문단")}</hp:tc></hp:tr><hp:tr><hp:tc>${p("다음 행")}</hp:tc></hp:tr></hp:tbl>`));
  const extracted = await extractAttachmentText(await zip.generateAsync({ type: "nodebuffer" }), "hwpx");
  assert.equal(extracted.status, "extracted");
  assert.equal(extracted.text, "[para.1] 신청자격\n\n[para.2] 첫 셀 | 둘째 셀 둘째 문단\n\n[para.3] 다음 행\n\n[para.4] 마지막");
});

test("XML 엔터티와 손상된 문서는 원문 진단을 노출하지 않는다", async () => {
  const zip = new JSZip();
  zip.file("Contents/section0.xml", '<!DOCTYPE x [<!ENTITY x "DOCUMENT_PAYLOAD">]><x>&x;</x>');
  const extracted = await extractAttachmentText(await zip.generateAsync({ type: "nodebuffer" }), "hwpx");
  assert.equal(extracted.status, "failed");
  assert.equal(extracted.error, "HWPX 외부 엔터티 금지");
  assert.doesNotMatch(JSON.stringify(extracted), /DOCUMENT_PAYLOAD/);
});

function tinyPdf(text) {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(content.length);
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = content.length;
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

test("PDF의 50자 기준은 추가한 쪽 표식을 제외한 본문으로 판정한다", async () => {
  const short = await extractAttachmentText(tinyPdf("A".repeat(49)), "pdf");
  assert.deepEqual(short, { status: "no_text", text: "", textChars: 0, error: "스캔본 추정" });
  assert.equal((await extractAttachmentText(tinyPdf("A".repeat(50)), "pdf")).status, "extracted");
});

test("ZIP 첨부는 최대 10개이며 하위 ZIP과 다른 확장자는 따라가지 않는다", async () => {
  const zip = new JSZip();
  for (let index = 0; index < 12; index++) zip.file(`folder/doc-${index}.pdf`, "document");
  zip.file("nested.zip", "archive");
  zip.file("other.txt", "text");
  const files = await expandZipAttachments(await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(files.length, MAX_ZIP_ATTACHMENTS);
  assert.ok(files.every((file) => file.fileName.startsWith("folder/") && file.fileExt === "pdf"));
});

test("ZIP 경로 이탈과 실제 해제 크기 초과를 거부한다", async () => {
  const unsafe = new JSZip();
  unsafe.file("../outside.pdf", "document");
  const unsafeBytes = await unsafe.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => expandZipAttachments(unsafeBytes), { name: "AttachmentLimitError", message: "안전하지 않은 ZIP 파일 경로" });
  const bomb = new JSZip();
  bomb.file("too-big.pdf", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
  const bombBytes = await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await assert.rejects(() => expandZipAttachments(bombBytes), AttachmentLimitError);
});

test("30MB 초과 파일과 미지원 형식은 skipped로 기록한다", async () => {
  assert.equal((await extractAttachmentText(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), "pdf")).status, "skipped");
  assert.equal((await extractAttachmentText(Buffer.from("anything"), "docx")).status, "skipped");
});
