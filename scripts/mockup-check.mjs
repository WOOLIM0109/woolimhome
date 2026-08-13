#!/usr/bin/env node
/**
 * '이미지만 다시 만들기' 점검 도구 (읽기 전용)
 *
 * 무엇을 하나요
 *   포트폴리오 작업마다 ② 이미지만 다시 만들기 버튼을 눌렀을 때
 *   어떤 일이 일어날지 미리 알려 줍니다.
 *   눌러도 아무 일이 없거나 오류가 나는 작업이 있으면 그 사유를 항목별로 보여줍니다.
 *
 * 안전한가요
 *   읽기만 합니다. 어떤 값도 고치거나 지우지 않습니다. AI도 부르지 않습니다.
 *
 * 실행 방법
 *   npm run mockup-check
 *
 * 필요한 것
 *   .env.local 에 NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  automaticDesignEligibleSlideIndexes,
  validateLocalRedactionManifest,
} from "../lib/pc-worker/redaction-manifest.ts";
import { resolveCoverSlide } from "../lib/portfolio/cover-slide.ts";
import { MIN_LOCAL_REDACTION_WORKER_VERSION } from "../lib/pc-worker/capabilities.ts";

// ── 환경변수 읽기 (doctor 와 같은 방식) ─────────────────────
function cleanText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
}

function readTextFile(path) {
  const buffer = readFileSync(path);
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) return cleanText(buffer.toString("utf16le"));
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) return cleanText(buffer.swap16().toString("utf16le"));
  const head = buffer.subarray(0, Math.min(buffer.length, 512));
  let zeros = 0;
  for (const byte of head) if (byte === 0) zeros += 1;
  if (head.length > 8 && zeros > head.length * 0.2) return cleanText(buffer.toString("utf16le"));
  return cleanText(buffer.toString("utf8"));
}

for (const file of [".env.local", ".env.production.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const rawLine of readTextFile(file).split(/\r?\n/)) {
    const text = rawLine.trim().replace(/^export\s+/, "");
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const index = text.indexOf("=");
    const key = text.slice(0, index).trim();
    const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function normalizeSupabaseUrl(value) {
  if (!value) return value;
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^["']|["']$/g, "");
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 찾지 못했습니다.");
  console.error("vercel.cmd env pull .env.local 로 값을 내려받은 뒤 다시 실행해 주세요.");
  process.exitCode = 1;
}

if (url && key) {
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log("포트폴리오 작업을 읽는 중입니다...\n");

  const { data: items, error: itemsError } = await db
    .from("content_work_items")
    .select("id,title,status,metadata,scheduled_at")
    .eq("format", "portfolio")
    .neq("status", "published")
    .order("scheduled_at", { ascending: false })
    .limit(200);
  if (itemsError) {
    console.error(`작업 항목을 읽지 못했습니다: ${itemsError.message}`);
    process.exitCode = 1;
  } else {
    const ids = items.map((item) => item.id);
    const { data: jobs, error: jobsError } = await db
      .from("content_jobs")
      .select("id,work_item_id,candidate_id,job_type,status,result,error_message,updated_at,attempts,max_attempts,next_retry_at,started_at")
      .in("work_item_id", ids.length ? ids : ["none"])
      .in("job_type", ["download", "convert", "mockup", "draft"]);
    if (jobsError) {
      console.error(`작업 기록을 읽지 못했습니다: ${jobsError.message}`);
      process.exitCode = 1;
    } else {
      const byItem = new Map();
      for (const job of jobs || []) {
        const list = byItem.get(job.work_item_id) || [];
        list.push(job);
        byItem.set(job.work_item_id, list);
      }

      /** 워커 버전이 최신 기준을 넘는지 확인합니다. */
      function versionAtLeast(value, minimum) {
        const parse = (text) => (typeof text === "string"
          ? text.trim().match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1, 4).map(Number)
          : null);
        const current = parse(value);
        const required = parse(minimum);
        if (!current || !required) return false;
        for (let index = 0; index < 3; index += 1) {
          if (current[index] > required[index]) return true;
          if (current[index] < required[index]) return false;
        }
        return true;
      }

      const verdicts = [];
      for (const item of items) {
        const jobList = byItem.get(item.id) || [];
        const convert = jobList.filter((job) => job.job_type === "convert");
        const mockup = jobList.filter((job) => job.job_type === "mockup");
        const download = jobList.filter((job) => job.job_type === "download" && job.status === "completed");
        const metadata = item.metadata || {};
        const reasons = [];

        if (metadata.manualMockupOverride?.approvedAt) {
          reasons.push("관리자가 직접 올린 이미지가 있어 확인을 먼저 받습니다");
        }
        if (!convert.length) reasons.push("변환 작업 기록이 없습니다");
        if (convert.length > 1) reasons.push(`변환 작업이 ${convert.length}개로 중복 연결되어 있습니다`);
        if (!mockup.length) reasons.push("목업 작업 기록이 없습니다");
        if (mockup.length > 1) reasons.push(`목업 작업이 ${mockup.length}개로 중복 연결되어 있습니다`);
        if (!download.length) reasons.push("완료된 원본 다운로드 기록이 없습니다");
        if (download.length > 1) reasons.push("원본 다운로드 기록이 중복되어 있습니다");

        const conversion = convert[0];
        const result = (conversion?.result || {});
        const slidePaths = Array.isArray(result.slidePaths) ? result.slidePaths : [];
        const workerVersion = result.workerVersion || "(기록 없음)";
        let manifestNote = "";
        let eligible = null;

        if (conversion) {
          if (conversion.status === "running" || conversion.status === "queued") {
            reasons.push("원본 변환이 진행 중입니다. 끝난 뒤에 눌러야 합니다");
          } else if (conversion.status !== "completed") {
            reasons.push(`변환 작업 상태가 ${conversion.status} 입니다`);
          }
          if (!slidePaths.length) reasons.push("변환된 장표 이미지가 없습니다");
          const parsed = slidePaths.length
            ? validateLocalRedactionManifest(result.localRedactionManifest, slidePaths.length)
            : { ok: false, error: "장표 없음" };
          if (!parsed.ok) {
            manifestNote = `가림 기록 없음/불일치 (${parsed.error})`;
          } else {
            eligible = automaticDesignEligibleSlideIndexes(parsed.manifest);
            const titles = parsed.manifest.slides.reduce(
              (total, slide) => total + (slide.publicTitles?.length || 0),
              0,
            );
            manifestNote = `장표 ${parsed.manifest.slideCount}장 · 사용 가능 ${eligible.length}장 · 읽어낸 제목 ${titles}개`;
            if (eligible.length < 18) {
              manifestNote += " · 긴 문서 기준 18장에 미달";
            }
            // 표지 판정은 화면과 같은 규칙을 씁니다. 여기서 규칙을 따로 쓰면
            // 도구와 화면이 서로 다른 말을 합니다. 실제로 그런 적이 있습니다.
            const cover = resolveCoverSlide({
              slides: parsed.manifest.slides,
              eligibleSlideIndexes: eligible,
            });
            if (cover.coverIndex === undefined) {
              manifestNote += " · 쓸 수 있는 장표가 없어 썸네일을 만들 수 없음";
              reasons.push("가림 검사를 통과한 장표가 하나도 없습니다");
            } else if (cover.blockedReason === "not_converted") {
              manifestNote += ` · 표지 대신 ${cover.substitutedSourceSlideNumber}번 장표 사용(변환 실패)`;
            } else if (cover.blockedReason === "redaction_excluded") {
              manifestNote += ` · 표지 대신 ${cover.substitutedSourceSlideNumber}번 장표 사용(가림 제외)`;
            }
          }
          if (!versionAtLeast(workerVersion, MIN_LOCAL_REDACTION_WORKER_VERSION)) {
            reasons.push(`예전 워커(${workerVersion})로 변환된 기록이라 PC 워커가 원본부터 다시 읽어야 합니다`);
          }
          if (typeof result.sourcePath === "string" && /\.pdf$/i.test(result.sourcePath)) {
            reasons.push("원본이 PDF라 선택 가림을 다시 만들 수 없습니다");
          }
        }

        /** 목업·초안 작업이 지금 어떤 상태로 멈춰 있는지 한 줄로 만듭니다. */
        function jobNote(job, label) {
          if (!job) return `${label} 기록 없음`;
          const parts = [`${label} ${job.status}`];
          if (job.attempts) parts.push(`시도 ${job.attempts}/${job.max_attempts ?? "?"}`);
          if (job.next_retry_at) parts.push(`다음 재시도 ${job.next_retry_at.slice(0, 16).replace("T", " ")}`);
          if (job.updated_at) parts.push(`마지막 갱신 ${job.updated_at.slice(0, 16).replace("T", " ")}`);
          if (job.error_message) parts.push(`오류: ${String(job.error_message).slice(0, 160)}`);
          return parts.join(" · ");
        }
        const draft = jobList.filter((job) => job.job_type === "draft");
        const mockupNote = jobNote(mockup[0], "목업");
        const draftNote = jobNote(draft[0], "초안");

        // 큐에 남아 있는데 오래 움직이지 않는 작업을 짚어 줍니다.
        const stalledMinutes = mockup[0]?.updated_at
          ? Math.round((Date.now() - new Date(mockup[0].updated_at).getTime()) / 60000)
          : null;
        if (mockup[0] && ["queued", "running", "failed"].includes(mockup[0].status)
          && stalledMinutes !== null && stalledMinutes > 20) {
          reasons.push(`목업 작업이 ${mockup[0].status} 상태로 ${stalledMinutes}분째 멈춰 있습니다`);
        }
        if (mockup[0]?.status === "on_hold") {
          reasons.push("목업 작업이 보류(on_hold) 상태라 자동으로 집어가지 않습니다");
        }

        verdicts.push({
          item, reasons, workerVersion, manifestNote,
          mockupStatus: mockup[0]?.status, mockupNote, draftNote,
        });
      }

      const blocked = verdicts.filter((verdict) => verdict.reasons.length);
      const ready = verdicts.filter((verdict) => !verdict.reasons.length);

      console.log(`포트폴리오 ${verdicts.length}건을 확인했습니다.\n`);
      console.log(`바로 다시 만들 수 있음: ${ready.length}건`);
      console.log(`먼저 처리할 일이 있음: ${blocked.length}건\n`);

      for (const verdict of blocked) {
        const when = verdict.item.scheduled_at ? verdict.item.scheduled_at.slice(0, 10) : "일정없음";
        console.log(`■ [${when}] ${(verdict.item.title || "(제목 없음)").slice(0, 50)}`);
        console.log(`   상태 ${verdict.item.status} · 워커 ${verdict.workerVersion} · 목업작업 ${verdict.mockupStatus || "없음"}`);
        if (verdict.manifestNote) console.log(`   ${verdict.manifestNote}`);
        console.log(`   ${verdict.mockupNote}`);
        console.log(`   ${verdict.draftNote}`);
        for (const reason of verdict.reasons) console.log(`   → ${reason}`);
        console.log("");
      }

      if (ready.length) {
        console.log("── 바로 다시 만들 수 있는 작업 ──");
        for (const verdict of ready) {
          const when = verdict.item.scheduled_at ? verdict.item.scheduled_at.slice(0, 10) : "일정없음";
          console.log(`   · [${when}] ${(verdict.item.title || "").slice(0, 50)}`);
          console.log(`     ${verdict.manifestNote}`);
          console.log(`     ${verdict.mockupNote}`);
        }
        console.log("");
      }

      console.log("이 도구는 아무것도 고치지 않습니다. 사유를 보고 어떤 버튼을 누를지 정하시면 됩니다.");
    }
  }
}
