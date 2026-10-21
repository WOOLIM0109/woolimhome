import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { createInterface } from "node:readline";

const ROW_KEYS = new Set(["name", "candidate", "unknown", "mismatch", "top_matches"]);
const MATCH_KEYS = new Set(["title", "verdict", "score", "deadline_at", "selected_for_reading", "reasons"]);
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasSecrets(value) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value)
    || /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}|sb_secret_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)
    || /(?:[?&]|\b)(?:authorization|auth|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|signature|session[_-]?key|key|토큰|비밀키)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/%=-]{8,}/i.test(value)
    || /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/%=-]{8,}/.test(value);
}
function containsSecrets(value) {
  if (typeof value === "string") return hasSecrets(value);
  if (Array.isArray(value)) return value.some(containsSecrets);
  return object(value) && Object.values(value).some(containsSecrets);
}
function text(value, maximum) { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function count(value) { return Number.isSafeInteger(value) && value >= 0; }
function validate(rows) {
  if (!Array.isArray(rows) || rows.length > 10_000) throw new Error();
  for (const row of rows) {
    if (!object(row) || Object.keys(row).some(key => !ROW_KEYS.has(key)) || !text(row.name, 300)
      || !count(row.candidate) || !count(row.unknown) || !count(row.mismatch)
      || !Array.isArray(row.top_matches) || row.top_matches.length > 5) throw new Error();
    for (const match of row.top_matches) {
      if (!object(match) || Object.keys(match).some(key => !MATCH_KEYS.has(key)) || !text(match.title, 2000)
        || !["candidate", "unknown"].includes(match.verdict)
        || typeof match.score !== "number" || !Number.isFinite(match.score) || match.score < 0 || match.score > Number.MAX_SAFE_INTEGER
        || typeof match.deadline_at !== "string" || !Number.isFinite(Date.parse(match.deadline_at))
        || typeof match.selected_for_reading !== "boolean" || !Array.isArray(match.reasons)
        || match.reasons.length > 100 || match.reasons.some(reason => !text(reason, 4000))) throw new Error();
    }
  }
  if (containsSecrets(rows)) throw new Error();
  return rows;
}
async function main() {
// Customer names and matches must stay out of this public repository's commits.
const base = resolve(".codex-tmp");
const output = resolve(process.argv[2] || ".codex-tmp/program-review/2026-10-21-customer-matches.md");
const within = relative(base, output);
if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error("Private output path required");
const line = await new Promise((accept, reject) => {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.once("line", (value) => { accept(value); input.close(); process.stdin.pause(); });
  input.once("close", () => reject(new Error("One JSON line required")));
});
if (Buffer.byteLength(line, "utf8") > 64 * 1024 * 1024) throw new Error();
const rows = validate(JSON.parse(line.replace(/^\uFEFF/, "")));
const clean = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/([\\`*_[\]{}()|])/g, "\\$1").replace(/[\r\n]/g, " ");
const lines = ["# 고객사별 공고 매칭 — 비공개 운영 자료", "", "2026-10-21 운영 관측. 최근 60일 수집분 중 마감일이 확인된 공고를 대상으로 한다.",
  "고객 정보가 부족한 판정은 `unknown`이다. 자동으로 지원 가능하다고 확정한 결과가 아니다. 고객별 상위 5건이며 정독 선정은 전체 고유 공고 8건으로 별도 제한한다.", ""];
let listed = 0;
for (const row of rows) {
  lines.push(`## ${clean(row.name)}`, "", `후보 ${Number(row.candidate) || 0}건 / 정보 부족 ${Number(row.unknown) || 0}건 / 불일치 ${Number(row.mismatch) || 0}건`, "");
  const matches = row.top_matches;
  if (!matches.length) { lines.push("매칭된 공고 없음", ""); continue; }
  lines.push("| 공고 | 판정 | 점수 | 마감 | 정독 선정 | 확인할 사항 |", "|---|---|---:|---|---|---|");
  for (const match of matches) {
    lines.push(`| ${clean(match.title)} | ${clean(match.verdict)} | ${Number(match.score) || 0} | ${clean(match.deadline_at)} | ${match.selected_for_reading ? "예" : "아니오"} | ${clean((match.reasons ?? []).join("; "))} |`);
    listed++;
  }
  lines.push("");
}
const rendered = lines.join("\n") + "\n";
if (hasSecrets(rendered)) throw new Error();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, rendered, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ customerCount: rows.length, listedMatches: listed, outputFile: output }));
}
await main().catch(() => {
  console.error("Private customer report failed; input was not logged.");
  process.exitCode = 1;
});
