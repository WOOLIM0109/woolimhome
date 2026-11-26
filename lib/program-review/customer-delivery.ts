import { compactSummary, decodeEntities, formatDeadline } from "../openchat/post-format.ts";

/**
 * 고객사 전달 문구 (2026-11-26)
 *
 * 그날 판정에서 '후보' 로 나온 공고를 고객사마다 모아, 직원이 복사해 고객사
 * 카톡방에 붙일 문구를 만듭니다. **자동으로 보내지 않습니다.**
 *
 * - 판정은 사업자 단위입니다(`고객id:사업자`). 보내는 것은 고객사 단위라 묶습니다.
 *   같은 공고에 사업자가 여럿 맞으면 한 건으로 쓰고 어느 명의인지 적습니다.
 * - '후보' 만 다룹니다. '확인 필요' 와 '제외' 는 넣지 않습니다.
 *   '조건부 후보'(일부 요건은 아직 모름)는 넣되, 확인할 점을 한 줄 붙입니다.
 * - 마감이 지났거나 제외된 공고, 교육·행사 공고, 이미 보낸 공고는 뺍니다.
 * - ★ **'후보' 는 대부분 지역만 맞은 것입니다** (2026-11-25 실측: 고객사 후보 966건 중
 *   지역만 486 · 사업자 유형만 161, 분야가 맞은 것은 24). 그대로 다 넣으면 화장품 회사에
 *   'AI 숏폼 워크숍' · '수산자원보호 직불제' 가 갑니다. 그래서 **분야·업종·필수 인증이 맞고(`strong`)
 *   지역까지 확인된 공고만 미리 골라 둡니다**(`suggested`). 분야만 맞고 지역을 모르는 공고는
 *   부산 회사에 '경기 연천군' 공고가 가는 일이 생겨서 고르지 않습니다(같은 날 실측).
 *   나머지는 목록에만 보이고, 직원이 골라야 문구에 들어갑니다.
 * - 미리 고르는 것은 고객사당 최대 5건. 근거가 센 것, 조건부가 아닌 것, 점수가 높은 것,
 *   마감이 가까운 것 순입니다. 화면 목록은 30건까지 보여 줍니다.
 *
 * 규칙으로만 만듭니다. AI 를 부르지 않습니다.
 */

export const DELIVERY_LIMIT = 5;
/** 화면에 늘어놓는 후보 수. 이보다 많으면 '더 있음' 으로만 알린다 */
export const DELIVERY_LIST_LIMIT = 30;
/** 한 번에 '보냈어요' 로 적을 수 있는 수. API 와 같아야 한다 */
export const DELIVERY_SEND_LIMIT = 10;
/** 이 이유가 하나라도 있으면 '무엇을 하는 회사인지' 까지 맞은 것이다 */
const STRONG = /^(?:분야|업종|필수 인증)(?:\(|$)/;
/**
 * 공고가 '전국' 이라 붙는 지역 일치. 고객사 지역을 본 것이 아니다.
 * 입주 공간(구리 창업공간, 강동구 청년센터)처럼 실제로는 그 지역으로 가야 하는 공고도 전국으로 읽히므로
 * 이것만으로는 미리 고르지 않는다.
 */
const NATIONWIDE = "지역(전국 대상)";
/** 고객사 지역이 공고 지역과 직접 맞았다 */
function localRegion(reason: string) { return reason.startsWith("지역(") && reason !== NATIONWIDE; }
const NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
const CONDITIONAL = "조건부 후보:";

export type DeliveryMatch = {
  program_id: string; target_id: string; target_name: string; verdict: string; reasons: string[]; score: number;
};
export type DeliveryProgram = {
  id: string; title: string; source_url: string | null; deadline_at: string | null; status: string;
  /** 수집기가 교육·행사로 표시한 공고 */
  event_like?: boolean;
};
export type DeliveryRequirement = {
  support_amount_text?: unknown; submission_documents?: unknown;
  /** 공고문에서 읽은 마감(근거가 있는 것만 저장된다). 판정과 같이 공고 칸보다 먼저 믿는다 */
  deadline_at?: unknown;
};
export type DeliveryItem = {
  program_id: string; title: string; source_url: string | null; deadline_at: string | null;
  /** 사업자가 여럿인 고객사에서 이 공고에 맞는 명의. 하나뿐이면 빈 목록 */
  entities: string[];
  reasons: string[]; conditional: boolean; support: string; documents: string[]; more_documents: number; score: number;
  /** 분야·업종·필수 인증 중 하나가 맞았다. 지역·사업자 유형만 맞은 것은 아니다 */
  strong: boolean;
  /** 고객사 지역이 공고 지역과 직접 맞았다. '전국 대상' 은 넣지 않는다 */
  region_confirmed: boolean;
  /** 지역 근거가 '전국 대상' 뿐이다 */
  nationwide: boolean;
  /**
   * 미리 골라도 되는가. **한 사업자 안에서** 분야·업종·인증과 고객사 지역이 함께 맞아야 한다.
   * '전국 대상' 은 지역이 맞은 것으로 치지 않는다 — 직원이 보고 체크한다.
   * 사업자가 여럿인 고객사에서 A 의 분야와 B 의 지역을 합쳐 고르면, 지역을 모르는 공고가 나간다.
   */
  ready: boolean;
};
export type CustomerDelivery = {
  customer_id: string; customer_name: string;
  /** 근거가 센 순으로 최대 30건 */
  items: DeliveryItem[]; /** 30건을 넘어 목록에서 뺀 수 */ omitted: number;
  /** 미리 골라 둔 공고 (근거가 세고 지역이 확인된 것만, 최대 5건). 없으면 빈 목록 */
  suggested: string[];
  /** 미리 골라 둔 공고로 만든 문구. 골라 둔 것이 없으면 빈 글 */
  message: string;
};

/** `고객id:사업자` → 고객id */
export function customerIdOf(targetId: string) {
  const divider = targetId.indexOf(":");
  return divider < 0 ? targetId : targetId.slice(0, divider);
}

/**
 * 사업자가 여럿인 고객사의 판정 이름은 `고객사 · 사업자` 입니다(`entityTargetName`). 뒤쪽만 떼어 냅니다.
 * 고객사 이름이 판정 뒤에 바뀌어도 맞게, 지금 이름과 비교하지 않고 첫 ` · ` 에서 자릅니다.
 */
const ENTITY_DIVIDER = " · ";
function entityLabel(targetName: string) {
  const at = targetName.indexOf(ENTITY_DIVIDER);
  return at < 0 ? null : targetName.slice(at + ENTITY_DIVIDER.length);
}

/**
 * 판정 이유를 고객이 읽을 말로 줄입니다.
 * `확인된 지역 일치: 부산` → `지역(부산)`, `확인된 포함 업종 일치` → `업종`.
 * '확인된' 으로 시작하지 않는 이유(모름·확인 필요)는 쓰지 않습니다.
 */
export function plainReason(reason: string): string | null {
  const text = reason.trim();
  // 이미 가진 인증으로 받는 가점 (`현재 인증과 일치하는 가점: 벤처기업 +3`)
  const bonus = /^현재 인증과 일치하는 가점:\s*(.+?)\s*\+\d+$/.exec(text);
  if (bonus) return `가점(${bonus[1]})`;
  if (!text.startsWith("확인된 ")) return null;
  // 맨 위 요약 줄(`확인된 요건 일치 3건 +12`)은 이유가 아닙니다.
  if (/^확인된 요건 일치 \d+건/.test(text)) return null;
  const match = /^확인된 (.+?) 일치(?::\s*(.+))?$/.exec(text);
  if (!match) return null;
  let label = match[1].replace(/\s*요건$/, "").trim();
  if (label === "포함 업종") label = "업종";
  // `확인된 업력 최소 요건 일치: 원문 기준일 …` — '최소' · '최대' 는 고객에게 뜻이 없다
  if (label.startsWith("업력")) return "업력";
  const value = match[2]?.trim();
  if (!value || /^원문 기준일/.test(value)) return label;
  return `${label}(${value})`;
}

const GENERIC_TAG = /^\s*[[【(]\s*(?:재?공고|모집(?:공고)?|공모|안내|알림|공지|신규|마감임박)\s*[\]】)]\s*/;
/**
 * 고객에게 보일 공고 이름. `[공고]` 같은 뻔한 머리말만 떼고, `[경북]` 처럼 뜻이 있는 머리말은 둡니다.
 * (오픈챗용 `cleanProgramTitle` 은 여는 괄호만 떼서 `공고] …` 가 남습니다.)
 */
export function titleForCustomer(title: string) {
  return decodeEntities(title).replace(/[「」『』]/g, "").replace(GENERIC_TAG, "").replace(/\s+/g, " ").trim();
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function documentNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  const names = value.map(item => typeof item === "string" ? item.trim()
    : item && typeof item === "object" ? text((item as Record<string, unknown>).name) : "").filter(Boolean);
  return [...new Set(names)];
}
/** 마감이 가까운 것 먼저. 마감이 없거나 못 읽은 것은 맨 뒤 */
function deadlineOrder(value: string | null) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}
/**
 * 마감. 판정(`matching.ts`)과 같은 순서로 **공고문에서 근거와 함께 읽은 마감을 먼저** 믿고,
 * 없으면 공고 칸의 마감을 쓴다. 공고 칸은 게시 종료일일 때가 있다(접수 마감보다 늦다).
 */
function deadlineOf(program: DeliveryProgram, requirement: DeliveryRequirement | undefined) {
  const read = requirement?.deadline_at;
  if (typeof read === "string" && Number.isFinite(Date.parse(read))) return read;
  return program.deadline_at;
}
function live(program: DeliveryProgram, deadline: string | null, now: Date) {
  if (program.status === "excluded" || program.event_like) return false;
  if (deadline === null) return true;
  const time = Date.parse(deadline);
  return Number.isFinite(time) && time >= now.getTime();
}

export function deliveryMessage(customerName: string, items: readonly DeliveryItem[]) {
  if (!items.length) return "";
  const head = [`안녕하세요, 울림컴퍼니입니다.`, `${customerName}에 맞는 지원사업 ${items.length}건을 안내드립니다.`];
  const entries = items.map((item, index) => {
    const lines = [`${NUMBERS[index] ?? `${index + 1}.`} ${titleForCustomer(item.title)}`];
    if (item.entities.length) lines.push(`· 신청 명의: ${item.entities.join(", ")}`);
    // '지역(전국 대상)' 은 고객에게 '지역이 맞는다' 로 읽힌다. 공고가 전국 대상이라는 사실만 적는다.
    const reasons = item.reasons.map(reason => reason === NATIONWIDE ? "전국 대상 공고" : reason);
    if (reasons.length) lines.push(`· 맞는 이유: ${reasons.join(", ")}`);
    if (item.support) lines.push(`· 지원: ${item.support}`);
    lines.push(`· 마감: ${formatDeadline(item.deadline_at)}`);
    if (item.documents.length) lines.push(`· 준비 서류: ${item.documents.join(", ")}${item.more_documents ? ` 외 ${item.more_documents}건` : ""}`);
    if (item.conditional) lines.push("· 확인할 점: 일부 요건은 공고문으로 한 번 더 확인이 필요합니다");
    if (item.source_url) lines.push(`· 공고 보기: ${item.source_url}`);
    return lines.join("\n");
  });
  return [head.join("\n"), ...entries, "궁금하신 점은 편하게 말씀해 주세요."].join("\n\n");
}

export function buildCustomerDeliveries(input: {
  matches: readonly DeliveryMatch[];
  programs: readonly DeliveryProgram[];
  requirements: ReadonlyMap<string, DeliveryRequirement>;
  /** `고객id|공고id` 로 이미 보낸 것 */
  delivered: ReadonlySet<string>;
  customerNames: ReadonlyMap<string, string>;
  now: Date;
}): CustomerDelivery[] {
  const programs = new Map(input.programs.map(program => [program.id, program]));
  const byCustomer = new Map<string, Map<string, DeliveryMatch[]>>();
  for (const match of input.matches) {
    if (match.verdict !== "candidate") continue;
    const program = programs.get(match.program_id);
    if (!program || !live(program, deadlineOf(program, input.requirements.get(match.program_id)), input.now)) continue;
    const customerId = customerIdOf(match.target_id);
    if (input.delivered.has(`${customerId}|${match.program_id}`)) continue;
    const perProgram = byCustomer.get(customerId) ?? new Map<string, DeliveryMatch[]>();
    perProgram.set(match.program_id, [...(perProgram.get(match.program_id) ?? []), match]);
    byCustomer.set(customerId, perProgram);
  }
  const result: CustomerDelivery[] = [];
  for (const [customerId, perProgram] of byCustomer) {
    const anyName = [...perProgram.values()][0]?.[0]?.target_name ?? customerId;
    const customerName = input.customerNames.get(customerId) ?? anyName.split(ENTITY_DIVIDER)[0];
    const items = [...perProgram.entries()].map(([programId, matches]): DeliveryItem => {
      const program = programs.get(programId)!;
      const requirement = input.requirements.get(programId) ?? {};
      const entities = [...new Set(matches.map(match => match.target_id.includes(":") ? entityLabel(match.target_name) : null)
        .filter((name): name is string => Boolean(name)))];
      const reasons = [...new Set(matches.flatMap(match => match.reasons ?? []).map(plainReason).filter((r): r is string => Boolean(r)))];
      const documents = documentNames(requirement.submission_documents);
      return {
        program_id: programId, title: program.title, source_url: program.source_url, deadline_at: deadlineOf(program, requirement),
        entities,
        reasons,
        // 맞는 명의 중 하나라도 조건 없이 후보면 조건부로 보지 않습니다.
        conditional: matches.every(match => (match.reasons ?? []).some(reason => reason.startsWith(CONDITIONAL))),
        support: compactSummary(text(requirement.support_amount_text), 80),
        documents: documents.slice(0, 3), more_documents: Math.max(0, documents.length - 3),
        score: Math.max(...matches.map(match => Number(match.score) || 0)),
        strong: reasons.some(reason => STRONG.test(reason)),
        region_confirmed: reasons.some(localRegion),
        nationwide: reasons.includes(NATIONWIDE) && !reasons.some(localRegion),
        ready: matches.some(match => {
          const own = (match.reasons ?? []).map(plainReason).filter((r): r is string => Boolean(r));
          return own.some(reason => STRONG.test(reason)) && own.some(localRegion);
        }),
      };
    }).sort((a, b) => Number(b.ready) - Number(a.ready)
      || Number(b.strong) - Number(a.strong)
      // 직원이 손으로 고를 때 지역 근거가 있는 것(고객사 지역·전국)이 지역을 모르는 것보다 위에 온다
      || Number(b.region_confirmed || b.nationwide) - Number(a.region_confirmed || a.nationwide)
      || Number(a.conditional) - Number(b.conditional)
      || b.score - a.score
      || deadlineOrder(a.deadline_at) - deadlineOrder(b.deadline_at) || a.title.localeCompare(b.title, "ko"));
    const shown = items.slice(0, DELIVERY_LIST_LIMIT);
    const picked = shown.filter(item => item.ready).slice(0, DELIVERY_LIMIT);
    result.push({ customer_id: customerId, customer_name: customerName, items: shown, omitted: items.length - shown.length,
      suggested: picked.map(item => item.program_id), message: deliveryMessage(customerName, picked) });
  }
  // 미리 골라 둔 것이 있는 고객사가 위로 온다
  return result.sort((a, b) => Number(Boolean(b.suggested.length)) - Number(Boolean(a.suggested.length))
    || a.customer_name.localeCompare(b.customer_name, "ko"));
}
