import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COLUMN_STATUSES, isColumnStatus } from "./types.ts";

/**
 * 코드가 붙이려는 딱지와 저장소가 받아 주는 딱지를 대조합니다.
 *
 * 이 시험이 없던 동안, 코드는 needs_style_fix 라는 등록되지 않은 딱지를
 * 붙이고 있었습니다. 타입 검사도 린트도 잡지 못했습니다. 저장소에 보내는
 * 값은 검사 대상 밖이기 때문입니다.
 *
 * 그래서 글을 다 쓰고 요금까지 다 쓴 뒤, 저장하는 마지막 한 줄에서 거절당했습니다.
 * 이제는 두 목록이 어긋나면 배포 전에 여기서 멈춥니다.
 */
const MIGRATION = "supabase/migrations/202607240001_columns_automation_v1.sql";

function checkedValues(sql, column) {
  const pattern = new RegExp(`${column}[^,]*?check \\(${column} in \\(([^)]*)\\)\\)`, "s");
  const match = sql.match(pattern);
  assert.ok(match, `${MIGRATION} 에서 ${column} 검사 구문을 찾지 못했습니다.`);
  return match[1].split(",").map((part) => part.trim().replace(/^'|'$/g, ""));
}

test("칼럼 상태 목록이 저장소 검사와 같다", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.deepEqual(
    [...COLUMN_STATUSES].sort(),
    checkedValues(sql, "generation_status").sort(),
  );
});

test("목록에 없는 딱지는 걸러진다", () => {
  // 실제로 저장을 죽였던 값입니다.
  assert.equal(isColumnStatus("needs_style_fix"), false);
  assert.equal(isColumnStatus(""), false);
  assert.equal(isColumnStatus(undefined), false);
  assert.equal(isColumnStatus(null), false);
  assert.equal(isColumnStatus("generated"), true);
  assert.equal(isColumnStatus("draft"), true);
});

test("보류 글에 쓰는 딱지가 살아 있다", () => {
  // 기준을 못 넘긴 글은 버리지 않고 이 딱지로 저장합니다.
  // 목록에서 빠지면 그 글들이 다시 마지막 줄에서 거절당합니다.
  assert.equal(isColumnStatus("needs_expert_input"), true);
});
