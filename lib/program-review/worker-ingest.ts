/**
 * 대표 PC 수집기(`gonggo-monitor`)가 올린 공고를 받습니다.
 *
 * ## 왜 PC 에서 올리나
 * HWP 공고문의 **표를 살리려면** LibreOffice + H2Orestart 가 필요합니다. 그 둘은
 * 서버리스 환경에 설치할 수 없어서, 이 저장소의 HWP 추출은 문단만 읽습니다
 * (`extract-text.ts`, 태그 67). 지원 금액은 거의 표에 있으므로 그 글자가 뭉개집니다.
 * 포트폴리오 목업이 PC 폰트 때문에 `/api/worker/*` 로 올라오는 것과 같은 이유입니다.
 *
 * ## 기존 흐름을 건드리지 않습니다
 * - `draft_for` 를 비워 둡니다 → 아침 오픈챗 발행 큐에 끼어들지 않습니다.
 *   공고 검토 화면의 검색으로 보입니다.
 * - 이미 있는 `fingerprint` 는 **건드리지 않습니다** (`ignoreDuplicates`).
 *   서버가 모은 행을 PC 가 덮어쓰지 않습니다.
 * - 요건은 이 저장소의 `buildRequirementInput`·`normalizeRequirements` 로 통과시킵니다.
 *   입력 해시가 서버 계산과 같아야 `requirements-runner` 가 **다시 추출하지 않습니다**
 *   (Gemini 호출 0회). 그래서 해시를 PC 가 아니라 여기서 계산합니다.
 * - `normalization_version` 을 올리지 않습니다. 올리면 기존 56건이 전부 재추출됩니다.
 *
 * ## 아직 안 하는 것
 * 원본 파일은 올리지 않습니다 (`storage_path` 는 비웁니다). 화면의 '원본 받기' 는
 * 꺼진 상태로 보이고, 원문 주소로 사람이 받습니다.
 * 수집기가 뽑은 중복·명의 제한 등 이 저장소 요건 모양에 자리가 없는 축은
 * `raw_payload.collector_conditions` 에 그대로 담아 둡니다 — 잃지 않고, 다음 단계에서
 * 요건 모양을 넓힐 때 옮깁니다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { programFingerprint } from "../openchat/utils.ts";
import {
  REQUIREMENTS_NORMALIZATION_VERSION,
  buildRequirementInput,
  normalizeRequirements,
  sourceBlocks,
  type RequirementSource,
} from "./requirements.ts";

/** 한 번에 받을 공고 수. 서버 실행 시간 안에 끝나야 합니다. */
export const MAX_PROGRAMS = 30;
/** 공고 1건에 붙일 첨부 수. */
export const MAX_ATTACHMENTS = 20;
/** 첨부 1건의 글자 수. `extract-text.ts` 의 상한과 같습니다. */
export const MAX_TEXT_CHARS = 2_000_000;
/** 요청 전체 글자 수. 본문·첨부를 다 합친 값입니다. */
export const MAX_TOTAL_CHARS = 4_000_000;
/** 수집기가 이 버전 이상이어야 받습니다. 모양이 바뀌면 올립니다. */
export const MIN_COLLECTOR_VERSION = "1.0.0";
/** 이 값으로 올라온 행임을 남깁니다. 되돌릴 때 이것으로 고릅니다. */
export const COLLECTOR_TAG = "gonggo-monitor";

const TEXT_STATUSES = new Set(["extracted", "no_text", "failed", "skipped"]);
const FILE_EXTS = new Set(["hwp", "hwpx", "pdf", "zip", "docx", "doc", "xlsx", "xls",
  "pptx", "ppt", "txt", "csv", "jpg", "jpeg", "png", "gif", "rtf", "odt"]);
const SHA256 = /^[0-9a-f]{64}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// PostgreSQL text 는 U+0000 을 받지 않습니다.
const NULL_CHAR = /\u0000/g;
// `requirements.ts` 의 `proof` 가 받는 근거 모양입니다.
const SHAPED_EVIDENCE = /^\[source:[^\]\r\n]+ (?:p|para)\.\d+\]/;

export class IngestError extends Error {
  // 생성자 매개변수 속성(`readonly status: number`)은 Node 의 타입 제거 모드가
  // 읽지 못합니다. 테스트가 이 파일을 그대로 가져오므로 칸을 따로 적습니다.
  status: number;
  code: string;
  detail?: string;

  constructor(status: number, code: string, detail?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type Row = Record<string, unknown>;

/**
 * 데이터베이스가 돌려준 사유를 짧게 담습니다.
 *
 * 사유 없이 `PROGRAM_WRITE_FAILED` 만 돌려주면 **운영에서 아무도 못 고칩니다.**
 * 값은 담지 않고 사유 글자만 자릅니다.
 */
function reason(error: { message?: string; code?: string; details?: string } | null) {
  if (!error) return undefined;
  const parts = [error.code, error.message, error.details].filter(Boolean);
  const text = parts.join(" · ").slice(0, 200);
  return text || undefined;
}

export type IngestAttachment = {
  file_name: string;
  file_ext: string;
  source_url: string;
  sha256: string;
  byte_size: number | null;
  text_status: string;
  text: string;
  error: string | null;
};

export type IngestProgram = {
  source_key: string;
  external_id: string | null;
  fingerprint: string;
  title: string;
  source_url: string;
  starts_at: string | null;
  deadline_at: string | null;
  regions: string[];
  application_period_text: string | null;
  applicant_summary: string | null;
  support_summary: string | null;
  application_method: string | null;
  detail_text: string;
  attachments: IngestAttachment[];
  requirements: Row | null;
  collector_conditions: Row | null;
};

export type IngestPayload = {
  collectorVersion: string;
  programs: IngestProgram[];
};

function object(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function strictKeys(row: Row, allowed: readonly string[], where: string) {
  for (const key of Object.keys(row)) {
    if (!allowed.includes(key)) throw new IngestError(400, "UNKNOWN_FIELD", `${where}.${key}`);
  }
}

function text(row: Row, key: string, where: string, max: number, required = false) {
  const value = row[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new IngestError(400, "MISSING_FIELD", `${where}.${key}`);
    return null;
  }
  if (typeof value !== "string") throw new IngestError(400, "INVALID_FIELD", `${where}.${key}`);
  // PostgreSQL text 는 U+0000 을 받지 않습니다.
  const cleaned = value.replace(/\u0000/g, "").trim();
  if (!cleaned) {
    if (required) throw new IngestError(400, "MISSING_FIELD", `${where}.${key}`);
    return null;
  }
  if (cleaned.length > max) throw new IngestError(400, "FIELD_TOO_LONG", `${where}.${key}`);
  return cleaned;
}

function httpUrl(row: Row, key: string, where: string, required = false) {
  const value = text(row, key, where, 2000, required);
  if (value === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new IngestError(400, "INVALID_URL", `${where}.${key}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new IngestError(400, "INVALID_URL", `${where}.${key}`);
  }
  return parsed.toString();
}

/** 날짜는 'YYYY-MM-DD' 또는 완전한 ISO 시각만 받습니다. */
function instant(row: Row, key: string, where: string) {
  const value = text(row, key, where, 40);
  if (value === null) return null;
  if (DATE_ONLY.test(value)) {
    const parsed = Date.parse(`${value}T00:00:00+09:00`);
    if (!Number.isFinite(parsed)) throw new IngestError(400, "INVALID_DATE", `${where}.${key}`);
    return new Date(parsed).toISOString();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new IngestError(400, "INVALID_DATE", `${where}.${key}`);
  }
  return new Date(parsed).toISOString();
}

function stringList(row: Row, key: string, where: string, max: number) {
  const value = row[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new IngestError(400, "INVALID_FIELD", `${where}.${key}`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") throw new IngestError(400, "INVALID_FIELD", `${where}.${key}.${index}`);
    const cleaned = item.replace(/\u0000/g, "").trim();
    if (!cleaned || cleaned.length > 120) throw new IngestError(400, "INVALID_FIELD", `${where}.${key}.${index}`);
    return cleaned;
  });
}

function version(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1, 4).map(Number) as [number, number, number] : null;
}

function versionAtLeast(value: unknown, minimum: string) {
  const current = version(value);
  const required = version(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > required[index]) return true;
    if (current[index] < required[index]) return false;
  }
  return true;
}

const ATTACHMENT_KEYS = ["file_name", "file_ext", "source_url", "sha256", "byte_size",
  "text_status", "text", "error"] as const;

function parseAttachment(value: unknown, where: string): IngestAttachment {
  const row = object(value);
  if (!row) throw new IngestError(400, "INVALID_FIELD", where);
  strictKeys(row, ATTACHMENT_KEYS, where);

  const fileExt = (text(row, "file_ext", where, 8, true) as string).toLowerCase();
  if (!FILE_EXTS.has(fileExt)) throw new IngestError(400, "UNSUPPORTED_EXT", `${where}.file_ext`);

  const sha256 = (text(row, "sha256", where, 64, true) as string).toLowerCase();
  if (!SHA256.test(sha256)) throw new IngestError(400, "INVALID_FIELD", `${where}.sha256`);

  const textStatus = text(row, "text_status", where, 20, true) as string;
  if (!TEXT_STATUSES.has(textStatus)) throw new IngestError(400, "INVALID_FIELD", `${where}.text_status`);

  const size = row.byte_size;
  if (size !== undefined && size !== null
    && (!Number.isSafeInteger(size) || Number(size) < 0)) {
    throw new IngestError(400, "INVALID_FIELD", `${where}.byte_size`);
  }

  const body = text(row, "text", where, MAX_TEXT_CHARS) ?? "";
  if (textStatus === "extracted" && !body) {
    throw new IngestError(400, "MISSING_FIELD", `${where}.text`);
  }

  return {
    file_name: text(row, "file_name", where, 300, true) as string,
    file_ext: fileExt,
    source_url: httpUrl(row, "source_url", where, true) as string,
    sha256,
    byte_size: size === undefined || size === null ? null : Number(size),
    text_status: textStatus,
    text: body,
    error: text(row, "error", where, 500),
  };
}

const PROGRAM_KEYS = ["source_key", "external_id", "fingerprint", "title", "source_url",
  "starts_at", "deadline_at", "regions", "application_period_text", "applicant_summary",
  "support_summary", "application_method", "detail_text", "attachments", "requirements",
  "collector_conditions"] as const;

function parseProgram(value: unknown, index: number): IngestProgram {
  const where = `programs.${index}`;
  const row = object(value);
  if (!row) throw new IngestError(400, "INVALID_FIELD", where);
  strictKeys(row, PROGRAM_KEYS, where);

  const title = text(row, "title", where, 300, true) as string;
  const sourceUrl = httpUrl(row, "source_url", where, true) as string;
  const externalId = text(row, "external_id", where, 200);
  const supplied = text(row, "fingerprint", where, 64);
  if (supplied !== null && !SHA256.test(supplied.toLowerCase())) {
    throw new IngestError(400, "INVALID_FIELD", `${where}.fingerprint`);
  }

  const attachmentsValue = row.attachments;
  if (attachmentsValue !== undefined && attachmentsValue !== null && !Array.isArray(attachmentsValue)) {
    throw new IngestError(400, "INVALID_FIELD", `${where}.attachments`);
  }
  const attachmentRows = (attachmentsValue ?? []) as unknown[];
  if (attachmentRows.length > MAX_ATTACHMENTS) {
    throw new IngestError(400, "TOO_MANY_ATTACHMENTS", where);
  }
  const attachments = attachmentRows.map((item, position) =>
    parseAttachment(item, `${where}.attachments.${position}`));
  const seen = new Set<string>();
  for (const attachment of attachments) {
    if (seen.has(attachment.sha256)) {
      throw new IngestError(400, "DUPLICATE_ATTACHMENT", `${where}.attachments`);
    }
    seen.add(attachment.sha256);
  }

  const requirements = row.requirements === undefined || row.requirements === null
    ? null : object(row.requirements);
  if (row.requirements !== undefined && row.requirements !== null && !requirements) {
    throw new IngestError(400, "INVALID_FIELD", `${where}.requirements`);
  }
  const conditions = row.collector_conditions === undefined || row.collector_conditions === null
    ? null : object(row.collector_conditions);
  if (row.collector_conditions !== undefined && row.collector_conditions !== null && !conditions) {
    throw new IngestError(400, "INVALID_FIELD", `${where}.collector_conditions`);
  }

  return {
    source_key: text(row, "source_key", where, 60, true) as string,
    external_id: externalId,
    fingerprint: (supplied ?? programFingerprint(title, sourceUrl, externalId)).toLowerCase(),
    title,
    source_url: sourceUrl,
    starts_at: instant(row, "starts_at", where),
    deadline_at: instant(row, "deadline_at", where),
    regions: stringList(row, "regions", where, 40),
    application_period_text: text(row, "application_period_text", where, 500),
    applicant_summary: text(row, "applicant_summary", where, 4000),
    support_summary: text(row, "support_summary", where, 4000),
    application_method: text(row, "application_method", where, 1000),
    detail_text: text(row, "detail_text", where, MAX_TEXT_CHARS) ?? "",
    attachments,
    requirements,
    collector_conditions: conditions,
  };
}

const BODY_KEYS = ["workerId", "workerName", "collectorVersion", "programs"] as const;

/** 올라온 본문을 검사해 모양을 고정합니다. 틀린 곳이 있으면 어디가 틀렸는지 알려 줍니다. */
export function parseIngestBody(value: unknown): IngestPayload {
  const row = object(value);
  if (!row) throw new IngestError(400, "INVALID_BODY");
  strictKeys(row, BODY_KEYS, "body");

  const collectorVersion = text(row, "collectorVersion", "body", 20, true) as string;
  if (!versionAtLeast(collectorVersion, MIN_COLLECTOR_VERSION)) {
    throw new IngestError(409, "COLLECTOR_UPGRADE_REQUIRED", MIN_COLLECTOR_VERSION);
  }

  if (!Array.isArray(row.programs) || !row.programs.length) {
    throw new IngestError(400, "MISSING_FIELD", "body.programs");
  }
  if (row.programs.length > MAX_PROGRAMS) throw new IngestError(400, "TOO_MANY_PROGRAMS");

  const programs = row.programs.map(parseProgram);
  const fingerprints = new Set<string>();
  let total = 0;
  for (const program of programs) {
    if (fingerprints.has(program.fingerprint)) {
      throw new IngestError(400, "DUPLICATE_PROGRAM", program.fingerprint.slice(0, 12));
    }
    fingerprints.add(program.fingerprint);
    total += program.detail_text.length;
    for (const attachment of program.attachments) total += attachment.text.length;
  }
  if (total > MAX_TOTAL_CHARS) throw new IngestError(413, "PAYLOAD_TOO_LARGE");

  return { collectorVersion, programs };
}

/**
 * 올라온 근거 문장에 `[source:<id> <쪽표시>]` 를 붙입니다.
 *
 * ★ **이걸 안 하면 모든 값이 무시됩니다.** 매칭은 근거가
 * `[source:1:attachment:<id> p.3] 지원대상...` 모양이고, 그 인용이 **그 쪽 표시 안에
 * 실제로 있을 때만** 값을 씁니다 (`requirements.ts` 의 `proof`).
 *
 * 첨부 id 는 서버가 저장할 때 만드는 값이라 수집기가 알 수 없습니다. 그래서 수집기는
 * **원문 문장만** 보내고, 어느 출처의 어느 쪽인지는 여기서 찾아 붙입니다.
 * 못 찾은 근거는 **버립니다** — 없는 곳을 가리키는 근거를 만들어 내지 않습니다.
 *
 * ★ 공백·줄바꿈 차이는 넘어갑니다. 공고문은 문장 중간에 줄이 바뀌는데 올라온 인용은
 * 그걸 한 줄로 합쳐 옵니다. 실측으로 근거 55개 중 28개가 그 차이 때문에 버려졌습니다.
 * 그래서 공백을 눌러 맞춰 보고, 맞으면 **원문에 있는 글자 그대로** 를 인용으로 씁니다
 * (모델이 쓴 글자가 아니라 원문 조각이라, `proof` 의 글자 그대로 검사를 통과합니다).
 */
const WHITESPACE = /\s+/g;
// 값이 인용 안에 그대로 있어야 받아들여지는 글자 칸들.
const TEXT_PATHS = new Set(["support_amount_text", "self_pay_text", "contact"]);

function squeeze(value: string) {
  return value.replace(WHITESPACE, " ").trim();
}

/**
 * 공백을 눌렀을 때 `quote` 와 같아지는 **원문 조각**을 돌려줍니다. 없으면 빈 문자열.
 *
 * 눌린 글자에서 자리를 찾고, 원문을 한 글자씩 세어 그 자리를 되짚습니다.
 */
function exactSpan(block: string, quote: string) {
  const needle = squeeze(quote);
  if (!needle) return "";
  if (block.includes(quote)) return quote;        // 흔한 경우를 먼저
  const squeezed = squeeze(block);
  const at = squeezed.indexOf(needle);
  if (at < 0) return "";

  // 눌린 자리 → 원문 자리
  let seen = 0;
  let start = -1;
  let previousWasSpace = true;
  for (let index = 0; index < block.length; index += 1) {
    const isSpace = /\s/.test(block[index]);
    if (isSpace && previousWasSpace) continue;    // 눌리면 사라지는 공백
    if (seen === at && start < 0) start = index;
    if (seen === at + needle.length) {
      return block.slice(start, index).trim();
    }
    seen += 1;
    previousWasSpace = isSpace;
  }
  return start >= 0 ? block.slice(start).trim() : "";
}

function attachEvidence(
  requirements: Row,
  sources: readonly RequirementSource[],
): Row {
  const raw = requirements.evidence;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return requirements;
  const blocks = sourceBlocks(sources);
  const located: Record<string, string> = {};
  const adjusted: Row = {};

  for (const [path, value] of Object.entries(raw as Row)) {
    if (typeof value !== "string") continue;
    const quote = value.replace(NULL_CHAR, "").trim();
    if (!quote) continue;
    // 이미 모양을 갖춘 근거는 그대로 둡니다.
    if (SHAPED_EVIDENCE.test(quote)) {
      located[path] = quote;
      continue;
    }
    let found = "";
    let span = "";
    for (const [id, entries] of blocks) {
      for (const [locator, text] of entries) {
        if (!text) continue;
        span = exactSpan(text, quote);
        if (!span) continue;
        found = `[source:${id} ${locator}] ${span}`;
        break;
      }
      if (found) break;
    }
    if (!found) continue;
    located[path] = found;

    // 글자 칸은 값이 인용 안에 그대로 있어야 받아들여집니다. 올라온 값은 모델이
    // 쓴 글자라 공백이 다를 수 있으니 **원문 조각으로 맞춥니다.**
    // (실측: '원문 표현대로' 적는 칸이 이 차이 하나로 전부 버려졌습니다.)
    if (TEXT_PATHS.has(path)) {
      const current = requirements[path];
      if (typeof current === "string" && !span.includes(current)) {
        adjusted[path] = span;
      }
    }
  }
  return {
    ...requirements, ...adjusted,
    evidence: Object.keys(located).length ? located : null,
  };
}

/** 요건 입력은 서버가 만듭니다 — 해시가 서버 계산과 같아야 재추출을 피합니다. */
function requirementSources(program: IngestProgram, attachmentIds: Map<string, string>) {
  const sources: RequirementSource[] = [{ id: "0:detail", text: program.detail_text }];
  for (const attachment of program.attachments) {
    if (attachment.text_status !== "extracted" || !attachment.text.trim()) continue;
    const id = attachmentIds.get(attachment.sha256);
    if (!id) continue;
    sources.push({ id: `1:attachment:${id}`, text: attachment.text });
  }
  return sources;
}

export type IngestDependencies = {
  // 쓰는 것은 `from` 하나뿐입니다. 테스트는 같은 모양의 가짜를 넣습니다.
  admin: Pick<SupabaseClient, "from">;
  now?: () => Date;
};

export type IngestResult = {
  received: number;
  inserted: number;
  /** 우리가 전에 넣었는데 첨부·요건이 빠져 있던 것을 이어서 채운 수 */
  resumed: number;
  skipped_existing: number;
  attachments: number;
  requirements: number;
};

/**
 * 받은 공고를 넣습니다.
 *
 * 이미 있는 `fingerprint` 는 건너뜁니다 — 서버가 모은 행을 PC 가 덮지 않습니다.
 * 그래서 같은 요청을 두 번 보내도 결과가 같습니다.
 */
export async function ingestPrograms(
  payload: IngestPayload,
  { admin, now = () => new Date() }: IngestDependencies,
): Promise<IngestResult> {
  const stamp = now().toISOString();
  const result: IngestResult = {
    received: payload.programs.length, inserted: 0, resumed: 0,
    skipped_existing: 0, attachments: 0, requirements: 0,
  };

  const sourceKeys = [...new Set(payload.programs.map((program) => program.source_key))];
  const { data: sourceRows, error: sourceError } = await admin.from("openchat_sources")
    .select("id,source_key").in("source_key", sourceKeys);
  if (sourceError) throw new IngestError(500, "SOURCE_LOOKUP_FAILED", reason(sourceError));
  const sourceIds = new Map((sourceRows ?? []).map((row: Row) =>
    [String(row.source_key), String(row.id)]));

  const rows = payload.programs.map((program) => ({
    source_id: sourceIds.get(program.source_key) ?? null,
    external_id: program.external_id,
    fingerprint: program.fingerprint,
    title: program.title,
    // ★ 이 네 칸은 비어 있으면 안 됩니다 (NOT NULL).
    // 없으면 빈 글자로 넣습니다 — 없다고 저장 자체가 실패하면 안 됩니다.
    applicant_summary: program.applicant_summary ?? "",
    support_summary: program.support_summary ?? "",
    application_method: program.application_method ?? "",
    application_period_text: program.application_period_text ?? "",
    source_url: program.source_url,
    starts_at: program.starts_at,
    deadline_at: program.deadline_at,
    regions: program.regions,
    categories: [],
    status: "review_required",
    priority: 0,
    // 비워 둡니다 — 아침 오픈챗 발행 큐에 끼어들지 않습니다.
    draft_for: null,
    exclusion_reason: null,
    raw_payload: {
      collector: COLLECTOR_TAG,
      collector_version: payload.collectorVersion,
      source_key: program.source_key,
      collected_at: stamp,
      // 이 저장소 요건 모양에 자리가 없는 축을 잃지 않고 담아 둡니다.
      collector_conditions: program.collector_conditions,
    },
    updated_at: stamp,
  }));

  const { data: inserted, error: insertError } = await admin.from("openchat_programs")
    .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
    .select("id,fingerprint");
  if (insertError) throw new IngestError(500, "PROGRAM_WRITE_FAILED", reason(insertError));

  const idByFingerprint = new Map((inserted ?? []).map((row: Row) =>
    [String(row.fingerprint), String(row.id)]));
  result.inserted = idByFingerprint.size;

  // ★ 반쪽 저장을 되살립니다.
  // 공고만 들어가고 첨부에서 실패하면, 다시 보낼 때 '이미 있음' 으로 건너뛰어
  // 첨부가 영영 안 붙습니다. 그래서 **우리가 넣은 행**이면 이어서 채웁니다.
  // 서버가 모은 행(collector 표시가 없는 행)은 건드리지 않습니다.
  const missing = payload.programs
    .map((program) => program.fingerprint)
    .filter((fingerprint) => !idByFingerprint.has(fingerprint));
  if (missing.length) {
    const { data: existing, error: lookupError } = await admin.from("openchat_programs")
      .select("id,fingerprint,raw_payload").in("fingerprint", missing);
    if (lookupError) throw new IngestError(500, "PROGRAM_LOOKUP_FAILED", reason(lookupError));
    for (const row of existing ?? []) {
      const payloadRow = (row as Row).raw_payload;
      const owner = payloadRow && typeof payloadRow === "object"
        ? (payloadRow as Row).collector : null;
      if (owner !== COLLECTOR_TAG) continue;      // 우리 것이 아니면 건드리지 않습니다
      idByFingerprint.set(String((row as Row).fingerprint), String((row as Row).id));
      result.resumed += 1;
    }
  }
  result.skipped_existing = result.received - result.inserted - result.resumed;

  for (const program of payload.programs) {
    const programId = idByFingerprint.get(program.fingerprint);
    if (!programId) continue;   // 이미 있던 공고 — 아무것도 건드리지 않습니다

    const attachmentIds = new Map<string, string>();
    if (program.attachments.length) {
      const { data: savedAttachments, error: attachmentError } = await admin
        .from("openchat_program_attachments")
        .upsert(program.attachments.map((attachment) => ({
          program_id: programId,
          file_name: attachment.file_name,
          file_ext: attachment.file_ext,
          source_url: attachment.source_url,
          // 원본 파일은 올리지 않습니다. 화면의 '원본 받기' 는 꺼진 채 보입니다.
          storage_path: null,
          byte_size: attachment.byte_size,
          sha256: attachment.sha256,
          text_status: attachment.text_status,
          text_content: attachment.text || null,
          text_chars: attachment.text.length,
          error: attachment.error,
          extracted_at: attachment.text_status === "extracted" ? stamp : null,
        })), { onConflict: "program_id,source_url" })
        .select("id,sha256");
      if (attachmentError) {
        throw new IngestError(500, "ATTACHMENT_WRITE_FAILED", reason(attachmentError));
      }
      for (const row of savedAttachments ?? []) {
        attachmentIds.set(String((row as Row).sha256), String((row as Row).id));
      }
      result.attachments += attachmentIds.size;
    }

    if (!program.requirements) continue;
    const input = buildRequirementInput(requirementSources(program, attachmentIds));
    const requirements = normalizeRequirements(
      attachEvidence(program.requirements, input.sources), input);
    const { error: requirementError } = await admin.from("openchat_program_requirements")
      .upsert({
        program_id: programId,
        status: "extracted",
        requirements,
        // 올리지 않습니다. 올리면 기존 행이 전부 재추출됩니다.
        normalization_version: REQUIREMENTS_NORMALIZATION_VERSION,
        input_hash: input.inputHash,
        input_truncated: input.truncated,
        source_complete: program.attachments.every((attachment) =>
          attachment.text_status === "extracted"),
        source_manifest: input.sources.map((source) => ({ id: source.id, chars: source.text.length })),
        source_checked_at: stamp,
        updated_at: stamp,
      }, { onConflict: "program_id" });
    if (requirementError) {
      throw new IngestError(500, "REQUIREMENT_WRITE_FAILED", reason(requirementError));
    }
    result.requirements += 1;
  }

  return result;
}
