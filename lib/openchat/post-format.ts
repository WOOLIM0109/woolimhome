import { CONSULTATION_FOOTER } from "./config.ts";
import type { OpenchatContentDraft, OpenchatProgram } from "./types";

/**
 * 오전 공고 게시문 만들기
 *
 * 예전에는 원문을 그대로 옮겨 붙였습니다.
 * ◾ 기호와 구분선, "※ 자세한 내용 공고문 참조" 같은 안내가 겹겹이 붙어
 * 한 건을 읽는 데도 화면을 여러 번 넘겨야 했습니다.
 *
 * 지금은 한 건을 다섯 줄 안쪽으로 줄입니다.
 *   제목 / 대상 / 지원 / 접수(이메일일 때만) / 마감 / 링크
 * 온라인 접수는 링크를 누르면 되므로 따로 적지 않습니다.
 */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&nbsp;": " ",
};

/** 원문에 남은 HTML 기호를 사람이 읽는 글자로 되돌립니다. */
export function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/** 제목에서 대괄호와 낫표를 걷어냅니다. 목록에서는 군더더기입니다. */
export function cleanProgramTitle(value: string) {
  return decodeEntities(value)
    .replace(/[「」『』]/g, "")
    .replace(/^\s*[[【(]\s*/, "")
    .replace(/\s*[\]】)]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 요약 한 줄. 원문 기호와 각주를 걷어내고 길면 자릅니다. */
export function compactSummary(value: string | null | undefined, limit = 120) {
  if (!value) return "";
  const text = decodeEntities(value)
    // 각주와 안내 문구는 게시문에서 뺍니다.
    .replace(/[※*]{1,2}\s*자세한[^\n]*/g, " ")
    .replace(/^\s*[-•]\s*/gm, " ")
    .replace(/[ㅇ○◦]\s*/g, " ")
    .replace(/\s*\*+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(","));
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trim()}…`;
}

/** 접수 이메일. 온라인 접수는 링크로 갈음하므로 이메일만 남깁니다. */
export function applicationEmail(value: string | null | undefined) {
  if (!value) return "";
  return decodeEntities(value).match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || "";
}

/** 마감 표기. 8/26 처럼 짧게 쓰고, 시각이 있을 때만 시분을 붙입니다. */
export function formatDeadline(value?: string | null) {
  if (!value) return "공고문 참조";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "공고문 참조";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false,
  }).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const day = `${valueOf("month")}/${valueOf("day")}`;
  const hour = valueOf("hour");
  const minute = valueOf("minute");
  return hour === "00" && minute === "00" ? day : `${day} ${hour}:${minute}`;
}

function appendConsultationFooter(content: string) {
  const trimmed = content.trim();
  if (trimmed.includes(CONSULTATION_FOOTER)) return trimmed;
  return `${trimmed}\n\n${CONSULTATION_FOOTER}`.trim();
}

export function formatProgramEntry(program: OpenchatProgram) {
  const lines = [cleanProgramTitle(program.title)];
  const target = compactSummary(program.applicant_summary);
  const support = compactSummary(program.support_summary);
  const email = applicationEmail(program.application_method);
  if (target) lines.push(`대상: ${target}`);
  if (support) lines.push(`지원: ${support}`);
  if (email) lines.push(`접수: ${email}`);
  lines.push(`마감: ${formatDeadline(program.deadline_at)}`);
  lines.push(program.source_url);
  return lines.join("\n");
}

export function formatMorningPost(programs: OpenchatProgram[], date: string) {
  const header = `✅ ${date.replaceAll("-", ". ")} 지원사업 정보`;
  const entries = programs.map(formatProgramEntry);
  return appendConsultationFooter(`${header}\n\n${entries.join("\n\n")}`);
}

export function formatAfternoonPost(draft: OpenchatContentDraft) {
  return appendConsultationFooter(draft.body);
}
