import { CONSULTATION_FOOTER } from "./config";
import type { OpenchatContentDraft, OpenchatProgram } from "./types";

function formatKoreanDate(value?: string | null) {
  if (!value) return "공고문 참조";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatMorningPost(programs: OpenchatProgram[], date: string) {
  const header = `✅ ${date.replaceAll("-", ". ")} 지원사업 정보 ✅`;
  const entries = programs.map((program) => `◾제목_[${program.title}]

◾사업내용

신청대상 :
${program.applicant_summary || "- 자세한 신청 대상은 공고문을 확인해 주세요."}

**지원내용

${program.support_summary || "- 자세한 지원 내용은 공고문을 확인해 주세요."}

※ 자세한 지원내용 공고문 참조

◾링크
${program.source_url}

${program.application_method || "접수방법은 공고문 참조"}

◾신청기간
${program.starts_at ? `${formatKoreanDate(program.starts_at)} ~ ` : ""}${formatKoreanDate(program.deadline_at)}까지

-----------------------------------------`);
  return `${header}\n\n${entries.join("\n\n")}`.trim();
}

export function formatAfternoonPost(draft: OpenchatContentDraft) {
  return `${draft.body.trim()}\n\n${CONSULTATION_FOOTER}`.trim();
}

