import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const base = resolve(root, ".codex-tmp");
mkdirSync(base, { recursive: true });
const directory = mkdtempSync(resolve(base, "report-export-tests-"));
after(() => {
  const inside = relative(base, directory);
  assert.ok(inside && !inside.startsWith("..") && !isAbsolute(inside));
  rmSync(directory, { recursive: true, force: true });
});
let next = 0;
function run(kind, input, { output = resolve(directory, `report-${++next}.md`), count = 10 } = {}) {
  const args = kind === "customer" ? ["scripts/program-review-customer-report.mjs", output]
    : ["scripts/program-review-evidence-report.mjs", "--output", output, "--count", String(count)];
  const result = spawnSync(process.execPath, args, { cwd: root, input: input + "\n", encoding: "utf8", timeout: 15_000 });
  assert.ifError(result.error);
  return { ...result, output };
}
const customer = () => ({ name: "synthetic-private-customer", candidate: 0, unknown: 1, mismatch: 0, top_matches: [{
  title: "Public fixture notice", verdict: "unknown", score: 5, deadline_at: "2026-12-01T00:00:00Z",
  selected_for_reading: false, reasons: ["Information unavailable"],
}] });
function publicRows(amount = 10) {
  return Array.from({ length: amount }, (_, index) => ({ id: `public-fixture-${index}`, title: "Public fixture notice",
    source_url: "https://agency.example/notice?id=public-fixture", detail_text: "[para.1] Public notice fixture.",
    attachments: [{ id: `attachment-${index}`, file_name: "public.pdf", text_content: "[p.1] Public fixture document.", text_status: "extracted" }],
    requirements: { regions: null, target_types: null, business_age: null, size: null, industries_included: null,
      industries_excluded: null, required_certifications: null, bonus_points: null, support_amount_text: null,
      self_pay_text: null, deadline_at: null, submission_documents: null, evaluation: null, contact: null, evidence: null },
  }));
}
function rejected(result, marker = "synthetic-private-customer") {
  assert.equal(result.status, 1);
  assert.equal(existsSync(result.output), false);
  assert.ok(!result.stdout.includes(marker) && !result.stderr.includes(marker));
}

test("customer export writes a valid private report and stdout contains metadata only", () => {
  const result = run("customer", JSON.stringify([customer()]));
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).customerCount, 1);
  assert.ok(!result.stdout.includes(customer().name));
  assert.match(readFileSync(result.output, "utf8"), /synthetic-private-customer/);
});

test("customer export rejects malformed JSON, missing arrays and wrong count types without echoing input", () => {
  rejected(run("customer", '[{"name":"synthetic-private-customer","candidate":}]'));
  const missing = customer(); delete missing.top_matches;
  rejected(run("customer", JSON.stringify([missing])));
  rejected(run("customer", JSON.stringify([{ ...customer(), candidate: "1" }])));
  rejected(run("customer", JSON.stringify([{ ...customer(), top_matches: [null] }])));
});

test("decoded Unicode-escaped fake credentials are rejected before either report is written", () => {
  // Deliberately synthetic credential-shaped text; no actual credential is loaded.
  const marker = "AIza" + "FAKEONLY".repeat(6);
  const encode = value => JSON.stringify(value).replace(marker, "\\u0041" + marker.slice(1));
  rejected(run("customer", encode([{ ...customer(), name: marker }])), marker);
  const rows = publicRows(); rows[0].title = marker;
  rejected(run("evidence", encode(rows)), marker);
});

test("both report exporters refuse output paths outside the ignored temporary directory", () => {
  const output = resolve(root, `report-outside-ignored-${process.pid}.md`);
  rejected(run("customer", JSON.stringify([customer()]), { output }));
  rejected(run("evidence", JSON.stringify(publicRows()), { output }));
});

test("evidence exporter creates all ten public fixtures and refuses an incomplete sample", () => {
  const result = run("evidence", JSON.stringify(publicRows()));
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.successCount, 10);
  assert.equal(summary.mismatchCount, 0);
  assert.match(readFileSync(result.output, "utf8"), /public-fixture-9/);
  rejected(run("evidence", JSON.stringify(publicRows(9))));
});
