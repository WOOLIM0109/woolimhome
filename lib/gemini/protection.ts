import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  configuredPrivacyTerms,
  highRiskMaterialIssue,
  redactPersonalData,
  sensitiveMaterialIssue,
} from "../security/privacy.ts";

export const GEMINI_REVIEW_MODEL = process.env.GEMINI_REVIEW_MODEL || "gemini-3.5-flash";
export const GEMINI_REVIEW_PROMPT_VERSION = "cost-protected-review-v2-diff-redacted";
export const GEMINI_REVIEW_MAX_OUTPUT_TOKENS = 4_096;
export const GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS = 2;

export type GeminiReviewChange = {
  changedText: string;
  contextBefore: string;
  contextAfter: string;
  removedCharacters: number;
};

export type GeminiReviewItem = {
  /** Stable, redacted-content-derived identifier sent to Gemini. */
  id: string;
  /** UI identifier retained only for mapping the provider result back to the caller. */
  clientId: string;
  title: string;
  context: string;
  changes: GeminiReviewChange[];
};

export type GeminiReviewProviderItem = Omit<GeminiReviewItem, "clientId">;

export type GeminiBudgetConfig = {
  dailyCalls: number;
  monthlyCalls: number;
  dailyCostUsd: number;
  monthlyCostUsd: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type GeminiUsageSnapshot = {
  dailyCallsUsed: number;
  monthlyCallsUsed: number;
  dailyCostUsed: number;
  monthlyCostUsed: number;
};

export type GeminiInvocationContext = {
  operationId: string;
  actor: string;
  project: string;
  model: string;
  promptVersion: string;
  contentHash: string;
  contentCount: number;
};

const invocationStorage = new AsyncLocalStorage<GeminiInvocationContext>();

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function geminiBudgetConfig(): GeminiBudgetConfig {
  return {
    /**
     * 횟수 상한은 일이 돌아갈 만큼은 되어야 합니다.
     *
     * 예전 기본값은 하루 3회, 한 달 30회였습니다. 그런데 칼럼 한 편을 쓰는
     * 데만 6회를 미리 잡습니다. 하루 3회로는 한 번도 시작할 수 없어서,
     * 예산이 모자란 것이 아니라 기능 자체가 멈춰 있었습니다. 칼럼은
     * 화·목·격주 토에 나가니 한 달이면 예약만 예순 번을 넘습니다.
     *
     * 실제로 돈을 막는 것은 아래 비용 상한입니다. 횟수는 폭주를 막는
     * 보조 장치라, 하루 몇 편을 만들 수 있는 정도로 맞춥니다.
     */
    dailyCalls: Math.floor(positiveNumber(process.env.GEMINI_DAILY_CALL_LIMIT, 20)),
    monthlyCalls: Math.floor(positiveNumber(process.env.GEMINI_MONTHLY_CALL_LIMIT, 300)),
    /**
     * 비용 상한은 폭주를 막는 마지막 방어선입니다. 매일 쓰는 브레이크가 아닙니다.
     *
     * 하루 $1, 한 달 $10 이던 때에는 한 달에 194회를 쓰고 막혔습니다. 횟수는
     * 500회 중 194회로 한참 남았는데 비용 쪽이 먼저 닫힌 것입니다. 아래
     * 단가가 실제보다 크게 잡혀 있어서, 실제로 나간 돈보다 훨씬 앞서 걸립니다.
     *
     * 그래서 비용은 여유 있게 두고, 하루에 몇 편을 만들지는 위의 횟수 상한으로
     * 정합니다. 횟수가 먼저 걸리게 해 두면 무엇을 조절해야 하는지도 분명해집니다.
     */
    dailyCostUsd: positiveNumber(process.env.GEMINI_DAILY_COST_LIMIT_USD, 5),
    monthlyCostUsd: positiveNumber(process.env.GEMINI_MONTHLY_COST_LIMIT_USD, 60),
    /**
     * 단가는 실제 값이 아니라 크게 잡은 추정치입니다.
     *
     * 호출 한 번을 입력 2만 토큰, 출력 6천 토큰으로 잡고 여기에 이 단가를
     * 곱해 $0.08 정도로 셉니다. 실제 Flash 계열 단가는 이보다 몇 배 낮으므로,
     * 기록된 금액은 실제 청구액이 아니라 넉넉히 부풀린 값으로 읽어야 합니다.
     *
     * 실제 청구액을 확인하면 아래 두 환경변수에 넣어 주세요. 그때부터 상한이
     * 진짜 지출을 뜻하게 됩니다.
     */
    inputUsdPerMillionTokens: positiveNumber(process.env.GEMINI_INPUT_USD_PER_MILLION_TOKENS, 1),
    outputUsdPerMillionTokens: positiveNumber(process.env.GEMINI_OUTPUT_USD_PER_MILLION_TOKENS, 10),
  };
}

export function geminiRuntimeStatus() {
  if (process.env.GEMINI_ENABLED !== "true") {
    return { enabled: false, reason: "GEMINI_ENABLED=false: 운영 Gemini 호출이 잠겨 있습니다." };
  }
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  if (environment !== "production" && process.env.GEMINI_ALLOW_NON_PRODUCTION !== "true") {
    return { enabled: false, reason: `${environment} 환경에서는 Gemini가 기본 차단됩니다.` };
  }
  if (!process.env.GEMINI_API_KEY) {
    return { enabled: false, reason: "GEMINI_API_KEY가 설정되지 않았습니다." };
  }
  // 고객사·담당자 이름 목록(PII_REDACTION_TERMS)은 있으면 좋지만 필수는 아닙니다.
  // 전화번호·이메일·주민번호 같은 일반 개인정보는 이 목록과 무관하게 항상 가려지고,
  // 대외비 표기가 남아 있는 원고는 normalizeGeminiReviewItems 가 따로 막습니다.
  // 목록을 필수로 두면 이름을 정하기 전까지 자동화 전체가 멈추므로 경고로만 알립니다.
  // GEMINI_REQUIRE_PII_TERMS=true 로 두면 예전처럼 필수로 되돌릴 수 있습니다.
  if (configuredPrivacyTerms().length === 0) {
    const warning = "PII_REDACTION_TERMS가 비어 있습니다. 고객사·담당자·프로젝트 이름을 등록하면 해당 단어가 전송 전에 가려집니다.";
    if (process.env.GEMINI_REQUIRE_PII_TERMS === "true") {
      return { enabled: false, reason: warning, warning };
    }
    return { enabled: true, reason: null, warning };
  }
  return { enabled: true, reason: null, warning: null };
}

const REVIEW_LIMITS = {
  items: 20,
  clientId: 120,
  title: 300,
  originalContent: 30_000,
  changedContent: 30_000,
  context: 1_500,
  providerCharacters: 80_000,
} as const;
const DIFF_CONTEXT_CHARACTERS = 48;
const DIFF_MERGE_GAP_CHARACTERS = 16;
const MAX_MYERS_EDIT_DISTANCE = 512;

type DiffOperation = {
  type: "equal" | "insert" | "delete";
  value: string;
};

type ChangeRange = {
  start: number;
  end: number;
  removedCharacters: number;
};

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").normalize("NFC") : "";
}

function boundedText(value: unknown, maximum: number, label: string) {
  const normalized = normalizedText(value);
  if (normalized.length > maximum) {
    throw new Error(`${label}은(는) ${maximum.toLocaleString("ko-KR")}자를 초과할 수 없습니다.`);
  }
  return normalized;
}

function diffTokens(value: string) {
  // Code-point tokens keep the diff exact even for a 30,000-character URL,
  // identifier, or minified body with no whitespace. Word-sized tokens can
  // turn a three-character edit inside such a value into a full-body hunk.
  return Array.from(value);
}

function trimCommonAffixes(original: string, changed: string) {
  const originalPoints = Array.from(original);
  const changedPoints = Array.from(changed);
  const sharedMaximum = Math.min(originalPoints.length, changedPoints.length);
  let prefixPoints = 0;
  while (
    prefixPoints < sharedMaximum
    && originalPoints[prefixPoints] === changedPoints[prefixPoints]
  ) prefixPoints += 1;

  let suffixPoints = 0;
  while (
    suffixPoints < originalPoints.length - prefixPoints
    && suffixPoints < changedPoints.length - prefixPoints
    && originalPoints[originalPoints.length - suffixPoints - 1]
      === changedPoints[changedPoints.length - suffixPoints - 1]
  ) suffixPoints += 1;

  const originalStart = originalPoints.slice(0, prefixPoints).join("").length;
  const changedStart = changedPoints.slice(0, prefixPoints).join("").length;
  const originalSuffixLength = suffixPoints
    ? originalPoints.slice(originalPoints.length - suffixPoints).join("").length
    : 0;
  const changedSuffixLength = suffixPoints
    ? changedPoints.slice(changedPoints.length - suffixPoints).join("").length
    : 0;
  return {
    originalStart,
    originalEnd: original.length - originalSuffixLength,
    changedStart,
    changedEnd: changed.length - changedSuffixLength,
  };
}

function mapValue(map: Map<number, number>, key: number) {
  return map.get(key) ?? Number.NEGATIVE_INFINITY;
}

function backtrackMyers(
  trace: Array<Map<number, number>>,
  original: string[],
  changed: string[],
) {
  let x = original.length;
  let y = changed.length;
  const operations: DiffOperation[] = [];

  for (let depth = trace.length - 1; depth >= 0; depth -= 1) {
    const diagonal = x - y;
    const previous = trace[depth];
    const previousDiagonal = diagonal === -depth
      || (diagonal !== depth && mapValue(previous, diagonal - 1) < mapValue(previous, diagonal + 1))
      ? diagonal + 1
      : diagonal - 1;
    const previousX = Math.max(0, mapValue(previous, previousDiagonal));
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      operations.push({ type: "equal", value: original[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (depth === 0) break;
    if (x === previousX) {
      operations.push({ type: "insert", value: changed[y - 1] });
      y -= 1;
    } else {
      operations.push({ type: "delete", value: original[x - 1] });
      x -= 1;
    }
  }
  return operations.reverse();
}

function myersDiff(original: string[], changed: string[]) {
  if (!original.length) return changed.map((value): DiffOperation => ({ type: "insert", value }));
  if (!changed.length) return original.map((value): DiffOperation => ({ type: "delete", value }));
  const maximumDepth = original.length + changed.length;
  const depthLimit = Math.min(maximumDepth, MAX_MYERS_EDIT_DISTANCE);
  const furthest = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let depth = 0; depth <= depthLimit; depth += 1) {
    trace.push(new Map(furthest));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x = diagonal === -depth
        || (diagonal !== depth && mapValue(furthest, diagonal - 1) < mapValue(furthest, diagonal + 1))
        ? mapValue(furthest, diagonal + 1)
        : mapValue(furthest, diagonal - 1) + 1;
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;
      while (x < original.length && y < changed.length && original[x] === changed[y]) {
        x += 1;
        y += 1;
      }
      furthest.set(diagonal, x);
      if (x >= original.length && y >= changed.length) {
        return backtrackMyers(trace, original, changed);
      }
    }
  }
  return null;
}

function changeRanges(original: string, changed: string) {
  const bounds = trimCommonAffixes(original, changed);
  const operations = myersDiff(
    diffTokens(original.slice(bounds.originalStart, bounds.originalEnd)),
    diffTokens(changed.slice(bounds.changedStart, bounds.changedEnd)),
  );
  if (!operations) {
    throw new Error("변경 범위가 너무 넓어 안전하게 분리할 수 없습니다. 원고를 여러 검수 항목으로 나누어 주세요.");
  }
  const ranges: ChangeRange[] = [];
  let changedOffset = bounds.changedStart;
  let active: ChangeRange | null = null;
  const flush = () => {
    if (!active) return;
    const previous = ranges.at(-1);
    if (previous && active.start - previous.end <= DIFF_MERGE_GAP_CHARACTERS) {
      previous.end = active.end;
      previous.removedCharacters += active.removedCharacters;
    } else {
      ranges.push(active);
    }
    active = null;
  };

  for (const operation of operations) {
    if (operation.type === "equal") {
      flush();
      changedOffset += operation.value.length;
      continue;
    }
    active ||= { start: changedOffset, end: changedOffset, removedCharacters: 0 };
    if (operation.type === "insert") {
      changedOffset += operation.value.length;
      active.end = changedOffset;
    } else {
      active.removedCharacters += operation.value.length;
    }
  }
  flush();
  return ranges;
}

export function extractGeminiReviewChanges(original: string, changed: string): GeminiReviewChange[] {
  const ranges = changeRanges(original, changed);
  return ranges.map((range, index) => {
    const previous = ranges[index - 1];
    const next = ranges[index + 1];
    const gapBefore = range.start - (previous?.end ?? 0);
    const gapAfter = (next?.start ?? changed.length) - range.end;
    const beforeLength = previous
      ? Math.min(DIFF_CONTEXT_CHARACTERS, Math.floor(Math.max(0, gapBefore - 1) / 2))
      : Math.min(DIFF_CONTEXT_CHARACTERS, gapBefore);
    const afterLength = next
      ? Math.min(DIFF_CONTEXT_CHARACTERS, Math.floor(Math.max(0, gapAfter - 1) / 2))
      : Math.min(DIFF_CONTEXT_CHARACTERS, gapAfter);
    return {
      changedText: changed.slice(range.start, range.end),
      contextBefore: changed.slice(range.start - beforeLength, range.start),
      contextAfter: changed.slice(range.end, range.end + afterLength),
      removedCharacters: range.removedCharacters,
    };
  });
}

function stableProviderItem(input: Omit<GeminiReviewProviderItem, "id">) {
  const canonical = JSON.stringify(input);
  return { id: `review-${sha256(canonical)}`, ...input };
}

export function normalizeGeminiReviewItems(value: unknown): GeminiReviewItem[] {
  if (!Array.isArray(value)) return [];
  if (value.length > REVIEW_LIMITS.items) {
    throw new Error(`검수 항목은 한 번에 ${REVIEW_LIMITS.items}건을 초과할 수 없습니다.`);
  }
  const clientIds = new Set<string>();
  const normalized = value.map((entry, index) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const clientId = boundedText(row.id, REVIEW_LIMITS.clientId, "항목 ID").trim() || `item-${index + 1}`;
    if (clientIds.has(clientId)) throw new Error(`중복된 항목 ID가 있습니다: ${clientId}`);
    clientIds.add(clientId);
    const rawFields = [
      ["제목", boundedText(row.title, REVIEW_LIMITS.title, "제목").trim()],
      ["원문", boundedText(row.originalContent, REVIEW_LIMITS.originalContent, "원문")],
      ["수정본", boundedText(row.changedContent, REVIEW_LIMITS.changedContent, "수정본")],
      ["문맥", boundedText(row.context, REVIEW_LIMITS.context, "문맥").trim()],
    ] as const;
    // Inspect high-risk markers and secret labels before any configurable term
    // can replace the marker itself (for example, "password" or "대외비").
    for (const [label, text] of rawFields) {
      const issue = highRiskMaterialIssue(text);
      if (issue) {
        throw new Error(`${label}에 ${issue}가 포함되어 AI 전송을 차단했습니다. 민감정보를 제거한 뒤 다시 확인해 주세요.`);
      }
    }
    const [title, originalContent, changedContent, context] = rawFields.map(
      ([, text]) => redactPersonalData(text).text,
    );
    for (const [label, text] of [
      ["제목", title],
      ["원문", originalContent],
      ["수정본", changedContent],
      ["문맥", context],
    ] as const) {
      const issue = sensitiveMaterialIssue(text);
      if (issue) {
        throw new Error(`${label}에 ${issue}가 남아 있어 AI 전송을 차단했습니다. 민감정보를 제거하거나 PII_REDACTION_TERMS에 등록해 주세요.`);
      }
    }
    if (originalContent === changedContent) return null;
    const changes = extractGeminiReviewChanges(originalContent, changedContent);
    if (!changes.length) return null;
    const provider = stableProviderItem({ title, context, changes });
    return { ...provider, clientId };
  });
  const changed = normalized.filter((item): item is GeminiReviewItem => Boolean(item));
  changed.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (let index = 1; index < changed.length; index += 1) {
    if (changed[index - 1].id === changed[index].id) {
      throw new Error("동일한 변경 콘텐츠가 중복되어 있습니다. 한 항목만 남겨 주세요.");
    }
  }
  const totalLength = JSON.stringify(geminiReviewProviderPayload(changed)).length;
  if (totalLength > REVIEW_LIMITS.providerCharacters) {
    throw new Error(`변경 콘텐츠는 한 번에 ${REVIEW_LIMITS.providerCharacters.toLocaleString("ko-KR")}자까지 검수할 수 있습니다.`);
  }
  return changed;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function geminiReviewProviderPayload(items: GeminiReviewItem[]): GeminiReviewProviderItem[] {
  const unique = new Map<string, GeminiReviewProviderItem>();
  for (const { id, title, context, changes } of items) {
    if (!unique.has(id)) unique.set(id, { id, title, context, changes });
  }
  return [...unique.values()].sort(
    (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

export function reviewContentHash(items: GeminiReviewItem[]) {
  return sha256(JSON.stringify(geminiReviewProviderPayload(items)));
}

export function reviewCacheKey(contentHash: string, promptVersion: string, model: string) {
  return sha256(`${contentHash}\u0000${promptVersion}\u0000${model}`);
}

export function buildGeminiReviewPrompt(items: GeminiReviewItem[]) {
  const payload = geminiReviewProviderPayload(items);
  return `당신은 울림컴퍼니 원고의 최종 검수자입니다.
아래에는 사용자가 실제로 바꾼 부분과 꼭 필요한 짧은 문맥만 있습니다. 전체 원고나 이전 대화는 제공되지 않습니다.
사실·숫자·고유명사를 새로 만들지 말고, 각 항목의 문체·명료성·오탈자만 검수하세요.
통과는 passed, 수정이 필요하면 needs_revision, 판단할 수 없으면 failed로 표시하세요.
changes의 changedText만 검수 대상입니다. contextBefore와 contextAfter는 고치지 말고 문맥 확인에만 사용하세요.
removedCharacters는 삭제된 원문의 글자 수이며 삭제 원문 자체는 제공되지 않습니다.
suggestedContent는 수정이 필요할 때만 changedText에 대응하는 수정 조각을 순서대로 반환하세요.
반드시 JSON 하나만 반환하세요.
{"results":[{"id":"item id","status":"passed|needs_revision|failed","issues":["짧은 설명"],"suggestedContent":""}]}

변경 항목:
${JSON.stringify(payload)}`;
}

export function remapGeminiReviewResultsToClientIds<T extends { id: string }>(
  items: GeminiReviewItem[],
  results: T[],
) {
  const clientsByProvider = new Map<string, string[]>();
  for (const item of items) {
    const clients = clientsByProvider.get(item.id) || [];
    clients.push(item.clientId);
    clientsByProvider.set(item.id, clients);
  }
  return results.flatMap((result) => (
    clientsByProvider.get(result.id) || []
  ).map((clientId) => ({ ...result, id: clientId, providerId: result.id })));
}

export function estimateGeminiInputTokens(prompt: string) {
  // A heuristic average (for example UTF-8 bytes / 3) is not a hard ceiling
  // for code, URLs, emoji, or high-entropy text. One token per UTF-8 byte is
  // deliberately expensive, but is a provider-call-free conservative bound.
  return Math.max(1, Buffer.byteLength(prompt, "utf8"));
}

export function estimatedGeminiCostUsd(
  inputTokens: number,
  outputTokens: number,
  config = geminiBudgetConfig(),
) {
  return (inputTokens / 1_000_000) * config.inputUsdPerMillionTokens
    + (outputTokens / 1_000_000) * config.outputUsdPerMillionTokens;
}

/** 돈을 사람이 읽는 모습으로. 소수점 넷째 자리까지 봐야 작은 금액이 0 으로 보이지 않습니다. */
function usdLabel(value: number) {
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

export function budgetDecision(
  usage: GeminiUsageSnapshot,
  estimatedCostUsd: number,
  config = geminiBudgetConfig(),
  plannedCalls = 1,
) {
  const reservedCalls = Math.max(1, Math.floor(plannedCalls));

  /**
   * 작업 하나가 상한보다 크면, 아무리 기다려도 실행되지 않습니다.
   *
   * 예산을 다 써서 막히는 것과는 다른 상황인데 예전에는 같은 말이 나왔습니다.
   * "상한을 초과합니다" 만 보고는 내일 다시 되겠거니 하게 됩니다. 실제로는
   * 상한을 올리기 전까지 영영 돌지 않습니다. 그래서 따로 알려 줍니다.
   */
  if (reservedCalls > config.dailyCalls) {
    return {
      allowed: false,
      reason: `이 작업은 한 번에 ${reservedCalls}회를 예약하는데 일일 상한이 ${config.dailyCalls}회입니다.`
        + " 상한을 올리기 전에는 실행되지 않습니다.",
      detail: "환경변수 GEMINI_DAILY_CALL_LIMIT",
    };
  }
  if (reservedCalls > config.monthlyCalls) {
    return {
      allowed: false,
      reason: `이 작업은 한 번에 ${reservedCalls}회를 예약하는데 월간 상한이 ${config.monthlyCalls}회입니다.`
        + " 상한을 올리기 전에는 실행되지 않습니다.",
      detail: "환경변수 GEMINI_MONTHLY_CALL_LIMIT",
    };
  }

  /**
   * 무엇에 걸렸는지와 그 숫자를 함께 돌려줍니다.
   *
   * 예전에는 막힌 이유만 돌려주고, 화면에는 늘 호출 횟수를 붙였습니다.
   * 그래서 비용에 걸렸을 때 "비용 상한을 초과합니다 (194회 / 상한 500회)"
   * 처럼 서로 맞지 않는 말이 나왔습니다. 아직 여유가 있는 숫자를 보여 주니
   * 왜 막혔는지 알 수가 없었습니다.
   */
  if (usage.dailyCallsUsed + reservedCalls > config.dailyCalls) {
    return {
      allowed: false,
      reason: "일일 Gemini 호출 상한을 초과합니다.",
      detail: `오늘 사용 ${usage.dailyCallsUsed}회 + 이번 작업 ${reservedCalls}회 / 상한 ${config.dailyCalls}회`,
    };
  }
  if (usage.monthlyCallsUsed + reservedCalls > config.monthlyCalls) {
    return {
      allowed: false,
      reason: "월간 Gemini 호출 상한을 초과합니다.",
      detail: `이번 달 사용 ${usage.monthlyCallsUsed}회 + 이번 작업 ${reservedCalls}회 / 상한 ${config.monthlyCalls}회`,
    };
  }
  if (usage.dailyCostUsed + estimatedCostUsd > config.dailyCostUsd) {
    return {
      allowed: false,
      reason: "일일 Gemini 비용 상한을 초과합니다.",
      detail: `오늘 사용 ${usdLabel(usage.dailyCostUsed)} + 이번 작업 예상 ${usdLabel(estimatedCostUsd)}`
        + ` / 상한 ${usdLabel(config.dailyCostUsd)} (환경변수 GEMINI_DAILY_COST_LIMIT_USD)`,
    };
  }
  if (usage.monthlyCostUsed + estimatedCostUsd > config.monthlyCostUsd) {
    return {
      allowed: false,
      reason: "월간 Gemini 비용 상한을 초과합니다.",
      detail: `이번 달 사용 ${usdLabel(usage.monthlyCostUsed)} + 이번 작업 예상 ${usdLabel(estimatedCostUsd)}`
        + ` / 상한 ${usdLabel(config.monthlyCostUsd)} (환경변수 GEMINI_MONTHLY_COST_LIMIT_USD)`,
    };
  }
  return { allowed: true, reason: null, detail: null };
}

export function koreaUsageWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dailyStart: new Date(`${values.year}-${values.month}-${values.day}T00:00:00+09:00`).toISOString(),
    monthlyStart: new Date(`${values.year}-${values.month}-01T00:00:00+09:00`).toISOString(),
  };
}

export function runWithGeminiInvocation<T>(context: GeminiInvocationContext, work: () => Promise<T>) {
  return invocationStorage.run(context, work);
}

export function assertGeminiInvocationAllowed(model: string) {
  const runtime = geminiRuntimeStatus();
  if (!runtime.enabled) throw new Error(runtime.reason || "Gemini 호출이 비활성화되어 있습니다.");
  const context = invocationStorage.getStore();
  if (!context || !context.operationId || context.contentCount < 1) {
    throw new Error("AI 검수 실행 확인이 없는 Gemini 호출은 차단됩니다.");
  }
  if (context.model !== model) throw new Error("확인한 모델과 실제 호출 모델이 다릅니다.");
  return context;
}
