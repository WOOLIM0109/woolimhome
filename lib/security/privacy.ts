type RedactionKind =
  | "email"
  | "phone"
  | "registration"
  | "account"
  | "card"
  | "address"
  | "name"
  | "custom";

export type PrivacyRedactionResult = {
  text: string;
  counts: Partial<Record<RedactionKind, number>>;
  total: number;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function passesLuhnCheck(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

const KOREAN_ADMINISTRATIVE_PREFIX = String.raw`(?:[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|도)\s+)?(?:[가-힣]{1,}(?:시|군|구)\s+){1,2}`;
const KOREAN_ADDRESS_CUE = String.raw`(?:주소|배송지|거주지|사업장)\s*(?:은|는|이|가|:|：)?\s*`;
const KOREAN_ROAD_ADDRESS = new RegExp(
  String.raw`(?<![가-힣])(?:${KOREAN_ADMINISTRATIVE_PREFIX}|${KOREAN_ADDRESS_CUE})[가-힣A-Za-z0-9·.-]{2,}(?:대로|로|길)\s+\d{1,5}(?:-\d{1,5})?(?:\s+\d{1,4}(?:동|호))?`,
  "g",
);
const KOREAN_JIBUN_ADDRESS = new RegExp(
  String.raw`(?<![가-힣])(?:${KOREAN_ADMINISTRATIVE_PREFIX}|${KOREAN_ADDRESS_CUE})[가-힣A-Za-z0-9·.-]{1,}(?:읍|면|동|리)\s+(?:산\s*)?\d{1,5}(?:-\d{1,5})?(?:\s+\d{1,4}(?:동|호))?`,
  "g",
);

const HIGH_RISK_DOCUMENT_MARKER = /(?:대외비|사외비|외부\s*공유\s*금지|외부\s*반출\s*금지|confidential|internal\s+(?:use\s+)?only|non[- ]?disclosure|\bNDA\b)/i;
const UNREDACTED_SECRET = /(?:비밀번호|패스워드|password|api[ _-]?key|access[ _-]?token|secret(?:[ _-]?key)?)\s*[:=：]\s*(?!\[(?:SENSITIVE|REDACTED)\])\S+/i;
const UNREDACTED_NAMED_PERSON = /(?:고객명|담당자명|대표자명|신청인명|수신인명)\s*[:：]?\s*(?!\[NAME\])([가-힣]{2,5}|[A-Za-z][A-Za-z .'-]{1,60})/i;

export function highRiskMaterialIssue(input: string) {
  const text = String(input || "");
  if (HIGH_RISK_DOCUMENT_MARKER.test(text)) {
    return "대외비·외부공유금지 등 민감자료 표시";
  }
  if (UNREDACTED_SECRET.test(text)) {
    return "비밀번호·API 키·접근 토큰 등 비밀값";
  }
  return null;
}

export function sensitiveMaterialIssue(input: string) {
  const text = String(input || "");
  const highRiskIssue = highRiskMaterialIssue(text);
  if (highRiskIssue) return highRiskIssue;
  if (UNREDACTED_NAMED_PERSON.test(text)) {
    return "비식별화되지 않은 이름 표기";
  }
  return null;
}

export function configuredPrivacyTerms(raw = process.env.PII_REDACTION_TERMS) {
  return (raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .slice(0, 100);
}

export function redactPersonalData(
  input: string,
  options: { sensitiveTerms?: string[] } = {},
): PrivacyRedactionResult {
  let text = String(input || "");
  const counts: Partial<Record<RedactionKind, number>> = {};
  const replace = (
    kind: RedactionKind,
    pattern: RegExp,
    replacement: string | ((substring: string, ...args: string[]) => string),
  ) => {
    text = text.replace(pattern, (...args) => {
      counts[kind] = (counts[kind] || 0) + 1;
      return typeof replacement === "string" ? replacement : replacement(...args);
    });
  };

  replace("email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]");
  replace("phone", /(?<!\d)(?:\+?82[- .]?)?(?:0?1[016789]|0?2|0?[3-6][1-5])[- .]?\d{3,4}[- .]?\d{4}(?!\d)/g, "[PHONE]");
  replace("registration", /(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)/g, "[RESIDENT_ID]");
  replace("registration", /(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{5}(?!\d)/g, "[BUSINESS_ID]");
  replace("registration", /(?<!\d)\d{6}[- ]?\d{7}(?!\d)/g, "[CORPORATE_ID]");
  // Run the Luhn-checked card pass before the broader account-number pass so
  // a 4-4-4-4 card is classified and audited as a card, not as an account.
  text = text.replace(/(?<!\d)\d(?:[- ]?\d){12,18}(?!\d)/g, (candidate) => {
    if (!passesLuhnCheck(candidate)) return candidate;
    counts.card = (counts.card || 0) + 1;
    return "[CARD]";
  });
  replace(
    "account",
    /(계좌번호|입금계좌|은행계좌|환불계좌|계좌)\s*[:：]?\s*\d(?:[- ]?\d){7,19}/gi,
    (_match, label) => `${label}: [ACCOUNT]`,
  );
  text = text.replace(/(?<!\d)\d{2,6}(?:-\d{2,6}){2,4}(?!\d)/g, (candidate) => {
    const digitCount = candidate.replace(/\D/g, "").length;
    if (digitCount < 10 || digitCount > 16) return candidate;
    counts.account = (counts.account || 0) + 1;
    return "[ACCOUNT]";
  });
  replace(
    "name",
    /(\uC774\uB984|\uC131\uBA85|\uACE0\uAC1D\uBA85|\uB2F4\uB2F9\uC790|\uB300\uD45C\uC790)\s*[:\uFF1A]\s*([\uAC00-\uD7A3]{2,5}|[A-Za-z][A-Za-z .'-]{1,60})/g,
    (_match, label) => `${label}: [NAME]`,
  );
  replace(
    "address",
    /(\uC8FC\uC18C|\uAC70\uC8FC\uC9C0|\uC0AC\uC5C5\uC7A5)\s*[:\uFF1A]\s*([^\n]{5,120})/g,
    (_match, label) => `${label}: [ADDRESS]`,
  );
  replace("address", KOREAN_ROAD_ADDRESS, "[ADDRESS]");
  replace("address", KOREAN_JIBUN_ADDRESS, "[ADDRESS]");

  const terms = [...new Set([
    ...configuredPrivacyTerms(),
    ...(options.sensitiveTerms || []).map((value) => value.trim()).filter((value) => value.length >= 2),
  ])].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    replace("custom", new RegExp(escapeRegExp(term), "gi"), "[SENSITIVE]");
  }

  return {
    text,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0),
  };
}

export function redactGeminiTextParts<T>(parts: T[]) {
  let total = 0;
  const redacted = parts.map((part) => {
    const partText = (part as { text?: unknown }).text;
    if (typeof partText !== "string") return part;
    const result = redactPersonalData(partText);
    total += result.total;
    return { ...(part as object), text: result.text } as T;
  });
  return { parts: redacted, redactionCount: total };
}
