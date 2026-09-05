import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RETENTION_RULES,
  ROW_DELETION_FORBIDDEN_TABLES,
  retentionCutoff,
  retentionRule,
} from "./policy.ts";

const NOW = new Date("2026-08-22T00:00:00.000Z");
const purgeSource = readFileSync(new URL("./purge.ts", import.meta.url), "utf8");

test("보존 기간만큼 거슬러 올라간 시각이 정리 기준선이 된다", () => {
  assert.equal(
    retentionCutoff({ afterDays: 3 }, NOW),
    "2026-08-19T00:00:00.000Z",
  );
  assert.equal(
    retentionCutoff({ afterDays: 30 }, NOW),
    "2026-07-23T00:00:00.000Z",
  );
});

test("기간이 0이면 조건을 만족하는 즉시 정리 대상이 된다", () => {
  assert.equal(retentionCutoff({ afterDays: 0 }, NOW), NOW.toISOString());
});

test("규칙 키는 겹치지 않는다", () => {
  const keys = RETENTION_RULES.map((rule) => rule.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("모든 규칙이 라벨·기준·지킬 조건을 갖는다", () => {
  for (const rule of RETENTION_RULES) {
    assert.ok(rule.label, `${rule.key}: 라벨이 없습니다`);
    assert.ok(rule.table, `${rule.key}: 테이블이 없습니다`);
    assert.ok(rule.basis, `${rule.key}: 기준 시각 설명이 없습니다`);
    assert.ok(rule.guard, `${rule.key}: 지킬 조건이 없습니다`);
    assert.ok(Number.isInteger(rule.afterDays) && rule.afterDays >= 0);
  }
});

/**
 * 이 테스트가 이 파일에서 가장 중요합니다.
 *
 * 발행 완료 행을 지우면 중복 발행 차단이 풀리고, 탈락한 포트폴리오 후보를
 * 지우면 드라이브 동기화가 같은 파일을 다시 후보로 만들어 변환과 AI 검토를
 * 되풀이합니다. Gemini 예산이 하루 3콜, 월 30콜이라 재처리 한 번이 한 달치
 * 예산을 먹습니다. 용량을 더 줄이려고 이 표에 행 삭제 규칙을 넣는 순간
 * 여기서 걸립니다.
 */
test("중복 차단과 재처리 방지의 근거가 되는 테이블은 행을 지우지 않는다", () => {
  const rowDeletions = RETENTION_RULES.filter((rule) => rule.action === "delete_rows");
  for (const rule of rowDeletions) {
    assert.ok(
      !ROW_DELETION_FORBIDDEN_TABLES.includes(rule.table),
      `${rule.key}: ${rule.table} 은(는) 행을 지우면 안 되는 테이블입니다.`
        + " 무거운 필드만 비우는 clear_fields 로 바꾸세요.",
    );
  }
});

test("행을 지우면 안 되는 테이블도 필드 비우기는 허용한다", () => {
  const clearing = RETENTION_RULES.filter((rule) => rule.action === "clear_fields");
  const tables = clearing.map((rule) => rule.table);
  assert.ok(tables.includes("content_work_items"));
  assert.ok(tables.includes("portfolio_candidates"));
});

/**
 * 스토리지 삭제를 발행 기준으로 묶어 두는 것이 재빌드를 지키는 유일한 장치입니다.
 *
 * rebuildPortfolioDraft · rebuildPortfolioMockupsOnlyClaimed ·
 * retryPortfolioConversion · restorePortfolioDraft · reflowPortfolioDraftImages ·
 * retryPortfolioDraft 가 모두 발행 완료 작업을 거부합니다. 그래서 발행된 건의
 * 장표와 원본은 다시 읽힐 일이 없습니다.
 *
 * 반대로 기준을 변환 완료나 초안 완료로 앞당기면, 아직 발행되지 않은 작업의
 * 파일을 지우게 되어 재빌드와 재변환이 조용히 깨집니다. 특히
 * retryPortfolioConversion 은 원본의 storagePath 가 살아 있어야 동작합니다.
 */
test("스토리지 삭제는 발행 완료를 기준으로만 한다", () => {
  const fileRules = RETENTION_RULES.filter((rule) => rule.action === "delete_files");
  assert.ok(fileRules.length > 0);
  for (const rule of fileRules) {
    assert.match(
      rule.basis,
      /발행/,
      `${rule.key}: 발행 완료가 아닌 시점을 기준으로 삼으면 재빌드가 깨집니다.`,
    );
    assert.ok(
      rule.afterDays >= 3,
      `${rule.key}: 발행 직후 삭제는 되돌릴 여유를 남기지 않습니다.`,
    );
  }
});

test("스토리지 규칙은 어느 버킷을 정리하는지 밝힌다", () => {
  for (const rule of RETENTION_RULES) {
    if (rule.action === "delete_files") {
      assert.ok(rule.bucket, `${rule.key}: 버킷이 없습니다`);
    } else {
      assert.equal(rule.bucket, undefined, `${rule.key}: 버킷은 파일 삭제 규칙만 갖습니다`);
    }
  }
});

test("진행 중인 작업을 지키는 조건이 규칙에 적혀 있다", () => {
  assert.match(retentionRule("finished_content_jobs").guard, /queued/);
  assert.match(retentionRule("content_automation_runs").guard, /running/);
});

test("끝난 작업 기록도 미발행 원고에서는 지우지 않는다", () => {
  const rule = retentionRule("finished_content_jobs");
  assert.match(rule.basis, /발행 시각/);
  assert.match(rule.guard, /미발행 원고의 기록.*남깁니다/);

  const start = purgeSource.indexOf("finished_content_jobs:");
  const end = purgeSource.indexOf("column_generation_runs:", start);
  assert.ok(start >= 0 && end > start, "끝난 작업 기록 정리 구현을 찾지 못했습니다.");
  const implementation = purgeSource.slice(start, end);
  assert.match(implementation, /select\("id,content_work_items!inner\(id\)"\)/);
  assert.match(implementation, /\.eq\("content_work_items\.status", "published"\)/);
  assert.match(implementation, /\.lt\("content_work_items\.published_at", cutoff\)/);
  assert.ok(
    implementation.indexOf('.lt("content_work_items.published_at", cutoff)')
      < implementation.indexOf(".limit(ROW_BATCH)"),
    "발행 시각 필터를 행 상한보다 먼저 적용해야 미발행 작업이 정리 대상을 막지 않습니다.",
  );
});

test("없는 키를 물으면 null 을 준다", () => {
  assert.equal(retentionRule("존재하지 않는 규칙"), null);
});
