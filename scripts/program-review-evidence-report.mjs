import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, relative, isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { buildRequirementInput, normalizeRequirements } from "../lib/program-review/requirements.ts";

const ROW_KEYS = new Set(["id", "title", "source_url", "requirements", "detail_text", "attachments"]);
const ATTACHMENT_KEYS = new Set(["id", "file_name", "text_content", "text_status"]);
const REQUIREMENT_KEYS = new Set(["regions", "target_types", "business_age", "size", "industries_included",
  "industries_excluded", "required_certifications", "bonus_points", "support_amount_text", "self_pay_text",
  "deadline_at", "submission_documents", "evaluation", "contact", "evidence"]);
const MAX_LINE_BYTES = 64 * 1024 * 1024;

function refuse(message) { throw new Error(message); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasSecrets(value) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value)
    || /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}|sb_secret_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)
    || /(?:[?&]|\b)(?:authorization|auth|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|signature|session[_-]?key|key|토큰|비밀키)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/%=-]{8,}/i.test(value)
    || /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/%=-]{8,}/.test(value);
}

function containsSecrets(value, key = "") {
  if (typeof value === "string") {
    return hasSecrets(value) || (/^(?:authorization|auth|api[_-]?key|(?:access|refresh)[_-]?token|token|secret|client[_-]?secret|password|signature)$/i.test(key) && /\S{8}/.test(value));
  }
  if (Array.isArray(value)) return value.some((item) => containsSecrets(item));
  return object(value) && Object.entries(value).some(([name, item]) => containsSecrets(item, name));
}

function publicUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) refuse("공개 원문 URL 형식 오류");
    url.username = "";
    url.password = "";
    // Public notice URLs can carry signed download parameters. Never retain any query or fragment.
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { refuse("공개 원문 URL 형식 오류"); }
}

function validateRows(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount) refuse("정해진 수의 서로 다른 공고 표본이 필요합니다.");
  const seen = new Set();
  return value.map((row) => {
    if (!object(row) || Object.keys(row).some((key) => !ROW_KEYS.has(key))
      || typeof row.id !== "string" || !row.id || seen.has(row.id)
      || typeof row.title !== "string" || typeof row.source_url !== "string"
      || typeof row.detail_text !== "string" || !object(row.requirements) || !Array.isArray(row.attachments)
      || Object.keys(row.requirements).some((key) => !REQUIREMENT_KEYS.has(key))) refuse("공고 표본 입력 형식 오류");
    seen.add(row.id);
    const ids = new Set();
    for (const attachment of row.attachments) {
      if (!object(attachment) || Object.keys(attachment).some((key) => !ATTACHMENT_KEYS.has(key))
        || typeof attachment.id !== "string" || !attachment.id || ids.has(attachment.id)
        || typeof attachment.file_name !== "string" || typeof attachment.text_status !== "string"
        || (attachment.text_content !== null && typeof attachment.text_content !== "string")) refuse("공고 첨부 입력 형식 오류");
      ids.add(attachment.id);
    }
    const safeRow = { ...row, source_url: publicUrl(row.source_url) };
    if (containsSecrets(safeRow)) refuse("원문 또는 요건에서 비밀값 패턴이 발견되어 보고서 생성을 거부했습니다.");
    return safeRow;
  });
}

function leaves(value, prefix = "", output = new Map()) {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (!prefix && key === "evidence") continue;
      leaves(child, prefix ? `${prefix}.${key}` : key, output);
    }
  } else output.set(prefix, value);
  return output;
}

function escaped(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]{}()|])/g, "\\$1").replace(/\r?\n/g, "<br>");
}
function fence(value, language = "text") {
  const text = String(value);
  const width = Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const marker = "`".repeat(width);
  return `${marker}${language}\n${text}\n${marker}`;
}

function proof(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\[source:([A-Za-z0-9_.:/-]{1,160}) ((?:p|para)\.[1-9]\d*)\][ \t]+([\s\S]+)$/);
  return match ? { sourceId: match[1], locator: match[2], quote: match[3].trim() } : null;
}
function locatorBlock(text, locator) {
  const markers = [...text.matchAll(/^\[((?:p|para)\.[1-9]\d*)\][ \t]*/gm)];
  const indexes = markers.map((marker, index) => marker[1] === locator ? index : -1).filter((index) => index >= 0);
  if (indexes.length !== 1) return null;
  const index = indexes[0];
  return text.slice(markers[index].index, markers[index + 1]?.index ?? text.length).trimEnd();
}

function examine(row) {
  const input = buildRequirementInput([
    { id: "0:detail", text: row.detail_text },
    ...row.attachments.filter((attachment) => attachment.text_status === "extracted" && attachment.text_content?.trim())
      .map((attachment) => ({ id: `1:attachment:${attachment.id}`, text: attachment.text_content })),
  ]);
  const normalized = normalizeRequirements(row.requirements, input);
  const originalLeaves = leaves(row.requirements), checkedLeaves = leaves(normalized);
  const paths = [...new Set([...originalLeaves.keys(), ...checkedLeaves.keys()])].sort();
  const rows = [], contexts = new Map();
  let mismatches = 0, verified = 0;
  for (const path of paths) {
    const original = originalLeaves.get(path);
    if (original === undefined && checkedLeaves.get(path) === null) continue;
    const checked = checkedLeaves.get(path);
    const originalProof = row.requirements.evidence?.[path];
    const acceptedProof = normalized.evidence?.[path];
    const parsed = proof(acceptedProof ?? originalProof);
    const accepted = original === null || (JSON.stringify(original) === JSON.stringify(checked) && Boolean(acceptedProof));
    if (!accepted) mismatches++;
    if (accepted && original !== null) verified++;
    const source = input.sources.find((item) => item.id === parsed?.sourceId);
    const file = parsed?.sourceId === "0:detail" ? "상세 본문"
      : row.attachments.find((attachment) => `1:attachment:${attachment.id}` === parsed?.sourceId)?.file_name ?? "확인되지 않은 출처";
    const block = parsed && source ? locatorBlock(source.text, parsed.locator) : null;
    if (parsed && block !== null) contexts.set(`${parsed.sourceId} ${parsed.locator}`, { file, block });
    rows.push(`| ${escaped(path)} | ${escaped(JSON.stringify(original) ?? "없음")} | ${original === null ? "null: 근거 없음" : accepted ? "일치" : "불일치"} | ${parsed ? escaped(`${file} / ${parsed.sourceId} / ${parsed.locator}`) : "없음"} | ${parsed ? escaped(parsed.quote) : "없음"} |`);
  }
  for (const [path, value] of Object.entries(row.requirements.evidence ?? {})) {
    if (!originalLeaves.has(path)) {
      mismatches++;
      rows.push(`| ${escaped(`evidence.${path}`)} | 사용되지 않은 근거 | 불일치 | — | ${escaped(value)} |`);
    }
  }
  return { row, input, normalized, rows, contexts, mismatches, verified };
}

function render(reports) {
  const lines = ["# 공고 요건 JSON·원문 근거 대조", "", `생성 시각: ${new Date().toISOString()}`, "",
    `운영에서 전달받은 서로 다른 ${reports.length}건을 입력 순서 그대로 대조했다. 표본을 재선정하거나 일부를 제외하지 않았다. 공개 공고 본문·첨부와 요건만 수록하며 고객 프로필·매칭 고객 정보는 입력받지 않는다.`, "",
    "기계 대조는 실제 requirements.ts의 6만 자 입력 구성과 근거 검증을 다시 실행한 결과다. 일치는 의미 해석에 대한 사람 검토를 대체하지 않으며 추출 성공률을 뜻하지 않는다. 원문 URL의 사용자정보·모든 쿼리·프래그먼트는 제거했다.", "",
    "| 표본 | 공고 ID | 제목 | 근거가 검증된 비null 값 | 불일치 | 입력 절단 |", "| --- | --- | --- | ---: | ---: | --- |"];
  reports.forEach((report, index) => lines.push(`| ${index + 1} | ${escaped(report.row.id)} | ${escaped(report.row.title)} | ${report.verified} | ${report.mismatches} | ${report.input.truncated ? "있음" : "없음"} |`));
  for (const [index, report] of reports.entries()) {
    const { row, input } = report;
    lines.push("", `## ${index + 1}. ${escaped(row.title)}`, "", `공고 ID: ${escaped(row.id)}`, "", `공개 원문: <${row.source_url}>`, "",
      `입력 해시: ${input.inputHash}. 검증 입력 ${input.text.length}자, 출처 ${input.sources.length}개, 6만 자 절단 ${input.truncated ? "있음" : "없음"}.`, "",
      "### 운영 저장 JSON 전체", "", fence(JSON.stringify(row.requirements, null, 2), "json"), "",
      "### 값별 정확 인용 대조", "", "| 항목 | 운영 저장 값 | 재검증 | 실제 파일·출처·쪽/문단 | 정확한 인용 |", "| --- | --- | --- | --- | --- |", ...report.rows, "",
      "### 실제 입력의 해당 쪽·문단 원문", "");
    if (!report.contexts.size) lines.push("대조 가능한 유효 근거 구간이 없다.", "");
    for (const [location, context] of report.contexts) lines.push(`출처: ${escaped(context.file)} / ${escaped(location)}`, "", fence(context.block), "");
    if (report.mismatches) lines.push("### 재검증 후 JSON", "", fence(JSON.stringify(report.normalized, null, 2), "json"), "");
  }
  return lines.join("\n") + "\n";
}

async function main(line) {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--output", "--count"].includes(args[index]) || !args[index + 1] || options.has(args[index])) {
      refuse("보고서 실행 옵션 형식 오류");
    }
    options.set(args[index], args[index + 1]);
  }
  const outputPath = options.get("--output");
  const expectedCount = Number(options.get("--count") ?? "5");
  if (!outputPath || extname(outputPath).toLowerCase() !== ".md" || ![5, 10].includes(expectedCount)) {
    refuse("사용법: node scripts/program-review-evidence-report.mjs --output <보고서.md> [--count 10]");
  }
  const outputFile = resolve(outputPath);
  const within = relative(resolve(".codex-tmp"), outputFile);
  if (!within || within.startsWith("..") || isAbsolute(within)) refuse("비공개 임시 경로가 필요합니다.");
  if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) refuse("보고서 입력 크기 제한 초과");
  let parsed;
  try { parsed = JSON.parse(line.replace(/^\uFEFF/, "")); } catch { refuse("보고서 입력 JSON 형식 오류"); }
  const reports = validateRows(parsed, expectedCount).map(examine);
  const output = render(reports);
  if (hasSecrets(output)) refuse("보고서에서 비밀값 패턴이 발견되어 생성을 거부했습니다.");
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, output, { encoding: "utf8" });
  return { successCount: reports.filter((report) => report.mismatches === 0).length,
    outputFile, mismatchCount: reports.reduce((sum, report) => sum + report.mismatches, 0) };
}

let received = false;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.once("line", (line) => {
  received = true;
  input.close();
  process.stdin.pause();
  main(line).then((summary) => {
    process.stdout.write(JSON.stringify(summary) + "\n", () => process.exit(0));
  }).catch(() => {
    // No input values, source IDs, URLs, raw keys, or parser/provider diagnostics escape on failure.
    process.stderr.write("공고 근거 보고서 생성을 거부했습니다. 입력 개수·형식·비밀값 패턴을 확인하세요.\n", () => process.exit(1));
  });
});
input.once("close", () => {
  if (!received) process.stderr.write("공고 근거 보고서 입력 한 줄이 필요합니다.\n", () => process.exit(1));
});
