#!/usr/bin/env node
/**
 * 콘텐츠 공정 점검 도구 (읽기 전용)
 *
 * 무엇을 하나요
 *   지금 DB에 들어 있는 작업 항목들을 훑어서, 화면과 상태가 어긋난 것들을 찾아냅니다.
 *   "승인했는데 검토 화면에 없다", "작업실에 갔는데 이미지가 없다", "같은 글이 두 개다" 같은
 *   증상의 실제 원인을 항목 단위로 보여줍니다.
 *
 * 안전한가요
 *   읽기만 합니다. 어떤 값도 고치거나 지우지 않습니다.
 *
 * 실행 방법
 *   npm run doctor
 *
 * 필요한 것
 *   .env.local 또는 .env.production.local 에
 *   NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 있어야 합니다.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── 환경변수 읽기 ────────────────────────────────────────────
/**
 * 환경변수 파일은 UTF-8 이 아닐 수 있습니다.
 * 윈도우에서 만들어진 파일은 UTF-16 인 경우가 있어, 그대로 읽으면 한 줄도 해석되지 않습니다.
 * 파일 앞머리(BOM)를 보고 알맞은 방식으로 읽습니다.
 */
function readTextFile(path) {
  const buffer = readFileSync(path);
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) return cleanText(buffer.toString("utf16le"));
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) return cleanText(buffer.swap16().toString("utf16le"));
  // 앞머리 표시가 없는 UTF-16 파일도 있습니다.
  // 글자 사이에 빈 바이트가 끼어 있으면 UTF-16 으로 봅니다.
  const head = buffer.subarray(0, Math.min(buffer.length, 512));
  let zeros = 0;
  for (const byte of head) if (byte === 0) zeros += 1;
  if (head.length > 8 && zeros > head.length * 0.2) return cleanText(buffer.toString("utf16le"));
  return cleanText(buffer.toString("utf8"));
}

/** 앞머리 표시와 남은 빈 문자를 제거합니다. 남아 있으면 키 이름이 어긋납니다. */
function cleanText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
}

const envFilesFound = [];
for (const file of [".env.local", ".env.production.local", ".env"]) {
  if (!existsSync(file)) continue;
  let loaded = 0;
  for (const line of readTextFile(file).split(/\r?\n/)) {
    const text = line.trim().replace(/^export\s+/, "");
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const index = text.indexOf("=");
    const key = text.slice(0, index).trim();
    const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!key) continue;
    loaded += 1;
    if (!process.env[key]) process.env[key] = value;
  }
  envFilesFound.push(`${file} (${loaded}개)`);
}

/** 진단용. 이름만 모으며 값은 담지 않습니다. */
const loadedKeyNames = Object.keys(process.env).filter((name) => /^(NEXT_PUBLIC_|SUPABASE_|GEMINI_)/.test(name));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 찾지 못했습니다.\n");
  console.error(`실행한 폴더: ${process.cwd()}`);
  console.error(envFilesFound.length
    ? `읽은 파일: ${envFilesFound.join(", ")}`
    : "읽은 파일: 없음 (이 폴더에 .env 파일이 하나도 없습니다)");
  console.error(`  NEXT_PUBLIC_SUPABASE_URL: ${url ? "있음" : "없음"}`);
  console.error(`  SUPABASE_SERVICE_ROLE_KEY: ${key ? "있음" : "없음"}`);
  console.error(`  읽어낸 관련 키 이름: ${loadedKeyNames.length ? loadedKeyNames.join(", ") : "없음"}\n`);
  console.error("파일은 있는데 0개로 나오면 인코딩 문제입니다. 아래 명령으로 다시 내려받으세요.\n");
  console.error("  vercel.cmd env pull .env.local        (윈도우)");
  console.error("  vercel env pull .env.local            (맥·리눅스)\n");
  console.error("프로젝트 연결이 안 돼 있다면 먼저 vercel.cmd link 를 실행하세요.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// ── 화면별로 어떤 상태가 보이는지 (코드와 같은 기준) ──────────
const PARTNER_VISIBLE = ["approved", "naver_ready", "scheduled", "published"];
const REVIEW_SCREEN = ["review_required"];
const CHANNEL_LABEL = {
  homepage: "홈페이지",
  naver_consulting: "컨설팅",
  naver_design: "디자인",
};

const findings = [];
function report(level, title, items, hint) {
  if (!items.length) return;
  findings.push({ level, title, count: items.length, items, hint });
}

function line(item, extra = "") {
  const when = item.scheduled_at ? item.scheduled_at.slice(0, 10) : "일정없음";
  const channel = CHANNEL_LABEL[item.channel] || item.channel;
  const title = (item.title || "(제목 없음)").slice(0, 44);
  return `    · [${channel}/${when}] ${title}  (${item.status})${extra ? "  " + extra : ""}`;
}

// ── 데이터 읽기 ──────────────────────────────────────────────
console.log("데이터를 읽는 중입니다...\n");

const { data: items, error: itemsError } = await db
  .from("content_work_items")
  .select("id,channel,format,status,title,schedule_key,scheduled_at,published_at,published_url,published_url_normalized,review_note,metadata,created_at,updated_at,retry_count,next_retry_at")
  .order("scheduled_at", { ascending: false })
  .limit(1000);
if (itemsError) {
  console.error("작업 항목을 읽지 못했습니다:", itemsError.message);
  process.exit(1);
}

const { data: assets } = await db
  .from("content_review_assets")
  .select("id,work_item_id,asset_type")
  .limit(5000);

const { data: jobs } = await db
  .from("content_jobs")
  .select("id,work_item_id,candidate_id,job_type,status,attempts,max_attempts,error_message,next_retry_at,updated_at")
  .limit(3000);

const assetCount = new Map();
for (const asset of assets || []) {
  assetCount.set(asset.work_item_id, (assetCount.get(asset.work_item_id) || 0) + 1);
}
const jobsByItem = new Map();
for (const job of jobs || []) {
  if (!job.work_item_id) continue;
  if (!jobsByItem.has(job.work_item_id)) jobsByItem.set(job.work_item_id, []);
  jobsByItem.get(job.work_item_id).push(job);
}

const generatedOf = (item) => item.metadata?.generated;
const bodyOf = (item) => generatedOf(item)?.bodyHtml || "";
const now = Date.now();
const daysAgo = (value) => value ? (now - Date.parse(value)) / 86_400_000 : Infinity;

// ── 점검 1. 같은 글이 두 번 올라온 경우 ──────────────────────
const byTitle = new Map();
for (const item of items) {
  const normalized = (item.title || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized || normalized.includes("생성 중")) continue;
  const bucket = `${item.channel}|${normalized}`;
  if (!byTitle.has(bucket)) byTitle.set(bucket, []);
  byTitle.get(bucket).push(item);
}
const duplicates = [];
for (const group of byTitle.values()) {
  if (group.length < 2) continue;
  const published = group.find((item) => item.status === "published");
  for (const item of group) {
    if (item.status === "published") continue;
    duplicates.push({
      ...item,
      _note: published ? "이미 발행된 같은 제목이 따로 있음" : `같은 제목 ${group.length}건`,
    });
  }
}
report("높음", "같은 글이 두 번 올라와 있습니다", duplicates,
  "발행 완료가 아닌 쪽을 관리자에서 '작업 삭제' 하시면 외주 작업실의 주소 등록 오류가 풀립니다.");

// ── 점검 2. 작업실에 넘어갔는데 내용이나 이미지가 없는 경우 ──
const emptyInPartner = items.filter((item) =>
  PARTNER_VISIBLE.includes(item.status)
  && item.status !== "published"
  && (!bodyOf(item) || bodyOf(item).length < 200));
report("높음", "외주 작업실에 넘어갔는데 본문이 비어 있습니다", emptyInPartner,
  "작가님 화면에는 보이지만 붙여넣을 내용이 없는 상태입니다. 본문을 다시 만들거나 보류로 내려주세요.");

const noImageInPartner = items.filter((item) =>
  PARTNER_VISIBLE.includes(item.status)
  && item.status !== "published"
  && item.format === "portfolio"
  && !(assetCount.get(item.id) > 0));
report("높음", "포트폴리오인데 이미지가 하나도 없습니다", noImageInPartner,
  "작가님이 '이미지 내려받기'를 눌러도 받을 게 없습니다. 목업을 다시 만들어야 합니다.");

// ── 점검 3. 검토 화면에 떠야 하는데 안 뜨는 경우 ─────────────
const stuckBeforeReview = items.filter((item) =>
  !REVIEW_SCREEN.includes(item.status)
  && !PARTNER_VISIBLE.includes(item.status)
  && bodyOf(item).length > 200
  && daysAgo(item.updated_at) > 1);
report("보통", "내용은 완성됐는데 검토 화면에 올라오지 않았습니다", stuckBeforeReview,
  "본문이 있는데 상태가 검토 요청으로 넘어가지 않은 항목입니다. 채널 메뉴에서 상태를 확인해 주세요.");

const designDone = items.filter((item) =>
  item.status === "on_hold"
  && item.metadata?.portfolioStage === "design_completed");
report("정보", "디자인은 끝나고 본문을 기다리는 항목", designDone,
  "이미지는 완성돼 있습니다. AI 본문 생성을 켜면 이어서 진행됩니다.");

// ── 점검 4. 발행 상태가 어긋난 경우 ──────────────────────────
const urlButNotPublished = items.filter((item) => item.published_url && item.status !== "published");
report("높음", "발행 주소는 있는데 발행 완료로 안 바뀌었습니다", urlButNotPublished,
  "작가님 화면에 계속 '포스팅 대기'로 보이는 원인입니다.");

const publishedNoUrl = items.filter((item) => item.status === "published" && !item.published_url);
report("보통", "발행 완료인데 주소가 없습니다", publishedNoUrl,
  "나중에 어느 글인지 추적이 안 됩니다. 주소를 채워두시는 게 좋습니다.");

// ── 점검 5. 일정이 지났는데 안 나간 경우 ─────────────────────
const overdue = items.filter((item) =>
  item.status !== "published"
  && item.scheduled_at
  && Date.parse(item.scheduled_at) < now - 86_400_000);
report("보통", "예정일이 지났는데 아직 발행되지 않았습니다", overdue,
  "발행 일정이 밀리고 있는 항목입니다. 오래된 것부터 처리하거나 일정을 조정해 주세요.");

// ── 점검 6. 멈춰 있는 작업 ───────────────────────────────────
const stalled = (jobs || []).filter((job) =>
  ["queued", "running", "pc_waiting", "pc_running"].includes(job.status)
  && daysAgo(job.updated_at) > 1);
if (stalled.length) {
  findings.push({
    level: "보통",
    title: "하루 넘게 멈춰 있는 자동화 작업",
    count: stalled.length,
    items: stalled.map((job) => ({
      channel: "job", scheduled_at: job.updated_at, status: job.status,
      title: `${job.job_type} 작업`, _note: job.error_message ? job.error_message.slice(0, 60) : "",
    })),
    hint: "PC 워커가 꺼져 있거나 앞 단계에서 막힌 경우입니다. pc_waiting 이 많으면 PC를 켜주세요.",
  });
}

const exhausted = (jobs || []).filter((job) =>
  job.status === "failed" && Number(job.attempts || 0) >= Number(job.max_attempts || 3));
if (exhausted.length) {
  findings.push({
    level: "보통",
    title: "재시도를 다 쓰고 실패한 작업",
    count: exhausted.length,
    items: exhausted.map((job) => ({
      channel: "job", scheduled_at: job.updated_at, status: job.status,
      title: `${job.job_type} 작업`, _note: job.error_message ? job.error_message.slice(0, 60) : "",
    })),
    hint: "사람이 확인해야 넘어갑니다. 오류 내용을 보고 판단해 주세요.",
  });
}

// ── 출력 ─────────────────────────────────────────────────────
const order = { "높음": 0, "보통": 1, "정보": 2 };
findings.sort((a, b) => order[a.level] - order[b.level]);

console.log("=".repeat(64));
console.log("  콘텐츠 공정 점검 결과");
console.log(`  전체 작업 항목 ${items.length}건 · 이미지 ${(assets || []).length}건 · 자동화 작업 ${(jobs || []).length}건`);
console.log("=".repeat(64));

if (!findings.length) {
  console.log("\n어긋난 항목을 찾지 못했습니다. 공정이 정상입니다.\n");
} else {
  for (const finding of findings) {
    console.log(`\n[${finding.level}] ${finding.title} — ${finding.count}건`);
    for (const item of finding.items.slice(0, 12)) {
      console.log(line(item, item._note ? `← ${item._note}` : ""));
    }
    if (finding.items.length > 12) console.log(`    ... 외 ${finding.items.length - 12}건`);
    console.log(`    → ${finding.hint}`);
  }
  console.log("");
}

const summaryPath = "doctor-report.json";
writeFileSync(summaryPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  totals: { items: items.length, assets: (assets || []).length, jobs: (jobs || []).length },
  findings: findings.map((finding) => ({
    level: finding.level,
    title: finding.title,
    count: finding.count,
    hint: finding.hint,
    items: finding.items.map((item) => ({
      id: item.id, channel: item.channel, title: item.title,
      status: item.status, scheduledAt: item.scheduled_at, note: item._note || null,
    })),
  })),
}, null, 2), "utf8");

console.log(`자세한 목록은 ${summaryPath} 파일에 저장했습니다.`);
console.log("이 도구는 읽기만 하며 아무것도 고치지 않았습니다.\n");
