/**
 * 이미 쓴 글에 사람이 남긴 요청사항을 반영합니다.
 *
 * 지금까지 검토 화면의 '수정 요청'은 글을 처음부터 다시 쓰는 버튼이었습니다.
 * 포트폴리오에서는 그마저도 막혀 있어서, 문장 하나 고치려 해도 목업 이미지까지
 * 전부 다시 만들라는 안내만 나왔습니다. 마음에 들던 이미지가 사라지고, 시간과
 * 요금이 들고, 무엇보다 결과를 예측할 수 없었습니다.
 *
 * 그래서 묻는 것을 바꿉니다.
 *
 *   글을 다시 쓰지 말고, 요청받은 것만 고쳐라.
 *
 * 본문은 소제목 단위로 잘라 한 덩이씩 맡깁니다. 한 덩이가 실패해도 그 덩이만
 * 원문으로 남고 나머지는 반영됩니다. 이미지·링크·기존 수치는 보호 마커로 잠가
 * 두므로 요청과 상관없이 사라지거나 자리를 옮기는 일이 없습니다.
 *
 * 말투 다듬기(style-revision.ts)와 닮았지만 규칙이 하나 다릅니다. 말투 다듬기는
 * 수치가 하나라도 늘면 실패로 봅니다. 여기서는 사람이 "1억 원 수주 건이라고
 * 넣어줘"처럼 새 사실을 주기도 하므로, 원문의 수치가 그대로 남아 있는지만
 * 확인하고 요청에서 온 추가는 허용합니다. 원문 보존은 보호 마커가 보장합니다.
 */

import { bodySectionsForRewrite, joinBodySections, plainTextLength } from "./body-sections.ts";
import { lockValue, restoreLocked } from "./protected-markers.ts";
import { sanitizeGeneratedHtml } from "../security/html.ts";

/** 요청을 반영해도 이만큼은 남아 있어야 합니다. 통째로 날아가는 것을 막습니다. */
export const REVISION_MIN_KEEP_RATIO = 0.7;

/**
 * 늘어날 수 있는 한계.
 *
 * 요청이 "문단을 넣어달라"이면 길어지는 게 정상이라 말투 다듬기(1.3배)보다
 * 넉넉하게 잡습니다. 그래도 상한은 둡니다. 한 구간이 몇 배로 불어나면
 * 요청을 반영한 게 아니라 딴 글을 쓴 것입니다.
 */
export const REVISION_MAX_GROWTH_RATIO = 2.5;

/** 사람이 남긴 요청이 이보다 짧으면 무엇을 하라는 것인지 알 수 없습니다. */
export const REVISION_NOTE_MIN_LENGTH = 2;

/** 본문을 맡길 덩이로 나눕니다. */
export function revisionSections(bodyHtml: string) {
  return bodySectionsForRewrite(String(bodyHtml || ""));
}

export { joinBodySections as joinRevisionSections };

/**
 * 한 덩이에서 지켜야 할 것을 잠급니다.
 *
 * figure·링크·주소·수치가 마커로 바뀝니다. 인공지능은 마커를 글자로만 보므로
 * 내용을 바꿀 수 없고, 되돌릴 때 하나라도 빠지거나 겹치면 그 덩이를 버립니다.
 */
export function lockRevisionSection(sectionHtml: string) {
  return lockValue(String(sectionHtml || ""), "BODY", true, true);
}

/**
 * 모델이 새로 지어낸 그림과 링크를 걷어냅니다.
 *
 * 원래 있던 것은 이 시점에 마커라서 걸리지 않습니다. 여기서 지워지는 것은
 * 모델이 없던 자리에 만들어 낸 것뿐입니다.
 */
function safeRevisedHtml(value: string) {
  return sanitizeGeneratedHtml(value)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<\/?(?:figure|figcaption|img|span|section)\b[^>]*>/gi, "");
}

/** 소제목이 몇 개인지 셉니다. 요청을 반영하다 목차가 바뀌면 안 됩니다. */
function headingCount(value: string) {
  return (String(value || "").match(/<h[23](?=[\s>])/gi) || []).length;
}

export type RevisionSectionPromptInput = {
  /** 사람이 남긴 요청사항 원문 */
  note: string;
  /** 마커로 잠근 뒤의 구간 HTML */
  lockedHtml: string;
  /** 이 구간이 몇 번째인지 (1부터) */
  position: number;
  /** 전체 구간 수 */
  total: number;
};

/**
 * 한 덩이를 고쳐 달라고 부탁하는 글을 만듭니다.
 *
 * 구간이 몇 번째인지 알려 주는 이유는, "중간중간 반복해서 넣어줘" 같은 요청을
 * 받았을 때 모델이 스스로 자리를 고를 수 있어야 하기 때문입니다. 이 값이
 * 없으면 모든 구간이 자기가 첫 구간인 줄 알고 도입부만 만들어 냅니다.
 */
export function revisionSectionPrompt(input: RevisionSectionPromptInput) {
  return `
당신은 울림컴퍼니의 네이버 블로그 원고를 고치는 한국어 편집자입니다.
아래는 한 편의 원고 중 ${input.total}개 구간 가운데 ${input.position}번째 구간입니다.
앞뒤 구간은 다른 사람이 같은 요청을 받아 함께 맡고 있습니다.

가장 중요한 규칙입니다.
- 요청사항을 이 구간에 반영하는 것 말고는 아무것도 하지 마세요.
- 요청과 직접 관련이 없는 문장은 한 글자도 바꾸지 마세요. 말투를 다듬지도 마세요.
- 이 구간에 반영할 것이 없으면 받은 그대로 되돌려 주세요.

지켜야 할 것:
- WOOLIMLOCK으로 시작해 END로 끝나는 보호 마커는 철자와 순서를 바꾸거나 지우거나 복제하지 않습니다.
- 보호 마커는 그림·링크·주소·기존 수치입니다. 자리를 옮기지 않습니다.
- 이 구간의 H2·H3 소제목 문구와 개수를 그대로 둡니다. 새 소제목을 만들지 않습니다.
- 요청사항에 없는 숫자·금액·기간·인원을 새로 지어내지 않습니다. 요청사항에 적힌 것은 그대로 써도 됩니다.
- bodyHtml에는 h2, h3, p, ul, ol, li, strong, blockquote만 사용합니다.
- 그림과 링크를 새로 만들지 않습니다.

사람이 남긴 요청사항:
${JSON.stringify(input.note)}

반드시 다음 형태의 JSON 객체만 반환하세요:
{"bodyHtml":""}

원고 구간:
${JSON.stringify({ bodyHtml: input.lockedHtml })}
`.trim();
}

export type RevisionSectionLocks = ReturnType<typeof lockRevisionSection>["locks"];

/**
 * 모델이 돌려준 구간을 받아들일지 판단합니다.
 *
 * 받아들일 수 없으면 예외를 던집니다. 부르는 쪽은 그 덩이만 원문으로 두고
 * 나머지를 계속 처리하면 됩니다. 한 덩이의 실패가 원고 전체를 막지 않습니다.
 */
export function acceptRevisedSection(
  originalHtml: string,
  modelBodyHtml: unknown,
  locks: RevisionSectionLocks,
) {
  if (typeof modelBodyHtml !== "string" || !modelBodyHtml.trim()) {
    throw new Error("구간 결과가 비어 있습니다.");
  }
  // 마커가 하나라도 빠지거나 겹치면 여기서 걸립니다.
  // 그림·링크·기존 수치가 그대로 돌아온다는 보장이 이 한 줄입니다.
  const restored = restoreLocked(safeRevisedHtml(modelBodyHtml), locks);

  const beforeHeadings = headingCount(originalHtml);
  const afterHeadings = headingCount(restored);
  if (beforeHeadings !== afterHeadings) {
    throw new Error(`소제목 개수가 ${beforeHeadings}개에서 ${afterHeadings}개로 달라졌습니다.`);
  }

  const before = plainTextLength(originalHtml);
  const after = plainTextLength(restored);
  if (after < Math.floor(before * REVISION_MIN_KEEP_RATIO)) {
    throw new Error("구간이 원문보다 지나치게 짧아졌습니다.");
  }
  if (after > Math.ceil(before * REVISION_MAX_GROWTH_RATIO)) {
    throw new Error("구간이 원문보다 지나치게 길어졌습니다.");
  }
  return restored;
}

/** 요청사항을 쓸 수 있는 형태로 다듬습니다. 빈 요청이면 null 입니다. */
export function normalizeRevisionNote(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < REVISION_NOTE_MIN_LENGTH) return null;
  return trimmed;
}

export type RevisionOutcome = {
  /** 반영에 성공한 구간 수 */
  changed: number;
  /** 원문 그대로 남긴 구간 수 */
  kept: number;
  /** 구간별 실패 사유. 사람에게 무엇이 왜 안 됐는지 보여 줍니다. */
  failures: { position: number; reason: string }[];
};

/** 결과를 사람이 읽을 한 줄로 적습니다. */
export function describeRevisionOutcome(outcome: RevisionOutcome) {
  if (!outcome.changed) return "요청을 반영한 구간이 없습니다.";
  if (!outcome.kept) return `${outcome.changed}개 구간에 요청을 반영했습니다.`;
  return `${outcome.changed}개 구간에 요청을 반영했고, ${outcome.kept}개 구간은 원문 그대로 두었습니다.`;
}
