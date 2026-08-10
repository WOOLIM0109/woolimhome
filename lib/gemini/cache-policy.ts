type RecordValue = Record<string, unknown>;

export type StoredGeminiReviewRow = {
  id: string;
  status: "passed" | "needs_revision" | "failed";
  issues: string[];
  suggestedContent: string;
};

export type StoredGeminiReviewResult = {
  results: StoredGeminiReviewRow[];
  failedItemIds: string[];
};

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function resultEnvelope(value: unknown) {
  const outer = record(value);
  if (!outer) return null;
  return Array.isArray(outer.results) ? outer : record(outer.result);
}

function normalizeRow(value: unknown): StoredGeminiReviewRow | null {
  const row = record(value);
  if (!row) return null;
  const id = typeof row.id === "string" ? row.id : "";
  const status = row.status;
  if (!id || (status !== "passed" && status !== "needs_revision" && status !== "failed")) return null;
  return {
    id,
    status,
    issues: Array.isArray(row.issues) ? row.issues.map(String).filter(Boolean).slice(0, 12) : [],
    suggestedContent: typeof row.suggestedContent === "string"
      ? row.suggestedContent.slice(0, 30_000)
      : "",
  };
}

export function storedGeminiReviewResult(value: unknown): StoredGeminiReviewResult | null {
  const envelope = resultEnvelope(value);
  if (!envelope || !Array.isArray(envelope.results)) return null;
  const results = envelope.results.map(normalizeRow).filter((row): row is StoredGeminiReviewRow => Boolean(row));
  if (results.length !== envelope.results.length) return null;
  return {
    results,
    failedItemIds: results.filter((row) => row.status === "failed").map((row) => row.id),
  };
}

export function reusableGeminiReviewRows(value: unknown) {
  return (storedGeminiReviewResult(value)?.results || []).filter(
    (row) => row.status === "passed" || row.status === "needs_revision",
  );
}

export function isReusableGeminiReviewCache(value: unknown) {
  const envelope = resultEnvelope(value);
  const result = storedGeminiReviewResult(value);
  return Boolean(
    result
      && result.results.length > 0
      && Array.isArray(envelope?.failedItemIds)
      && envelope.failedItemIds.length === 0
      && result.failedItemIds.length === 0,
  );
}

export function mergeGeminiReviewResults(
  providerIds: string[],
  ...sources: Array<Iterable<StoredGeminiReviewRow>>
): StoredGeminiReviewResult {
  const wanted = new Set(providerIds);
  const byId = new Map<string, StoredGeminiReviewRow>();
  for (const source of sources) {
    for (const row of source) {
      if (wanted.has(row.id)) byId.set(row.id, row);
    }
  }
  const results = providerIds.map((id): StoredGeminiReviewRow => byId.get(id) || {
    id,
    status: "failed",
    issues: [],
    suggestedContent: "",
  });
  return {
    results,
    failedItemIds: results.filter((row) => row.status === "failed").map((row) => row.id),
  };
}

export function pendingGeminiProviderIds(providerIds: string[], recovered: Iterable<StoredGeminiReviewRow>) {
  const reusable = new Set([...recovered]
    .filter((row) => row.status === "passed" || row.status === "needs_revision")
    .map((row) => row.id));
  return providerIds.filter((id) => !reusable.has(id));
}
