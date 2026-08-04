type RedactionKind = "email" | "phone" | "registration" | "address" | "name" | "custom";

export type PrivacyRedactionResult = {
  text: string;
  counts: Partial<Record<RedactionKind, number>>;
  total: number;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
