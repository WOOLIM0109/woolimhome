/**
 * 검토 화면의 요청사항을 실제 원고에 반영합니다.
 *
 * 규칙과 판정은 draft-revision.ts 에 있습니다. 여기서는 그것을 들고
 * 인공지능을 부르고 저장하는 일만 합니다. 나누어 둔 이유는, 규칙 쪽은
 * 시험으로 붙잡아 둘 수 있어야 하기 때문입니다.
 *
 * 목업 이미지에는 손대지 않습니다. 고치는 것은 metadata.generated 의
 * 제목·본문뿐이고, 본문 안의 그림은 보호 마커로 잠가 자리까지 지킵니다.
 */

import { contentAdmin } from "@/lib/content-ops/data";
import { AI_OUTPUT_LIMITS } from "@/lib/ai-budget";
import { generateGeminiJson } from "@/lib/portfolio/gemini";
import { insertSentenceBreaks } from "@/lib/content-ops/sentence-breaks-html";
import {
  acceptRevisedSection,
  describeRevisionOutcome,
  joinRevisionSections,
  lockRevisionSection,
  normalizeRevisionNote,
  revisionSectionPrompt,
  revisionSections,
  type RevisionOutcome,
} from "@/lib/content-ops/draft-revision";

/** 요청 하나가 부를 수 있는 최대 구간 수. body-sections 의 상한과 같습니다. */
export const REVISION_MAX_SECTIONS = 8;

export class DraftRevisionUnavailable extends Error {
  code: string;
  constructor(message: string, code = "DRAFT_REVISION_UNAVAILABLE") {
    super(message);
    this.name = "DraftRevisionUnavailable";
    this.code = code;
  }
}

/**
 * 이 작업의 본문을 요청사항대로 고치면 몇 번 부르게 되는지 미리 셉니다.
 *
 * 예산 확인이 호출 전에 이루어져야 해서 따로 빼 두었습니다.
 */
export async function plannedRevisionCalls(workItemId: string) {
  const { data, error } = await contentAdmin()
    .from("content_work_items")
    .select("metadata")
    .eq("id", workItemId)
    .single();
  if (error) throw new Error(error.message);
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  const generated = metadata.generated && typeof metadata.generated === "object"
    ? metadata.generated as Record<string, unknown>
    : null;
  const bodyHtml = typeof generated?.bodyHtml === "string" ? generated.bodyHtml : "";
  const sections = revisionSections(bodyHtml);
  return Math.min(Math.max(sections.length, 1), REVISION_MAX_SECTIONS);
}

/** 한 덩이를 인공지능에게 맡깁니다. 실패하면 사유를 담아 던집니다. */
async function reviseSection(
  note: string,
  sectionHtml: string,
  position: number,
  total: number,
) {
  const locked = lockRevisionSection(sectionHtml);
  const answer = await generateGeminiJson<{ bodyHtml?: unknown }>([{
    text: revisionSectionPrompt({
      note,
      lockedHtml: locked.value,
      position,
      total,
    }),
  }], {
    maxOutputTokens: AI_OUTPUT_LIMITS.styleRevisionSection,
    timeoutMs: 60_000,
    attempts: 1,
    jsonAttempts: 1,
  });
  return acceptRevisedSection(sectionHtml, answer?.bodyHtml, locked.locks);
}

export type DraftRevisionResult = RevisionOutcome & {
  id: string;
  status: string;
  note: string;
  message: string;
  /** 보류 상태 그대로라면 왜 보류인지. 글을 고쳐도 풀리지 않는 것들입니다. */
  heldReason: string | null;
};

/**
 * 원고 하나에 요청사항을 반영합니다.
 *
 * 한 덩이가 실패해도 멈추지 않습니다. 그 덩이만 원문으로 남기고 나머지를
 * 계속 처리한 뒤, 무엇이 왜 안 됐는지 함께 돌려줍니다. 예전에는 한 번의
 * 실패가 원고 전체를 손도 못 댄 채로 남겼습니다.
 */
export async function reviseWorkItemDraft(
  workItemId: string,
  requestedNote: unknown,
  actor: string,
): Promise<DraftRevisionResult> {
  const note = normalizeRevisionNote(requestedNote);
  if (!note) {
    throw new DraftRevisionUnavailable(
      "무엇을 고칠지 적어 주세요. 입력창에 요청사항을 쓴 뒤 다시 눌러 주세요.",
      "DRAFT_REVISION_NOTE_REQUIRED",
    );
  }

  const admin = contentAdmin();
  const { data: current, error: currentError } = await admin
    .from("content_work_items")
    .select("id,status,title,review_note,metadata,updated_at")
    .eq("id", workItemId)
    .single();
  if (currentError) throw new Error(currentError.message);
  if (current.status === "published") {
    throw new DraftRevisionUnavailable(
      "이미 발행한 글은 여기서 고칠 수 없습니다.",
      "DRAFT_REVISION_PUBLISHED",
    );
  }

  const metadata = (current.metadata || {}) as Record<string, unknown>;
  const generated = metadata.generated && typeof metadata.generated === "object"
    ? metadata.generated as Record<string, unknown>
    : null;
  const bodyHtml = typeof generated?.bodyHtml === "string" ? generated.bodyHtml : "";
  if (!generated || !bodyHtml.trim()) {
    throw new DraftRevisionUnavailable(
      "고칠 원고가 아직 없습니다. 본문이 만들어진 뒤에 요청해 주세요.",
      "DRAFT_REVISION_NO_BODY",
    );
  }

  const sections = revisionSections(bodyHtml);
  if (!sections.length) {
    throw new DraftRevisionUnavailable(
      "고칠 원고가 아직 없습니다. 본문이 만들어진 뒤에 요청해 주세요.",
      "DRAFT_REVISION_NO_BODY",
    );
  }

  const revised: string[] = [];
  const failures: { position: number; reason: string }[] = [];
  let changed = 0;
  for (let index = 0; index < sections.length; index += 1) {
    const position = index + 1;
    try {
      const next = await reviseSection(note, sections[index], position, sections.length);
      // 글자가 하나도 안 바뀌었으면 반영할 게 없던 구간입니다. 실패가 아닙니다.
      if (next !== sections[index]) changed += 1;
      revised.push(next);
    } catch (error) {
      failures.push({
        position,
        reason: error instanceof Error ? error.message : "구간을 고치지 못했습니다.",
      });
      revised.push(sections[index]);
    }
  }

  if (!changed) {
    // 하나도 못 고쳤으면 저장하지 않습니다. 원고를 건드리지 않은 채로 알립니다.
    const reason = failures.length
      ? `구간 ${failures.map((failure) => failure.position).join(", ")}에서 막혔습니다: ${failures[0].reason}`
      : "요청과 맞는 자리를 찾지 못했습니다. 요청사항을 조금 더 구체적으로 적어 주세요.";
    throw new DraftRevisionUnavailable(
      `요청을 반영하지 못했습니다. ${reason}`,
      "DRAFT_REVISION_NO_CHANGE",
    );
  }

  const nextBodyHtml = insertSentenceBreaks(joinRevisionSections(revised));
  const appliedAt = new Date().toISOString();
  const validation = metadata.validation && typeof metadata.validation === "object"
    ? metadata.validation as Record<string, unknown>
    : {};
  const outcome: RevisionOutcome = {
    changed,
    kept: sections.length - changed,
    failures,
  };

  /*
   * 보류는 풀지 않습니다.
   *
   * 처음에는 manual_edit 를 따라 보류를 검토 대기로 올리고 사유도 지웠습니다.
   * 그런데 포트폴리오가 보류되는 이유는 대개 글이 아니라 목업 기록입니다.
   * 선정 장표, 원본 지문, 가림 증적 같은 것들인데 글을 고쳐도 그대로입니다.
   * 사유만 지워지면 왜 막혀 있는지 알 길이 사라지고, 승인을 눌러야 비로소
   * 빨간 글씨로 쏟아집니다. 실제로 그렇게 됐습니다.
   *
   * 글만 고치는 이 기능은 글만 책임집니다. 보류 해제는 사람이 눈으로 보고
   * '보류 해제' 버튼으로 합니다. 그 버튼은 그러라고 있는 것입니다.
   */
  const { data: saved, error: saveError } = await admin
    .from("content_work_items")
    .update({
      metadata: {
        ...metadata,
        generated: { ...generated, bodyHtml: nextBodyHtml },
        validation: {
          ...validation,
          plainLength: nextBodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, "").length,
          h2Count: (nextBodyHtml.match(/<h2[\s>]/gi) || []).length,
        },
        // 무엇을 요청했고 어디까지 반영됐는지 남겨 둡니다.
        // 결과가 기대와 다를 때 사람이 짚어낼 수 있어야 고칠 수 있습니다.
        draftRevision: {
          note,
          appliedAt,
          appliedBy: actor,
          sections: sections.length,
          changed,
          failures,
        },
      },
      updated_at: appliedAt,
    })
    .eq("id", workItemId)
    .eq("updated_at", current.updated_at)
    .select("id,status")
    .maybeSingle();
  if (saveError) throw new Error(saveError.message);
  if (!saved) {
    throw new DraftRevisionUnavailable(
      "고치는 동안 다른 변경이 있었습니다. 새로고침 후 다시 시도해 주세요.",
      "DRAFT_REVISION_CONFLICT",
    );
  }

  const heldReason = saved.status === "on_hold" && typeof current.review_note === "string"
    ? current.review_note
    : null;
  return {
    id: saved.id,
    status: saved.status,
    note,
    // 보류였다면 그 사실을 결과에 같이 실어 보냅니다. 글은 고쳐졌는데
    // 승인이 안 되는 이유를 승인 버튼을 눌러 본 뒤에야 아는 일이 없도록.
    message: heldReason
      ? `${describeRevisionOutcome(outcome)} 다만 이 작업은 보류 상태 그대로입니다.`
      : describeRevisionOutcome(outcome),
    heldReason,
    ...outcome,
  };
}
