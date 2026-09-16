import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export type LocalPowerPointFontFamily = {
  english: string | null;
  korean: string | null;
};

export type LocalPowerPointRuntime = {
  available: boolean;
  powerPointVersion: string | null;
  registeredClass: string | null;
  fontInventory: {
    familyCount: number;
    families: LocalPowerPointFontFamily[];
    fileCount: number;
    fileListHash: string;
    fingerprint: string;
  };
};

export type LocalPowerPointSlideExport = {
  sourceSlideNumber: number;
  path: string;
  width: number;
  height: number;
};

export type LocalPowerPointExportInput = {
  /** The original is hashed and copied, but is never opened or saved by PowerPoint. */
  sourcePath: string;
  sourceHash: string;
  /** An attempt-{uuid} child is created below this caller-owned directory. */
  outputDirectory: string;
  /** Original, one-based PowerPoint slide numbers, in export order. */
  slideNumbers: readonly number[];
  longEdge: 800 | 2400;
  /** OOXML preflight dimensions, in PowerPoint points. Checked before any slide is exported. */
  expectedSlideWidth?: number;
  expectedSlideHeight?: number;
};

export type LocalPowerPointExportResult = {
  sourceHash: string;
  outputDirectory: string;
  slideCount: number;
  sourceSlideNumbers: number[];
  slideWidth: number;
  slideHeight: number;
  exportWidth: number;
  exportHeight: number;
  slides: LocalPowerPointSlideExport[];
};

export type PowerPointProcessInvocation = {
  command: string;
  args: readonly string[];
  onStdoutLine: (line: string) => Promise<void>;
  /** Tests can exercise the same shutdown path without waiting three minutes. */
  timeoutMs?: number;
};

export type PowerPointProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
};

export type PowerPointProcessRunner = (
  invocation: PowerPointProcessInvocation,
) => Promise<PowerPointProcessResult>;

export type LocalPowerPointAdapterOptions = {
  scriptPath?: string;
  powershellPath?: string;
  runProcess?: PowerPointProcessRunner;
};

export type LocalPowerPointExportOptions = LocalPowerPointAdapterOptions & {
  /** Called and awaited in the same order as the requested source slide numbers. */
  onSlide?: (slide: LocalPowerPointSlideExport) => void | Promise<void>;
};

export class LocalPowerPointAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalPowerPointAdapterError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_STDERR_LENGTH = 8_192;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function protocolError(code: string, message: string): never {
  throw new LocalPowerPointAdapterError(code, message);
}

function shortDiagnostic(value: unknown) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, MAX_STDERR_LENGTH);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    protocolError("INVALID_PROTOCOL_OUTPUT", `${label} is not a positive integer.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    protocolError("INVALID_PROTOCOL_OUTPUT", `${label} is not a non-negative integer.`);
  }
  return Number(value);
}

function finitePositive(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    protocolError("INVALID_PROTOCOL_OUTPUT", `${label} is not a positive finite number.`);
  }
  return value;
}

function parseProtocolLine(line: string): JsonRecord | null {
  if (!line.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    protocolError("INVALID_PROTOCOL_OUTPUT", "PowerPoint preparation returned a non-JSON stdout line.");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    protocolError("INVALID_PROTOCOL_OUTPUT", "PowerPoint preparation returned an invalid protocol record.");
  }
  if (value.type === "error") {
    const code = stringOrNull(value.code) || "POWERPOINT_PREPARATION_FAILED";
    const message = stringOrNull(value.message) || "Local PowerPoint preparation failed.";
    protocolError(code, message);
  }
  return value;
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function defaultScriptPath() {
  return path.resolve(process.cwd(), "tools", "woolim-pc-worker", "prepare-slides.ps1");
}

export const runPowerPointProcess: PowerPointProcessRunner = async (invocation) => {
  const child = spawn(invocation.command, [...invocation.args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_STDERR_LENGTH) {
      stderr += chunk.slice(0, MAX_STDERR_LENGTH - stderr.length);
    }
  });

  const closed = new Promise<PowerPointProcessResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr }));
  });
  let stopping = false;
  let timeoutError: LocalPowerPointAdapterError | null = null;
  const consumeLines = async () => {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (stopping) break;
      await invocation.onStdoutLine(line);
    }
  };
  const stop = () => {
    stopping = true;
    if (!child.killed) child.kill();
    child.stdout.destroy();
  };
  const timeout = setTimeout(() => {
    timeoutError = new LocalPowerPointAdapterError("POWERPOINT_TIMEOUT", "Local conversion timed out. Completed pages are saved. If PowerPoint remains open, close that session before resuming; no retry was started.");
    stop();
  }, invocation.timeoutMs ?? 180_000);
  const consuming = consumeLines();
  try {
    const [, result] = await Promise.all([consuming, closed]);
    if (timeoutError) throw timeoutError;
    return result;
  } catch (error) {
    stop();
    // Keep the caller's work lock until the process is closed AND an in-flight
    // checkpoint has settled. No callback may outlive this rejected promise.
    await Promise.allSettled([consuming, closed]);
    throw timeoutError ?? error;
  } finally {
    clearTimeout(timeout);
  }
};

export async function getLocalPowerPointConverterFingerprint() {
  const digest = createHash("sha256").update("woolim-local-powerpoint-protocol-1");
  for (const source of [fileURLToPath(import.meta.url), defaultScriptPath()]) digest.update(await readFile(source));
  return digest.digest("hex");
}

async function invokePowerPointProtocol(
  request: JsonRecord,
  onRecord: (record: JsonRecord) => void | Promise<void>,
  options: LocalPowerPointAdapterOptions,
) {
  const requestDirectory = await mkdtemp(path.join(tmpdir(), "woolim-powerpoint-request-"));
  const requestPath = path.join(requestDirectory, "request.json");
  await writeFile(requestPath, JSON.stringify(request), { encoding: "utf8", mode: 0o600 });
  const runner = options.runProcess || runPowerPointProcess;
  const command = options.powershellPath || "powershell.exe";
  const scriptPath = path.resolve(options.scriptPath || defaultScriptPath());
  let sawRecord = false;
  try {
    const result = await runner({
      command,
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-RequestPath",
        requestPath,
      ],
      onStdoutLine: async (line) => {
        const record = parseProtocolLine(line);
        if (!record) return;
        sawRecord = true;
        await onRecord(record);
      },
    });
    if (result.exitCode !== 0) {
      const detail = shortDiagnostic(result.stderr);
      protocolError(
        "POWERPOINT_PROCESS_FAILED",
        detail || `PowerPoint preparation exited with code ${String(result.exitCode)}.`,
      );
    }
    if (!sawRecord) {
      protocolError("MISSING_PROTOCOL_OUTPUT", "PowerPoint preparation returned no protocol records.");
    }
  } catch (error) {
    if (error instanceof LocalPowerPointAdapterError) throw error;
    protocolError("POWERPOINT_PROCESS_FAILED", shortDiagnostic(error) || "PowerPoint preparation could not run.");
  } finally {
    await rm(requestDirectory, { recursive: true, force: true });
  }
}

function parseFontFamily(value: unknown): LocalPowerPointFontFamily {
  if (!isRecord(value)) {
    protocolError("INVALID_PROTOCOL_OUTPUT", "The font inventory contains an invalid family record.");
  }
  const english = stringOrNull(value.english);
  const korean = stringOrNull(value.korean);
  if (!english && !korean) {
    protocolError("INVALID_PROTOCOL_OUTPUT", "The font inventory contains an unnamed family.");
  }
  return { english, korean };
}

/**
 * Reads PowerPoint registration and the local font inventory without launching
 * PowerPoint. The helper never reads project .env files or contacts a server.
 */
export async function getLocalPowerPointRuntime(
  options: LocalPowerPointAdapterOptions = {},
): Promise<LocalPowerPointRuntime> {
  let complete: LocalPowerPointRuntime | null = null;
  await invokePowerPointProtocol({ operation: "inventory" }, async (record) => {
    if (complete) {
      protocolError("INVALID_PROTOCOL_OUTPUT", "Inventory returned records after completion.");
    }
    if (record.type !== "complete" || record.operation !== "inventory") {
      protocolError("INVALID_PROTOCOL_OUTPUT", "Inventory returned an unexpected protocol record.");
    }
    if (typeof record.available !== "boolean" || !isRecord(record.fontInventory)) {
      protocolError("INVALID_PROTOCOL_OUTPUT", "Inventory completion is missing runtime information.");
    }
    const inventory = record.fontInventory;
    if (!Array.isArray(inventory.families)) {
      protocolError("INVALID_PROTOCOL_OUTPUT", "Inventory completion is missing font families.");
    }
    const families = inventory.families.map(parseFontFamily);
    const familyCount = nonNegativeInteger(inventory.familyCount, "fontInventory.familyCount");
    if (familyCount !== families.length) {
      protocolError("INVALID_PROTOCOL_OUTPUT", "The font family count does not match the returned list.");
    }
    const fileListHash = stringOrNull(inventory.fileListHash);
    const fingerprint = stringOrNull(inventory.fingerprint);
    if (!fileListHash || !SHA256_PATTERN.test(fileListHash)
      || !fingerprint || !SHA256_PATTERN.test(fingerprint)) {
      protocolError("INVALID_PROTOCOL_OUTPUT", "The font inventory hashes are invalid.");
    }
    complete = {
      available: record.available,
      powerPointVersion: stringOrNull(record.powerPointVersion),
      registeredClass: stringOrNull(record.registeredClass),
      fontInventory: {
        familyCount,
        families,
        fileCount: nonNegativeInteger(inventory.fileCount, "fontInventory.fileCount"),
        fileListHash: fileListHash.toLowerCase(),
        fingerprint: fingerprint.toLowerCase(),
      },
    };
  }, options);
  if (!complete) {
    protocolError("MISSING_COMPLETION", "PowerPoint inventory did not return a completion record.");
  }
  return complete;
}

function validateExportInput(input: LocalPowerPointExportInput) {
  if (!path.isAbsolute(input.sourcePath)) {
    protocolError("INVALID_SOURCE_PATH", "The PowerPoint source path must be absolute.");
  }
  if (!SHA256_PATTERN.test(input.sourceHash)) {
    protocolError("INVALID_SOURCE_HASH", "The PowerPoint source hash must be SHA-256.");
  }
  if (!path.isAbsolute(input.outputDirectory)) {
    protocolError("INVALID_OUTPUT_DIRECTORY", "The export output directory must be absolute.");
  }
  if (input.longEdge !== 800 && input.longEdge !== 2400) {
    protocolError("INVALID_LONG_EDGE", "The export long edge must be 800 or 2400 pixels.");
  }
  if (input.expectedSlideWidth !== undefined || input.expectedSlideHeight !== undefined) {
    finitePositive(input.expectedSlideWidth,"expectedSlideWidth");
    finitePositive(input.expectedSlideHeight,"expectedSlideHeight");
  }
  if (!input.slideNumbers.length || input.slideNumbers.length > 10_000) {
    protocolError("INVALID_SLIDE_NUMBERS", "Between 1 and 10000 requested slide numbers are required.");
  }
  const unique = new Set<number>();
  input.slideNumbers.forEach((slideNumber) => {
    if (!Number.isSafeInteger(slideNumber) || slideNumber < 1 || unique.has(slideNumber)) {
      protocolError("INVALID_SLIDE_NUMBERS", "Requested slide numbers must be unique, positive, one-based integers.");
    }
    unique.add(slideNumber);
  });
}

function parseSlideRecord(record: JsonRecord, attemptDirectory: string): LocalPowerPointSlideExport {
  if (record.type !== "slide") {
    protocolError("INVALID_PROTOCOL_OUTPUT", "Export returned an unexpected protocol record.");
  }
  const sourceSlideNumber = positiveInteger(record.sourceSlideNumber, "sourceSlideNumber");
  const outputPath = stringOrNull(record.path);
  if (!outputPath || !path.isAbsolute(outputPath)) {
    protocolError("INVALID_PROTOCOL_OUTPUT", "A slide record contains an invalid output path.");
  }
  const resolvedPath = path.resolve(outputPath);
  if (!isPathInside(attemptDirectory, resolvedPath)) {
    protocolError("OUTPUT_PATH_ESCAPE", "A slide output path escaped its unique attempt directory.");
  }
  return {
    sourceSlideNumber,
    path: resolvedPath,
    width: positiveInteger(record.width, "slide.width"),
    height: positiveInteger(record.height, "slide.height"),
  };
}

/**
 * Exports only the requested source slides. Each completed slide callback is
 * awaited before the next JSON-line is consumed, so callers can checkpoint in
 * source-slide order without starting a second PowerPoint export.
 */
export async function exportLocalPowerPointSlides(
  input: LocalPowerPointExportInput,
  options: LocalPowerPointExportOptions = {},
): Promise<LocalPowerPointExportResult> {
  validateExportInput(input);
  const sourcePath = path.resolve(input.sourcePath);
  const outputRoot = path.resolve(input.outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const attemptDirectory = path.join(outputRoot, `attempt-${randomUUID()}`);
  await mkdir(attemptDirectory, { recursive: false });
  const sourceHash = input.sourceHash.toLowerCase();
  const slides: LocalPowerPointSlideExport[] = [];
  let completeRecord: JsonRecord | null = null;

  await invokePowerPointProtocol({
    operation: "export",
    sourcePath,
    sourceHash,
    outputRoot,
    outputDirectory: attemptDirectory,
    slideNumbers: [...input.slideNumbers],
    longEdge: input.longEdge,
    expectedSlideWidth: input.expectedSlideWidth,
    expectedSlideHeight: input.expectedSlideHeight,
  }, async (record) => {
    if (completeRecord) {
      protocolError("INVALID_PROTOCOL_OUTPUT", "Export returned records after completion.");
    }
    if (record.type === "complete") {
      if (record.operation !== "export") {
        protocolError("INVALID_PROTOCOL_OUTPUT", "Export returned the wrong completion operation.");
      }
      completeRecord = record;
      return;
    }

    const slide = parseSlideRecord(record, attemptDirectory);
    const expectedSlideNumber = input.slideNumbers[slides.length];
    if (slide.sourceSlideNumber !== expectedSlideNumber) {
      protocolError("SLIDE_ORDER_MISMATCH", "PowerPoint returned a slide outside the requested export order.");
    }
    const outputFile = await stat(slide.path).catch(() => null);
    if (!outputFile?.isFile() || outputFile.size <= 1024) {
      protocolError("MISSING_SLIDE_OUTPUT", "A reported slide PNG is missing or incomplete.");
    }
    slides.push(slide);
    await options.onSlide?.(slide);
  }, options);

  if (!completeRecord) {
    protocolError("MISSING_COMPLETION", "PowerPoint export did not return a completion record.");
  }
  const completion = completeRecord as JsonRecord;
  const completedOutputDirectory = stringOrNull(completion.outputDirectory);
  if (!completedOutputDirectory
    || path.resolve(completedOutputDirectory) !== path.resolve(attemptDirectory)) {
    protocolError("INVALID_PROTOCOL_OUTPUT", "Export completion contains the wrong attempt directory.");
  }
  const completedSourceHash = stringOrNull(completion.sourceHash);
  if (!completedSourceHash || completedSourceHash.toLowerCase() !== sourceHash) {
    protocolError("SOURCE_HASH_MISMATCH", "Export completion contains the wrong source hash.");
  }
  const slideCount = nonNegativeInteger(completion.slideCount, "slideCount");
  if (slideCount !== slides.length || slides.length !== input.slideNumbers.length) {
    protocolError("SLIDE_COUNT_MISMATCH", "PowerPoint did not complete every requested slide export.");
  }
  if (!Array.isArray(completion.sourceSlideNumbers)
    || completion.sourceSlideNumbers.length !== input.slideNumbers.length
    || completion.sourceSlideNumbers.some((value, index) => value !== input.slideNumbers[index])) {
    protocolError("SLIDE_ORDER_MISMATCH", "Export completion contains the wrong source slide order.");
  }
  const slideWidth = finitePositive(completion.slideWidth, "slideWidth");
  const slideHeight = finitePositive(completion.slideHeight, "slideHeight");
  const exportWidth = positiveInteger(completion.exportWidth, "exportWidth");
  const exportHeight = positiveInteger(completion.exportHeight, "exportHeight");
  if (Math.max(exportWidth, exportHeight) !== input.longEdge
    || slides.some((slide) => slide.width !== exportWidth || slide.height !== exportHeight)) {
    protocolError("PAGE_SETUP_MISMATCH", "Exported slide dimensions do not match the requested long edge.");
  }

  return {
    sourceHash,
    outputDirectory: attemptDirectory,
    slideCount,
    sourceSlideNumbers: [...input.slideNumbers],
    slideWidth,
    slideHeight,
    exportWidth,
    exportHeight,
    slides,
  };
}
