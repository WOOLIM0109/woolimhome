import { createHash } from "node:crypto";

/** JSONB does not preserve object insertion order. Snapshot transport hashes
 * sort object keys recursively, while retaining every array position/value.
 * This is deliberately separate from all frozen renderer/title fingerprints. */
export function productionSnapshotCanonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function serialize(input: unknown, depth: number): string {
    if (depth > 64) throw new Error("MOCKUP_DESCRIPTOR_INVALID");
    if (input === null || typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
    if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
    if (!input || typeof input !== "object" || ancestors.has(input)) throw new Error("MOCKUP_DESCRIPTOR_INVALID");
    ancestors.add(input);
    try {
      if (Array.isArray(input)) return `[${Array.from(input, item => serialize(item, depth + 1)).join(",")}]`;
      const object = input as Record<string, unknown>;
      return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${serialize(object[key], depth + 1)}`).join(",")}}`;
    } finally { ancestors.delete(input); }
  }
  return serialize(value, 0);
}

export function productionSnapshotHash(value: unknown): string {
  return createHash("sha256").update(productionSnapshotCanonicalJson(value)).digest("hex");
}
