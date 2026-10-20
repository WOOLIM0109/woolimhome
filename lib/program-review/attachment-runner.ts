import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { createClient } from "@supabase/supabase-js";
import type { createAdminClient } from "../supabase/admin";
import {
  AttachmentTooLarge, MAX_ATTACHMENT_BYTES, attachmentFileName, extractAttachments, fetchAttachmentResource,
  type AttachmentLink,
} from "./attachments";
import {
  AttachmentLimitError, expandZipAttachments, extractAttachmentText,
  type ExpandedAttachment, type TextExtractionResult,
} from "./extract-text";

const BUCKET = "program-attachments";
const RUN_MILLISECONDS = 240_000;
const MAX_PROCESSED = 15;
const MAX_DISCOVERED = 30;
const DETAIL_BYTES = 2 * 1024 * 1024;
const SELECT_ATTACHMENT = "id,program_id,parent_id,file_name,file_ext,source_url,storage_path,sha256,attempts";

type Admin = ReturnType<typeof createAdminClient>;
type Program = { id: string; source_url: string; created_at: string };
type Attachment = {
  id: string; program_id: string; parent_id: string | null; file_name: string; file_ext: string;
  source_url: string; storage_path: string | null; sha256: string | null; attempts: number;
};
type Dependencies = {
  admin: Admin;
  now: () => number;
  fetchResource: typeof fetchAttachmentResource;
  extractText: typeof extractAttachmentText;
  expandZip: typeof expandZipAttachments;
};
type Summary = {
  discovered: number; discoveredAttachments: number; discoveryFailed: number; processed: number;
  extracted: number; noText: number; failed: number; skipped: number; reused: number; expanded: number; deferred: number;
  stoppedForTime: boolean;
};

/** Keep source evidence numbered without including markup, active content, or link attributes. */
export function attachmentDetailText(html: string) {
  const body = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html;
  const text = sanitizeHtml(body.replace(/<(?:br\b[^>]*|\/(?:p|div|li|tr|h[1-6]|section|article))>/gi, "\n"), {
    allowedTags: [], allowedAttributes: {}, nonTextTags: ["script", "style", "textarea", "noscript"],
  }).replace(/&nbsp;|&#160;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, value) => {
      const code = Number(value);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
  return text.slice(0, 200_000).split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean).slice(0, 1000).map((line, index) => `[para.${index + 1}] ${line}`).join("\n\n");
}

function documentMime(ext: string) {
  return ext === "pdf" ? "application/pdf" : ext === "zip" || ext === "hwpx" ? "application/zip"
    : ext === "hwp" ? "application/x-hwp" : "application/octet-stream";
}

function downloadFailure(error: unknown) {
  if (error instanceof AttachmentTooLarge) return "파일당 30MB 초과";
  if (error instanceof Error && /^(?:TimeoutError|AbortError)$/.test(error.name)) return "첨부 다운로드 시간 초과";
  if (error instanceof Error && /^기관 HTTP \d{3}$/.test(error.message)) return error.message;
  return "첨부 다운로드 또는 비공개 저장 실패";
}

function boundedAdmin(now: () => number, end: number) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("비공개 첨부 처리 설정 없음");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(Math.max(1, Math.min(20_000, end - now() - 1_000))),
        ]),
      }),
    },
  });
}

function fanfandaeroDetail(value: unknown) {
  const links: AttachmentLink[] = [];
  const texts: string[] = [];
  let examined = 0;
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 15 || ++examined > 2000) return;
    if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
    const record = node as Record<string, unknown>;
    if (typeof record.itemWonFileNm === "string" && typeof record.fileStreCoursOrg === "string") {
      const name = attachmentFileName(new Headers(), record.itemWonFileNm, new Uint8Array());
      const url = new URL("https://fanfandaero.kr/download.do");
      url.search = new URLSearchParams({ fileName: record.fileStreCoursOrg, wonFileName: record.itemWonFileNm }).toString();
      if (["hwp", "hwpx", "pdf", "zip"].includes(name.fileExt)) {
        links.push({ ...name, sourceUrl: url.href });
      }
    }
    for (const [key, item] of Object.entries(record)) {
      if (typeof item === "string" && item.trim() && !/file|token|secret|key|url|path/i.test(key)) texts.push(item);
      else if (item && typeof item === "object") visit(item, depth + 1);
    }
  };
  visit(value, 0);
  const unique = [...new Map(links.map((link) => [link.sourceUrl, link])).values()].slice(0, 50);
  return { links: unique, html: texts.slice(0, 1000).join("\n") };
}

/** Independent read track: existing program records are only selected, never updated. */
export async function runAttachmentTask(overrides: Partial<Dependencies> = {}) {
  const clock = overrides.now ?? Date.now;
  const started = clock();
  const end = started + RUN_MILLISECONDS;
  const dependencies: Dependencies = {
    admin: overrides.admin ?? boundedAdmin(clock, end), now: clock,
    fetchResource: overrides.fetchResource ?? fetchAttachmentResource,
    extractText: overrides.extractText ?? extractAttachmentText,
    expandZip: overrides.expandZip ?? expandZipAttachments,
  };
  const { admin, now } = dependencies;
  const summary: Summary = {
    discovered: 0, discoveredAttachments: 0, discoveryFailed: 0, processed: 0,
    extracted: 0, noText: 0, failed: 0, skipped: 0, reused: 0, expanded: 0, deferred: 0, stoppedForTime: false,
  };
  const attempted = new Set<string>();
  const zipCache = new Map<string, ExpandedAttachment[]>();
  const date = new Date(started + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const timeLeft = () => end - now();
  const hasTime = () => timeLeft() > 45_000;
  const signal = () => AbortSignal.timeout(Math.max(1, Math.min(20_000, timeLeft() - 1_000)));
  let runId: string | null = null;

  async function updateAttachment(id: string, values: Record<string, unknown>) {
    const { error } = await admin.from("openchat_program_attachments").update(values).eq("id", id).abortSignal(signal());
    if (error) throw new Error("첨부 처리 결과 저장 실패");
  }

  async function finishAttachment(attachment: Attachment, result: TextExtractionResult, values: Record<string, unknown> = {}) {
    await updateAttachment(attachment.id, {
      ...values, text_status: result.status, text_content: result.text || null, text_chars: result.textChars,
      error: result.error, processing_started_at: null, extracted_at: new Date(now()).toISOString(),
    });
    if (result.status === "extracted") summary.extracted++;
    else if (result.status === "no_text") summary.noText++;
    else summary[result.status]++;
  }

  async function discover(program: Program) {
    try {
      const resource = await dependencies.fetchResource(program.source_url, DETAIL_BYTES, Math.min(20_000, timeLeft() - 5_000));
      const encoding = resource.headers.get("content-type")?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] || "utf-8";
      let html: string;
      try { html = new TextDecoder(encoding).decode(resource.bytes); } catch { html = resource.bytes.toString("utf8"); }
      let links = extractAttachments(html, resource.url);
      const source = new URL(program.source_url);
      if (/(^|\.)fanfandaero\.kr$/i.test(source.hostname) && source.searchParams.get("sprtBizCd")) {
        if (!hasTime()) return;
        const detail = await dependencies.fetchResource(
          "https://fanfandaero.kr/portal/v2/selectSprtBizPbancDetailInfoList.do", DETAIL_BYTES,
          Math.min(20_000, timeLeft() - 5_000),
          { method: "POST", body: new URLSearchParams({ sprtBizCd: source.searchParams.get("sprtBizCd")! }) },
        );
        const payload = JSON.parse(detail.bytes.toString("utf8")) as { spinPb?: unknown };
        const parsed = fanfandaeroDetail(payload.spinPb);
        links = [...new Map([...links, ...parsed.links].map((link) => [link.sourceUrl, link])).values()].slice(0, 50);
        html = parsed.html || html;
      }
      if (links.length) {
        const { error } = await admin.from("openchat_program_attachments").upsert(links.map((link) => ({
          program_id: program.id, file_name: link.fileName, file_ext: link.fileExt, source_url: link.sourceUrl,
        })), { onConflict: "program_id,source_url", ignoreDuplicates: true }).abortSignal(signal());
        if (error) throw new Error("첨부 목록 저장 실패");
      }
      const { error } = await admin.from("openchat_program_attachment_discovery").upsert({
        program_id: program.id, status: links.length ? "found" : "none", attachment_count: links.length,
        detail_text: attachmentDetailText(html), error: null, checked_at: new Date(now()).toISOString(),
      }).abortSignal(signal());
      if (error) throw new Error("상세 탐색 결과 저장 실패");
      summary.discovered++;
      summary.discoveredAttachments += links.length;
    } catch {
      summary.discoveryFailed++;
      const { error } = await admin.from("openchat_program_attachment_discovery").upsert({
        program_id: program.id, status: "failed", attachment_count: 0, detail_text: "",
        error: "기관 상세 페이지 조회 또는 첨부 탐색 실패", checked_at: new Date(now()).toISOString(),
      }).abortSignal(signal());
      if (error) throw new Error("상세 탐색 결과 저장 실패");
    }
  }

  async function storedBytes(path: string) {
    const { data, error } = await admin.storage.from(BUCKET).download(path, {}, { signal: signal() });
    if (error || !data) throw new Error("비공개 원본 읽기 실패");
    if (data.size > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLarge();
    return Buffer.from(await data.arrayBuffer());
  }

  async function attachmentBytes(attachment: Attachment) {
    if (attachment.storage_path) return { bytes: await storedBytes(attachment.storage_path), headers: new Headers() };
    if (!attachment.parent_id) {
      return dependencies.fetchResource(attachment.source_url, MAX_ATTACHMENT_BYTES, Math.min(20_000, timeLeft() - 5_000));
    }
    let children = zipCache.get(attachment.parent_id);
    if (!children) {
      const { data, error } = await admin.from("openchat_program_attachments").select("storage_path")
        .eq("id", attachment.parent_id).abortSignal(signal()).single();
      if (error || !data?.storage_path) throw new Error("ZIP 원본 없음");
      children = await dependencies.expandZip(await storedBytes(data.storage_path));
      zipCache.set(attachment.parent_id, children);
    }
    const child = children.find((entry) => entry.fileName === attachment.file_name);
    if (!child) throw new Error("ZIP 하위 첨부 없음");
    return { bytes: child.bytes, headers: new Headers() };
  }

  async function saveOriginal(attachment: Attachment, bytes: Buffer, fileName: string, fileExt: string, sha256: string) {
    if (attachment.storage_path) return attachment.storage_path;
    const storagePath = `${date.slice(0, 4)}/${date.slice(5, 7)}/${attachment.program_id}/${encodeURIComponent(fileName)}`;
    const { error } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      upsert: false, contentType: documentMime(fileExt),
    });
    if (error) {
      // An identical filename never overwrites a different previously stored original.
      const { data, error: lookupError } = await admin.from("openchat_program_attachments").select("id")
        .eq("storage_path", storagePath).eq("sha256", sha256).limit(1).abortSignal(signal());
      if (lookupError || !data?.length) throw new Error("첨부 원본 저장 실패");
    }
    return storagePath;
  }

  async function process(attachment: Attachment) {
    attempted.add(attachment.id);
    const { data: claimed, error: claimError } = await admin.rpc("claim_openchat_attachment", { attachment_id: attachment.id }).abortSignal(signal());
    if (claimError) throw new Error("첨부 처리 잠금 실패");
    if (!claimed?.length) return false;
    attachment = claimed[0] as Attachment;
    summary.processed++;
    async function defer(values: Record<string, unknown> = {}) {
      await updateAttachment(attachment.id, {
        ...values, text_status: "pending", processing_started_at: null, attempts: Math.max(0, attachment.attempts - 1),
      });
      summary.deferred++;
    }
    try {
      if (!hasTime()) { await defer(); return true; }
      const resource = await attachmentBytes(attachment);
      if (resource.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLarge();
      const name = attachment.parent_id
        ? { fileName: attachment.file_name, fileExt: attachment.file_ext }
        : attachmentFileName(resource.headers, attachment.file_name, resource.bytes);
      const sha256 = createHash("sha256").update(resource.bytes).digest("hex");
      if (!hasTime()) { await defer(); return true; }
      const storagePath = await saveOriginal(attachment, resource.bytes, name.fileName, name.fileExt, sha256);
      const metadata = {
        storage_path: storagePath, byte_size: resource.bytes.byteLength, sha256, file_ext: name.fileExt, file_name: name.fileName,
      };
      if (!hasTime()) { await defer(metadata); return true; }
      await updateAttachment(attachment.id, metadata);
      if (!hasTime()) { await defer(); return true; }
      if (name.fileExt === "zip") {
        const children = await dependencies.expandZip(resource.bytes);
        zipCache.set(attachment.id, children);
        if (children.length) {
          const { error } = await admin.from("openchat_program_attachments").upsert(children.map((child) => ({
            program_id: attachment.program_id, parent_id: attachment.id, file_name: child.fileName,
            file_ext: child.fileExt, source_url: `zip:${attachment.id}:${encodeURIComponent(child.fileName)}`,
          })), { onConflict: "program_id,source_url", ignoreDuplicates: true }).abortSignal(signal());
          if (error) throw new Error("ZIP 하위 첨부 등록 실패");
        }
        summary.expanded += children.length;
        await finishAttachment(attachment, {
          status: "skipped", text: "", textChars: 0,
          error: children.length ? "ZIP 개별 첨부로 분리" : "ZIP 내 지원 문서 없음",
        });
        return true;
      }
      const { data: cached, error: cacheError } = await admin.from("openchat_program_attachments")
        .select("text_status,text_content,text_chars,error").eq("sha256", sha256).neq("id", attachment.id)
        .in("text_status", ["extracted", "no_text"]).limit(1).abortSignal(signal());
      if (cacheError) throw new Error("추출 결과 재사용 조회 실패");
      if (!hasTime()) { await defer(); return true; }
      if (cached?.length) {
        const previous = cached[0];
        await finishAttachment(attachment, {
          status: previous.text_status, text: previous.text_content || "", textChars: previous.text_chars, error: previous.error,
        });
        summary.reused++;
      } else {
        await finishAttachment(attachment, await dependencies.extractText(resource.bytes, name.fileExt));
      }
    } catch (error) {
      const limited = error instanceof AttachmentTooLarge || error instanceof AttachmentLimitError;
      await finishAttachment(attachment, {
        status: limited ? "skipped" : "failed", text: "", textChars: 0,
        error: error instanceof AttachmentLimitError ? "ZIP 또는 문서 안전 크기·경로 제한 초과" : downloadFailure(error),
      });
    }
    return true;
  }

  try {
    const { data: run, error: runError } = await admin.from("openchat_run_logs")
      .insert({ task: "attachments", status: "running" }).select("id").abortSignal(signal()).single();
    if (runError || !run) throw new Error("첨부 실행 기록 생성 실패");
    runId = run.id;
    const { data: bucket, error: bucketError } = await admin.storage.getBucket(BUCKET);
    if (bucketError || !bucket || bucket.public !== false) throw new Error("비공개 첨부 저장소 확인 실패");

    // Cursor through all eligible stored notices without modifying the publication queue.
    let cursor: { created_at: string; id: string } | null = null;
    let done = false;
    while (!done && hasTime() && summary.processed < MAX_PROCESSED) {
      const deadlineFilter = `deadline_at.is.null,deadline_at.gte.${new Date(now()).toISOString()}`;
      const eligibleFilter = cursor
        ? `and(or(${deadlineFilter}),or(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})))`
        : deadlineFilter;
      const query = admin.from("openchat_programs").select("id,source_url,created_at")
        .neq("status", "excluded").or(eligibleFilter)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
      const { data, error } = await query.abortSignal(signal());
      if (error) throw new Error("첨부 대상 공고 조회 실패");
      const programs = (data || []) as Program[];
      done = programs.length < 100;
      if (!programs.length) break;
      cursor = programs[programs.length - 1];
      const { data: checks, error: checksError } = await admin.from("openchat_program_attachment_discovery")
        .select("program_id,status,checked_at").in("program_id", programs.map((program) => program.id)).abortSignal(signal());
      if (checksError) throw new Error("첨부 탐색 이력 조회 실패");
      const discovered = new Map((checks || []).map((check) => [check.program_id, check]));
      for (const program of programs) {
        if (!hasTime() || summary.processed >= MAX_PROCESSED) break;
        const check = discovered.get(program.id);
        if (summary.discovered + summary.discoveryFailed < MAX_DISCOVERED
          && (!check || check.status === "failed" || now() - Date.parse(check.checked_at) >= 24 * 60 * 60 * 1000)) {
          await discover(program);
        }
        // Requery after ZIP expansion; unprocessed children remain pending for the next invocation.
        while (hasTime() && summary.processed < MAX_PROCESSED) {
          const { data: pending, error: pendingError } = await admin.from("openchat_program_attachments")
            .select(SELECT_ATTACHMENT).eq("program_id", program.id).in("text_status", ["pending", "failed"])
            .lt("attempts", 3).order("created_at").limit(100).abortSignal(signal());
          if (pendingError) throw new Error("미처리 첨부 조회 실패");
          const next = (pending || []).filter((item) => !attempted.has(item.id)) as Attachment[];
          if (!next.length) break;
          for (const attachment of next) {
            if (!hasTime() || summary.processed >= MAX_PROCESSED) break;
            await process(attachment);
          }
        }
      }
    }
    summary.stoppedForTime = !hasTime();
    const { error } = await admin.from("openchat_run_logs").update({
      status: "completed", summary: { date, ...summary }, error: null, finished_at: new Date(now()).toISOString(),
    }).eq("id", runId).abortSignal(signal());
    if (error) throw new Error("첨부 실행 결과 저장 실패");
    return { task: "attachments" as const, status: "completed" as const, date, ...summary };
  } catch {
    if (runId) {
      await admin.from("openchat_run_logs").update({
        status: "failed", summary: { date, ...summary }, error: "첨부 수집 작업 실패",
        finished_at: new Date(now()).toISOString(),
      }).eq("id", runId).abortSignal(AbortSignal.timeout(5_000));
    }
    throw new Error("첨부 수집 작업 실패");
  }
}
