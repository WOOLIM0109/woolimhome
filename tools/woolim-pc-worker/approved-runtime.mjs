import path from "node:path";
import { pathToFileURL } from "node:url";

const sha256 = /^[a-fA-F0-9]{64}$/;

/** Entries are ordered oldest first; approval comes only from fetched origin/main. */
export function getLatestApprovedRuntime(approvals, platform, arch) {
  if (!Array.isArray(approvals) || approvals.length === 0) throw new Error("PREPARATION_APPROVAL_LIST_INVALID");
  const seen = new Set();
  for (const entry of approvals) {
    if (!entry || typeof entry.fingerprint !== "string" || !sha256.test(entry.fingerprint) || entry.version !== "1.0.0"
      || typeof entry.platform !== "string" || !entry.platform
      || typeof entry.arch !== "string" || !entry.arch || typeof entry.note !== "string") {
      throw new Error("PREPARATION_APPROVAL_LIST_INVALID");
    }
    const key = `${entry.platform}/${entry.arch}/${entry.fingerprint}`;
    if (seen.has(key)) throw new Error("PREPARATION_APPROVAL_LIST_INVALID");
    seen.add(key);
  }
  const approved = approvals.filter((entry) => entry.platform === platform && entry.arch === arch).at(-1);
  if (!approved) throw new Error("PREPARATION_APPROVAL_PLATFORM_MISSING");
  return approved;
}

export function assertApprovedFingerprint(actual, approved) {
  if (typeof actual !== "string" || !sha256.test(actual) || actual !== approved?.fingerprint) {
    throw new Error("PREPARATION_FINGERPRINT_NOT_APPROVED");
  }
  return approved;
}

export function getApprovedRollbackRuntime(approvals, fingerprint) {
  getLatestApprovedRuntime(approvals, "win32", "x64"); // Validate the complete fetched list first.
  return assertApprovedFingerprint(fingerprint, approvals.find((entry) => entry.platform === "win32"
    && entry.arch === "x64" && entry.fingerprint === fingerprint));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (!(args.length === 1 && args[0] === "--latest")
      && !(args.length === 2 && ["--fingerprint", "--rollback-fingerprint"].includes(args[0]))) throw new Error("PREPARATION_APPROVAL_ARGUMENTS_INVALID");
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) input += chunk;
    const approvals = JSON.parse(input.replace(/^\uFEFF/, ""));
    const approved = args[0] === "--rollback-fingerprint" ? getApprovedRollbackRuntime(approvals, args[1])
      : getLatestApprovedRuntime(approvals, "win32", "x64");
    if (args[0] === "--fingerprint") assertApprovedFingerprint(args[1], approved);
    console.log(JSON.stringify(approved));
  } catch (error) {
    const code = error instanceof Error && /^PREPARATION_[A-Z_]+$/.test(error.message)
      ? error.message : "PREPARATION_APPROVAL_LIST_INVALID";
    console.error(code);
    process.exitCode = 1;
  }
}
