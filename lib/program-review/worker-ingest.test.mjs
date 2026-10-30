import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  COLLECTOR_TAG,
  IngestError,
  MAX_PROGRAMS,
  RETIRED_REASON,
  ingestPrograms,
  parseIngestBody,
} from "./worker-ingest.ts";
import { REQUIREMENTS_NORMALIZATION_VERSION, buildRequirementInput } from "./requirements.ts";

/** assert.throws 는 오류를 돌려주지 않는다. 어디가 틀렸는지 보려면 잡아야 한다. */
function throws(run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof IngestError, `IngestError 가 아니다: ${error}`);
    return error;
  }
  assert.fail("오류가 나지 않았다");
}

const SHA = "a".repeat(64);

function attachment(changes = {}) {
  return {
    file_name: "붙임1. 모집공고문.hwp", file_ext: "hwp",
    source_url: "https://www.btp.or.kr/down?id=1", sha256: SHA, byte_size: 1234,
    text_status: "extracted",
    text: "지원대상\n부산에 사업장을 둔 중소기업\n구분 | 지원한도\n창업 | 5,000만원",
    error: null, ...changes,
  };
}

function program(changes = {}) {
  return {
    source_key: "btp", external_id: "34093", title: "2026년 부산 창업기업 성장지원사업 모집공고",
    source_url: "https://www.btp.or.kr/kor/CMS/Board/Board.do?mCode=MN013&id=1",
    starts_at: "2026-11-03", deadline_at: "2026-11-20T18:00:00+09:00",
    regions: ["부산"], application_period_text: "2026.11.03 ~ 2026.11.20",
    applicant_summary: "부산 소재 중소기업", support_summary: "최대 5,000만원",
    application_method: "온라인", detail_text: "본문입니다",
    attachments: [attachment()],
    requirements: { regions: ["부산"], deadline_at: "2026-11-20T18:00:00+09:00" },
    collector_conditions: { exclusion_rules: ["대표자가 동일한 기업은 1개 명의만"] },
    ...changes,
  };
}

function body(changes = {}) {
  return { workerId: "gonggo-collector", workerName: "공고 수집기",
    collectorVersion: "1.0.0", programs: [program()], ...changes };
}

/** 아무것도 저장돼 있지 않은 상태의 가짜 Supabase. 넘어온 값을 기록한다. */
function fakeAdmin({ existing = [], sources = [{ id: "source-1", source_key: "btp" }] } = {}) {
  const writes = { programs: [], attachments: [], requirements: [], updates: [], options: {} };
  let serial = 0;
  const admin = {
    from(table) {
      const builder = {
        select() { return builder; },
        in() { return builder; },
        eq() { return builder; },
        update(values) { writes.updates.push({ table, values }); builder._update = values; return builder; },
        upsert(rows, options) {
          builder._rows = Array.isArray(rows) ? rows : [rows];
          builder._options = options;
          writes.options[table] = options;
          if (table === "openchat_programs") writes.programs.push(...builder._rows);
          if (table === "openchat_program_attachments") writes.attachments.push(...builder._rows);
          if (table === "openchat_program_requirements") writes.requirements.push(...builder._rows);
          return builder;
        },
        then(resolve) { return Promise.resolve(builder._result()).then(resolve); },
        _result() {
          if (table === "openchat_sources") return { data: sources, error: null };
          // 이미 있는 공고를 되살릴지 확인하는 질의 (우리 것이 아니면 빈 결과)
          if (table === "openchat_programs" && !builder._rows) return { data: [], error: null };
          if (table === "openchat_programs") {
            // 이미 있는 fingerprint 는 ignoreDuplicates 로 아무것도 돌아오지 않는다
            const fresh = (builder._rows ?? []).filter(row => !existing.includes(row.fingerprint));
            return { data: fresh.map(row => { serial += 1; return { id: `program-${serial}`, fingerprint: row.fingerprint }; }), error: null };
          }
          if (table === "openchat_program_attachments") {
            return { data: (builder._rows ?? []).map(row => { serial += 1; return { id: `attach-${serial}`, sha256: row.sha256 }; }), error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };
  return { admin, writes };
}

// ── 검사 ──────────────────────────────────────────────────────────────

test("모르는 칸이 섞여 있으면 어디가 틀렸는지 알려 준다", () => {
  const error = throws(() => parseIngestBody(body({ 엉뚱한칸: 1 })));
  assert.equal(error.code, "UNKNOWN_FIELD");
  assert.equal(error.detail, "body.엉뚱한칸");
});

test("수집기 버전이 낮으면 받지 않는다", () => {
  const error = throws(() => parseIngestBody(body({ collectorVersion: "0.9.0" })));
  assert.equal(error.status, 409);
  assert.equal(error.code, "COLLECTOR_UPGRADE_REQUIRED");
});

test("공고 수 상한을 넘으면 받지 않는다", () => {
  const programs = Array.from({ length: MAX_PROGRAMS + 1 }, (_, index) =>
    program({ external_id: `id-${index}` }));
  assert.equal(throws(() => parseIngestBody(body({ programs }))).code, "TOO_MANY_PROGRAMS");
});

test("주소가 http 가 아니면 받지 않는다", () => {
  const error = throws(() =>
    parseIngestBody(body({ programs: [program({ source_url: "file:///c:/secret" })] })));
  assert.equal(error.code, "INVALID_URL");
});

test("날짜 모양이 아니면 받지 않는다", () => {
  const error = throws(() =>
    parseIngestBody(body({ programs: [program({ deadline_at: "예산 소진 시까지" })] })));
  assert.equal(error.code, "INVALID_DATE");
});

test("시간대 없는 시각은 받지 않는다", () => {
  // 받아 주면 저장소가 UTC 로 읽어 한국시간이 9시간 밀린다.
  // 실측으로 들어온 30건 중 28건이 그렇게 밀렸다.
  const error = throws(() =>
    parseIngestBody(body({ programs: [program({ deadline_at: "2026-11-20T18:00:00" })] })));
  assert.equal(error.code, "NAIVE_TIMESTAMP");
  assert.equal(error.detail, "programs.0.deadline_at");
});

test("한국 시간이 붙은 마감은 그 시각 그대로 들어간다", () => {
  const parsed = parseIngestBody(body({
    programs: [program({ deadline_at: "2026-11-20T18:00:00+09:00" })] }));
  assert.equal(parsed.programs[0].deadline_at, "2026-11-20T09:00:00.000Z");
});

test("날짜만 온 값은 한국 시간 자정으로 읽는다", () => {
  const parsed = parseIngestBody(body({ programs: [program({ starts_at: "2026-11-03" })] }));
  assert.equal(parsed.programs[0].starts_at, "2026-11-02T15:00:00.000Z");
});

test("읽었다고 하면서 글자가 없는 첨부는 받지 않는다", () => {
  const error = throws(() => parseIngestBody(body({
    programs: [program({ attachments: [attachment({ text: "" })] })],
  })));
  assert.equal(error.code, "MISSING_FIELD");
});

test("글자가 없는 첨부도 상태가 맞으면 받는다", () => {
  const parsed = parseIngestBody(body({
    programs: [program({ attachments: [attachment({ text: "", text_status: "no_text", error: "스캔본 추정" })] })],
  }));
  assert.equal(parsed.programs[0].attachments[0].text_status, "no_text");
});

test("같은 첨부를 두 번 보내면 받지 않는다", () => {
  const error = throws(() => parseIngestBody(body({
    programs: [program({ attachments: [attachment(), attachment()] })],
  })));
  assert.equal(error.code, "DUPLICATE_ATTACHMENT");
});

test("U+0000 은 걸러낸다 (PostgreSQL text 가 받지 않는다)", () => {
  const parsed = parseIngestBody(body({ programs: [program({ detail_text: "본문\u0000입니다" })] }));
  assert.equal(parsed.programs[0].detail_text, "본문입니다");
});

test("fingerprint 를 안 보내면 서버가 만든다", () => {
  const parsed = parseIngestBody(body());
  assert.match(parsed.programs[0].fingerprint, /^[0-9a-f]{64}$/);
});

test("글자 총량이 상한을 넘으면 413 이다", () => {
  const long = "가".repeat(1_500_000);
  const programs = [0, 1, 2].map(index =>
    program({ external_id: `id-${index}`, attachments: [attachment({ text: long, sha256: SHA })] }));
  assert.equal(throws(() => parseIngestBody(body({ programs }))).status, 413);
});

// ── 저장 ──────────────────────────────────────────────────────────────

test("공고·첨부·요건을 넣고 센 값을 돌려준다", async () => {
  const { admin, writes } = fakeAdmin();
  const result = await ingestPrograms(parseIngestBody(body()), { admin });

  assert.deepEqual(result, { received: 1, inserted: 1, resumed: 0, retired: 0, restored: 0,
    skipped_existing: 0, attachments: 1, requirements: 1 });
  assert.equal(writes.programs[0].source_id, "source-1");
  assert.equal(writes.programs[0].status, "review_required");
  assert.equal(writes.attachments[0].text_chars, attachment().text.length);
});

test("아침 발행 큐에 끼어들지 않는다 (draft_for 를 비운다)", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body()), { admin });
  assert.equal(writes.programs[0].draft_for, null);
});

test("이미 있는 공고는 건드리지 않는다", async () => {
  const parsed = parseIngestBody(body());
  const { admin, writes } = fakeAdmin({ existing: [parsed.programs[0].fingerprint] });
  const result = await ingestPrograms(parsed, { admin });

  assert.deepEqual(result, { received: 1, inserted: 0, resumed: 0, retired: 0, restored: 0,
    skipped_existing: 1, attachments: 0, requirements: 0 });
  assert.equal(writes.attachments.length, 0, "이미 있던 공고의 첨부를 덮어쓰면 안 된다");
  assert.equal(writes.requirements.length, 0, "이미 있던 공고의 요건을 덮어쓰면 안 된다");
});

test("서버가 모은 행을 덮지 않게 ignoreDuplicates 로 넣는다", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body()), { admin });
  assert.deepEqual(writes.options.openchat_programs,
    { onConflict: "fingerprint", ignoreDuplicates: true });
});

test("같은 요청을 두 번 보내도 결과가 같다", async () => {
  const parsed = parseIngestBody(body());
  const first = await ingestPrograms(parsed, { admin: fakeAdmin().admin });
  const second = await ingestPrograms(parsed,
    { admin: fakeAdmin({ existing: [parsed.programs[0].fingerprint] }).admin });
  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(second.skipped_existing, 1);
});

test("원본 파일은 올리지 않는다 (storage_path 를 비운다)", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body()), { admin });
  assert.equal(writes.attachments[0].storage_path, null);
});

test("요건 해시를 서버 함수로 계산한다 — 다시 추출하지 않게", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body()), { admin });
  const saved = writes.requirements[0];

  // requirements-runner 가 같은 원문으로 계산하는 값과 같아야 재사용된다
  const expected = buildRequirementInput([
    { id: "0:detail", text: "본문입니다" },
    { id: "1:attachment:attach-2", text: attachment().text },
  ]);
  assert.equal(saved.input_hash, expected.inputHash);
  assert.equal(saved.status, "extracted");
});

test("normalization_version 을 올리지 않는다 (올리면 기존 행이 재추출된다)", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body()), { admin });
  assert.equal(writes.requirements[0].normalization_version, REQUIREMENTS_NORMALIZATION_VERSION);
});

test("요건을 서버 모양으로 정규화해 넣는다", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body()), { admin });
  const requirements = writes.requirements[0].requirements;
  // 서버 모양에 있는 칸이 모두 생기고, 모르는 칸은 들어가지 않는다
  assert.ok(Object.hasOwn(requirements, "target_types"));
  assert.ok(Object.hasOwn(requirements, "evidence"));
  assert.equal(Object.hasOwn(requirements, "exclusion_rules"), false);
});

test("서버 모양에 자리가 없는 축은 잃지 않고 담아 둔다", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body()), { admin });
  const payload = writes.programs[0].raw_payload;
  assert.equal(payload.collector, COLLECTOR_TAG);
  assert.deepEqual(payload.collector_conditions.exclusion_rules,
    ["대표자가 동일한 기업은 1개 명의만"]);
});

test("등록되지 않은 사이트는 source_id 없이 넣는다", async () => {
  const { admin, writes } = fakeAdmin({ sources: [] });
  const result = await ingestPrograms(parseIngestBody(body()), { admin });
  assert.equal(result.inserted, 1);
  assert.equal(writes.programs[0].source_id, null);
});

test("요건을 안 보내면 요건 행을 만들지 않는다", async () => {
  const { admin, writes } = fakeAdmin();
  const result = await ingestPrograms(
    parseIngestBody(body({ programs: [program({ requirements: null })] })), { admin });
  assert.equal(result.requirements, 0);
  assert.equal(writes.requirements.length, 0);
});

// ── 근거 붙이기 ───────────────────────────────────────────────────────
// 이게 틀리면 매칭이 모든 값을 무시하고 전부 '확인 필요' 가 된다.

const 쪽표시된_공고문 = [
  "[p.1]",
  "2026년 부산 창업기업 성장지원사업 모집공고",
  "",
  "[p.2]",
  "1. 지원대상",
  "부산광역시에 사업장을 둔 중소기업",
  "",
  "[p.3]",
  "2. 지원제외",
  "유흥업, 부동산임대업은 제외합니다",
].join("\n");

function 근거있는_공고(evidence) {
  return program({
    detail_text: "",
    attachments: [attachment({ text: 쪽표시된_공고문 })],
    requirements: { regions: ["부산"], industries_excluded: ["유흥업"], evidence },
  });
}

test("원문 문장이 어느 쪽에 있는지 찾아 붙인다", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body({
    programs: [근거있는_공고({ "regions.0": "부산광역시에 사업장을 둔 중소기업" })],
  })), { admin });

  const saved = writes.requirements[0].requirements;
  assert.deepEqual(saved.regions, ["부산"], "근거가 붙어야 값이 살아남는다");
  assert.match(saved.evidence["regions.0"],
    /^\[source:1:attachment:attach-\d+ p\.2\] 부산광역시에 사업장을 둔 중소기업$/);
});

test("쪽이 다른 근거는 그 쪽 번호로 붙는다", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body({
    programs: [근거있는_공고({
      "regions.0": "부산광역시에 사업장을 둔 중소기업",
      "industries_excluded.0": "유흥업, 부동산임대업은 제외합니다",
    })],
  })), { admin });

  const evidence = writes.requirements[0].requirements.evidence;
  assert.match(evidence["regions.0"], / p\.2\] /);
  assert.match(evidence["industries_excluded.0"], / p\.3\] /);
});

test("원문에 없는 근거는 버린다 — 없는 곳을 가리키지 않는다", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body({
    programs: [근거있는_공고({ "regions.0": "서울특별시에 사업장을 둔 기업" })],
  })), { admin });

  const saved = writes.requirements[0].requirements;
  assert.equal(saved.regions, null, "근거가 없으면 값도 버려진다");
});

test("이미 모양을 갖춘 근거는 그대로 둔다", async () => {
  const { admin, writes } = fakeAdmin();
  const 이미붙음 = "[source:1:attachment:attach-2 p.2] 부산광역시에 사업장을 둔 중소기업";
  await ingestPrograms(parseIngestBody(body({
    programs: [근거있는_공고({ "regions.0": 이미붙음 })],
  })), { admin });

  assert.equal(writes.requirements[0].requirements.evidence["regions.0"], 이미붙음);
});

test("쪽 표시가 없는 원문이면 근거를 붙일 수 없다", async () => {
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body({
    programs: [program({
      detail_text: "",
      attachments: [attachment({ text: "쪽 표시가 없는 공고문입니다. 지원대상은 중소기업입니다." })],
      requirements: { regions: ["부산"], evidence: { "regions.0": "지원대상은 중소기업입니다" } },
    })],
  })), { admin });

  // 값이 버려져야 한다. 조용히 통과시키면 근거 없는 판정이 나간다.
  assert.equal(writes.requirements[0].requirements.regions, null);
});

test("줄바꿈이 섞인 원문에서도 근거를 찾는다", async () => {
  // 공고문은 문장 중간에 줄이 바뀌는데, 올라온 인용은 한 줄로 합쳐 온다.
  const 원문 = "[p.2]\n지원대상\n부산광역시에 사업장을\n둔 중소기업";
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body({
    programs: [program({
      detail_text: "",
      attachments: [attachment({ text: 원문 })],
      requirements: { regions: ["부산"],
        evidence: { "regions.0": "부산광역시에 사업장을 둔 중소기업" } },
    })],
  })), { admin });

  const saved = writes.requirements[0].requirements;
  assert.deepEqual(saved.regions, ["부산"], "공백 차이 때문에 버려지면 안 된다");
  // 인용은 원문에 있는 글자 그대로여야 한다 (모델이 쓴 글자가 아니라)
  assert.match(saved.evidence["regions.0"], /부산광역시에 사업장을\s+둔 중소기업/);
});

test("글자 칸의 값을 원문 조각에 맞춘다", async () => {
  const 원문 = "[p.3]\n지원규모\n기업당 최대\n5,000만원";
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body({
    programs: [program({
      detail_text: "",
      attachments: [attachment({ text: 원문 })],
      requirements: { support_amount_text: "기업당 최대 5,000만원",
        evidence: { support_amount_text: "기업당 최대 5,000만원" } },
    })],
  })), { admin });

  const saved = writes.requirements[0].requirements;
  assert.ok(saved.support_amount_text, "공백 차이 때문에 버려지면 안 된다");
});

test("저장이 실패하면 사유를 함께 돌려준다", async () => {
  const updates = [];
  // 사유 없이 PROGRAM_WRITE_FAILED 만 나오면 운영에서 아무도 못 고친다.
  const admin = { from() {
    const builder = {
      select() { return builder; }, in() { return builder; }, eq() { return builder; },
      update(values) { updates.push(values); return builder; },
      upsert() { return builder; },
      then(resolve) {
        return Promise.resolve({ data: null,
          error: { code: "23502", message: "null value in column \"source_id\"" } }).then(resolve);
      },
    };
    return builder;
  } };
  const error = await ingestPrograms(parseIngestBody(body()), { admin }).catch(e => e);
  assert.ok(error instanceof IngestError);
  assert.equal(error.code, "SOURCE_LOOKUP_FAILED");
  assert.match(error.detail, /23502/);
});

test("요약 칸이 비어도 저장이 터지지 않는다", async () => {
  // openchat_programs 의 applicant_summary 등은 NOT NULL 이다.
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parseIngestBody(body({
    programs: [program({ applicant_summary: null, support_summary: null,
                         application_method: null, application_period_text: null })],
  })), { admin });
  const row = writes.programs[0];
  for (const key of ["applicant_summary", "support_summary",
                     "application_method", "application_period_text"]) {
    assert.equal(row[key], "", `${key} 가 null 이면 안 된다`);
  }
});

test("우리가 넣은 반쪽 공고는 이어서 채운다", async () => {
  // 공고만 들어가고 첨부에서 실패하면, 다시 보낼 때 건너뛰어 첨부가 영영 안 붙는다.
  const parsed = parseIngestBody(body());
  const fingerprint = parsed.programs[0].fingerprint;
  let serial = 0;
  const writes = { attachments: [], requirements: [] };
  const updates = [];
  const admin = { from(table) {
    const builder = {
      select() { return builder; }, in() { return builder; }, eq() { return builder; },
      update(values) { updates.push(values); return builder; },
      upsert(rows) {
        builder._rows = Array.isArray(rows) ? rows : [rows];
        if (table === "openchat_program_attachments") writes.attachments.push(...builder._rows);
        if (table === "openchat_program_requirements") writes.requirements.push(...builder._rows);
        return builder;
      },
      then(resolve) { return Promise.resolve(builder._result()).then(resolve); },
      _result() {
        if (table === "openchat_sources") return { data: [], error: null };
        if (table === "openchat_programs" && builder._rows) return { data: [], error: null };
        if (table === "openchat_programs") {
          // 우리가 전에 넣어 둔 행
          return { data: [{ id: "program-old", fingerprint,
            raw_payload: { collector: COLLECTOR_TAG } }], error: null };
        }
        if (table === "openchat_program_attachments") {
          return { data: (builder._rows ?? []).map(row => {
            serial += 1; return { id: `attach-${serial}`, sha256: row.sha256 }; }), error: null };
        }
        return { data: null, error: null };
      },
    };
    return builder;
  } };

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.inserted, 0);
  assert.equal(result.resumed, 1, "우리 것이면 이어서 채워야 한다");
  assert.equal(result.attachments, 1);
  assert.equal(result.requirements, 1);
  assert.equal(writes.attachments[0].program_id, "program-old");

  // 이어서 채울 때 값도 다시 맞춘다. 안 그러면 보내는 쪽을 고쳐도
  // 이미 들어간 행은 틀린 채로 남는다 (마감이 9시간 밀린 28건이 그랬다).
  assert.equal(updates.length, 1, "우리 행은 값을 다시 맞춰야 한다");
  assert.equal(updates[0].deadline_at, "2026-11-20T09:00:00.000Z");
  assert.equal(updates[0].title, parsed.programs[0].title);
  // 사람이 화면에서 내린 판단은 기계가 되돌리면 안 된다.
  for (const 손대면_안되는_칸 of ["status", "priority", "draft_for", "exclusion_reason"]) {
    assert.ok(!(손대면_안되는_칸 in updates[0]),
      `${손대면_안되는_칸} 은 되돌리면 안 된다`);
  }
});

test("서버가 모은 행은 이어서 채우지 않는다", async () => {
  const updates = [];
  const parsed = parseIngestBody(body());
  const admin = { from(table) {
    const builder = {
      select() { return builder; }, in() { return builder; }, eq() { return builder; },
      update(values) { updates.push(values); return builder; },
      upsert(rows) { builder._rows = Array.isArray(rows) ? rows : [rows]; return builder; },
      then(resolve) { return Promise.resolve(builder._result()).then(resolve); },
      _result() {
        if (table === "openchat_sources") return { data: [], error: null };
        if (table === "openchat_programs" && builder._rows) return { data: [], error: null };
        if (table === "openchat_programs") {
          // 서버가 모은 행 — collector 표시가 없다
          return { data: [{ id: "server-row", fingerprint: parsed.programs[0].fingerprint,
            raw_payload: {} }], error: null };
        }
        return { data: null, error: null };
      },
    };
    return builder;
  } };
  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.resumed, 0);
  assert.equal(result.skipped_existing, 1);
  assert.equal(result.attachments, 0, "남의 행에 첨부를 붙이면 안 된다");
});

// ── 중복 ───────────────────────────────────────────────────────────────
// 홈페이지 자체 수집기와 같은 열쇠로 지문을 만들어야 한 줄로 합쳐진다.
// 실측: 접두어가 빠져 30건 중 8건이 화면에 두 줄로 보였다.

test("지문은 홈페이지 수집기와 같은 열쇠로 만든다", () => {
  const parsed = parseIngestBody(body());
  const 같은열쇠 = createHash("sha256").update("btp:34093").digest("hex");
  assert.equal(parsed.programs[0].fingerprint, 같은열쇠);
});

test("공고번호가 없으면 제목과 주소로 지문을 만든다", () => {
  const parsed = parseIngestBody(body({ programs: [program({ external_id: null })] }));
  assert.equal(parsed.programs[0].fingerprint.length, 64);
  assert.notEqual(parsed.programs[0].fingerprint,
    createHash("sha256").update("btp:34093").digest("hex"));
});

/** 전에 우리가 다른 지문으로 넣어 둔 행이 하나 있는 상태의 가짜 Supabase. */
function 옛행이있는가짜(옛행, 지문주인 = null) {
  const updates = [];
  let serial = 0;
  let 물음 = 0;
  const admin = { from(table) {
    const builder = {
      select() { return builder; }, in() { return builder; },
      // .update(...).eq("id", ...) 순서라 id 는 나중에 들어온다
      eq(_column, value) { if (builder._write) builder._write.id = value; return builder; },
      update(values) { builder._write = { id: null, values }; updates.push(builder._write); return builder; },
      upsert(rows) { builder._rows = Array.isArray(rows) ? rows : [rows]; return builder; },
      then(resolve) { return Promise.resolve(builder._result()).then(resolve); },
      _result() {
        if (table === "openchat_sources") return { data: [{ id: "source-1", source_key: "btp" }], error: null };
        if (table === "openchat_programs" && builder._rows) {
          // 지문 주인이 이미 있으면 ignoreDuplicates 로 아무것도 안 돌아온다
          if (지문주인) return { data: [], error: null };
          return { data: builder._rows.map(row => {
            serial += 1; return { id: `program-${serial}`, fingerprint: row.fingerprint }; }), error: null };
        }
        if (table === "openchat_programs") {
          // 첫 질의는 (기관, 공고번호) 로 옛 행을 찾고, 둘째는 지문 주인을 찾는다
          builder._asked = (builder._asked ?? 0) + 1;
          return { data: 지문주인 && 물음++ > 0 ? [지문주인] : [옛행], error: null };
        }
        if (table === "openchat_program_attachments") {
          return { data: (builder._rows ?? []).map(row => {
            serial += 1; return { id: `attach-${serial}`, sha256: row.sha256 }; }), error: null };
        }
        return { data: null, error: null };
      },
    };
    return builder;
  } };
  return { admin, updates };
}

test("지문 규칙이 바뀌어 남은 우리 옛 행은 접는다", async () => {
  // 접지 않으면 같은 공고가 화면에 두 줄로 보여 사람이 두 번 읽는다.
  const parsed = parseIngestBody(body());
  const { admin, updates } = 옛행이있는가짜({
    id: "program-old", fingerprint: "b".repeat(64), source_id: "source-1",
    external_id: "34093", raw_payload: { collector: COLLECTOR_TAG } });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.inserted, 1, "새 지문으로는 새로 들어간다");
  assert.equal(result.retired, 1, "옛 행은 접어야 한다");
  const 접은것 = updates.find(write => write.id === "program-old");
  assert.ok(접은것, "옛 행을 접지 않았다");
  assert.equal(접은것.values.status, "excluded");
  assert.ok(접은것.values.exclusion_reason.includes("중복"));
});

test("지문이 그대로면 옛 행을 접지 않는다", async () => {
  // 같은 요청을 두 번 보내도 결과가 같아야 한다.
  const parsed = parseIngestBody(body());
  const { admin, updates } = 옛행이있는가짜({
    id: "program-old", fingerprint: parsed.programs[0].fingerprint, source_id: "source-1",
    external_id: "34093", raw_payload: { collector: COLLECTOR_TAG } });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.retired, 0);
  assert.equal(updates.filter(write => write.values.status === "excluded").length, 0);
});

test("서버가 모은 옛 행은 접지 않는다", async () => {
  // 우리 표시가 없는 행은 남의 것이다. 접으면 홈페이지 화면에서 공고가 사라진다.
  const parsed = parseIngestBody(body());
  const { admin, updates } = 옛행이있는가짜({
    id: "server-row", fingerprint: "c".repeat(64), source_id: "source-1",
    external_id: "34093", raw_payload: {} });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.retired, 0, "남의 행을 접으면 안 된다");
  assert.equal(updates.filter(write => write.id === "server-row").length, 0);
});

// ── 공고가 사라지지 않게 ────────────────────────────────────────────────
// 지문 주인이 화면 범위 밖(60일보다 오래됨)이면, 우리 행을 접는 순간
// 그 공고가 아무 데도 안 보이게 된다. 실측으로 7건이 그렇게 사라졌다.

const 예전 = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
const 최근 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

test("대신할 행이 화면 밖이면 우리 옛 행을 접지 않는다", async () => {
  const parsed = parseIngestBody(body());
  const { admin, updates } = 옛행이있는가짜(
    { id: "program-old", fingerprint: "b".repeat(64), source_id: "source-1",
      external_id: "34093", raw_payload: { collector: COLLECTOR_TAG } },
    { id: "server-old", fingerprint: parsed.programs[0].fingerprint,
      raw_payload: {}, created_at: 예전, status: "review_required" });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.retired, 0, "접으면 공고가 아무 데도 안 보이게 된다");
  // 접는 대신 값을 다시 맞춘다 (마감이 고쳐져야 한다)
  const 맞춘것 = updates.find(write => write.id === "program-old");
  assert.ok(맞춘것, "우리 행의 값을 다시 맞춰야 한다");
  assert.equal(맞춘것.values.deadline_at, "2026-11-20T09:00:00.000Z");
  assert.ok(!("status" in 맞춘것.values));
});

test("대신할 행이 제외돼 있어도 우리 옛 행을 접지 않는다", async () => {
  const parsed = parseIngestBody(body());
  const { admin } = 옛행이있는가짜(
    { id: "program-old", fingerprint: "b".repeat(64), source_id: "source-1",
      external_id: "34093", raw_payload: { collector: COLLECTOR_TAG } },
    { id: "server-old", fingerprint: parsed.programs[0].fingerprint,
      raw_payload: {}, created_at: 최근, status: "excluded" });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.retired, 0);
});

test("대신할 행이 화면에 보이면 우리 옛 행을 접는다", async () => {
  const parsed = parseIngestBody(body());
  const { admin, updates } = 옛행이있는가짜(
    { id: "program-old", fingerprint: "b".repeat(64), source_id: "source-1",
      external_id: "34093", raw_payload: { collector: COLLECTOR_TAG } },
    { id: "server-new", fingerprint: parsed.programs[0].fingerprint,
      raw_payload: {}, created_at: 최근, status: "review_required" });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.retired, 1, "같은 공고가 두 줄로 보이면 안 된다");
  assert.equal(updates.find(write => write.id === "program-old").values.status, "excluded");
});

test("잘못 접어 둔 우리 행은 되살린다", async () => {
  // 우리가 쓴 사유일 때만 되살린다. 사람이 제외한 행은 건드리지 않는다.
  const parsed = parseIngestBody(body());
  const { admin, updates } = 옛행이있는가짜(
    { id: "program-old", fingerprint: "b".repeat(64), source_id: "source-1",
      external_id: "34093", raw_payload: { collector: COLLECTOR_TAG },
      status: "excluded", exclusion_reason: RETIRED_REASON },
    { id: "server-old", fingerprint: parsed.programs[0].fingerprint,
      raw_payload: {}, created_at: 예전, status: "review_required" });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.restored, 1);
  const 되살린것 = updates.find(write => write.values.status === "review_required");
  assert.equal(되살린것.id, "program-old");
  assert.equal(되살린것.values.exclusion_reason, null);
});

test("사람이 제외한 행은 되살리지 않는다", async () => {
  const parsed = parseIngestBody(body());
  const { admin } = 옛행이있는가짜(
    { id: "program-old", fingerprint: "b".repeat(64), source_id: "source-1",
      external_id: "34093", raw_payload: { collector: COLLECTOR_TAG },
      status: "excluded", exclusion_reason: "대표님이 볼 필요 없다고 판단" },
    { id: "server-old", fingerprint: parsed.programs[0].fingerprint,
      raw_payload: {}, created_at: 예전, status: "review_required" });

  const result = await ingestPrograms(parsed, { admin });
  assert.equal(result.restored, 0, "사람의 판단을 기계가 되돌리면 안 된다");
});

// ── 교육·행사 표시 ──────────────────────────────────────────────────────
// 거르지 않고 표시만 단다. 돈을 주는 공고가 잘못 걸릴 수 있어서,
// 버리는 대신 화면에서 뒤로 미는 쪽을 골랐다.

test("교육·행사 표시를 받아 담아 둔다", async () => {
  const parsed = parseIngestBody(body({ programs: [program({ event_like: true })] }));
  assert.equal(parsed.programs[0].event_like, true);
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parsed, { admin });
  assert.equal(writes.programs[0].raw_payload.event_like, true);
});

test("표시가 없으면 교육·행사가 아니다", async () => {
  const parsed = parseIngestBody(body());
  assert.equal(parsed.programs[0].event_like, false);
  const { admin, writes } = fakeAdmin();
  await ingestPrograms(parsed, { admin });
  assert.equal(writes.programs[0].raw_payload.event_like, false);
});

test("표시를 거르는 데 쓰지 않는다 — 공고는 그대로 들어간다", async () => {
  const { admin, writes } = fakeAdmin();
  const result = await ingestPrograms(
    parseIngestBody(body({ programs: [program({ event_like: true })] })), { admin });
  assert.equal(result.inserted, 1, "교육·행사도 버리지 않는다");
  assert.equal(writes.programs[0].status, "review_required");
});

test("참·거짓이 아닌 표시는 받지 않는다", () => {
  const error = throws(() =>
    parseIngestBody(body({ programs: [program({ event_like: "네" })] })));
  assert.equal(error.code, "INVALID_FIELD");
  assert.equal(error.detail, "programs.0.event_like");
});
