import { spawn } from "node:child_process";
import path from "node:path";
import type { ApprovedMockupRenderOptions, ApprovedMockupRenderResult } from "./approved-16x9-renderer.ts";
import { APPROVED_MOCKUP_SUITES, approvedMockupSuiteTemplates } from "./approved-mockup-suites.ts";

const MAX_INPUT = 96 * 1024 * 1024;
const MAX_OUTPUT = 18 * 1024 * 1024;

/** Only legacy server callers use this boundary. Frozen source renderer/runtime
 * bytes stay unchanged for existing local review receipts. Traced source files
 * execute under Node rather than Turbopack's rewritten import.meta URLs. */
export async function renderProductionApprovedMockup(input: ApprovedMockupRenderOptions): Promise<ApprovedMockupRenderResult> {
  const template = APPROVED_MOCKUP_SUITES.flatMap(approvedMockupSuiteTemplates).find(t => t.id === input.template.id);
  if (!template || JSON.stringify(template) !== JSON.stringify(input.template) || input.runtimeRoot !== undefined
    || !Array.isArray(input.slides) || !input.slides.length || input.slides.length > 40
    || input.slides.some(s => !Number.isSafeInteger(s.index) || s.index < 0 || !Buffer.isBuffer(s.buffer) || s.buffer.length > 12 * 1024 * 1024)
    || (input.title !== undefined && input.title !== null && (typeof input.title !== "string" || input.title.length > 1000))) {
    throw new Error("APPROVED_SERVER_RENDER_INPUT_INVALID");
  }
  const payload = JSON.stringify({ templateId: template.id, templateVersion: template.version,
    slides: input.slides.map(s => ({ index: s.index, base64: s.buffer.toString("base64") })),
    title: input.title ?? null, scale: input.scale ?? 1, outputFormat: input.outputFormat ?? "jpeg" });
  if (Buffer.byteLength(payload) > MAX_INPUT) throw new Error("APPROVED_SERVER_RENDER_INPUT_TOO_LARGE");
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", GEMINI_ENABLED: "false", GEMINI_ALLOW_NON_PRODUCTION: "false" };
    for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LD_LIBRARY_PATH"]) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(process.execPath, ["--experimental-strip-types", path.resolve(process.cwd(), "scripts/render-production-approved-mockup.mjs")],
      { cwd: process.cwd(), windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"] });
    let settled = false, size = 0; const chunks: Buffer[] = [];
    const stop = (code: string) => { if (settled) return; settled = true; clearTimeout(timeout); child.kill(); reject(new Error(code)); };
    const timeout = setTimeout(() => stop("APPROVED_SERVER_RENDER_TIMEOUT"), 120_000);
    child.on("error", () => stop("APPROVED_SERVER_RENDER_UNAVAILABLE"));
    child.stdin.on("error", () => stop("APPROVED_SERVER_RENDER_INPUT_FAILED"));
    child.stderr.resume(); // Never return native error text or customer title/image bytes.
    child.stdout.on("data", chunk => { size += chunk.length; if (size > MAX_OUTPUT) stop("APPROVED_SERVER_RENDER_OUTPUT_TOO_LARGE"); else chunks.push(Buffer.from(chunk)); });
    child.on("close", code => {
      clearTimeout(timeout); if (settled) return;
      if (code !== 0) { stop("APPROVED_SERVER_RENDER_FAILED"); return; }
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const bytes = Buffer.from(result.base64, "base64"), scale = input.scale ?? 1;
        if (!bytes.length || bytes.length > 12 * 1024 * 1024 || result.templateId !== template.id || result.templateVersion !== template.version
          || result.outputName !== template.outputName || result.width !== Math.round(template.canvas.width * scale)
          || result.height !== Math.round(template.canvas.height * scale) || !Array.isArray(result.slotAssignments)) throw new Error();
        delete result.base64; settled = true; resolve({ ...result, bytes });
      } catch { stop("APPROVED_SERVER_RENDER_RESULT_INVALID"); }
    });
    child.stdin.end(payload);
  });
}
