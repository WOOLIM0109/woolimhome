import assert from "node:assert/strict";
import test from "node:test";

import {
  columnCatchupCount,
  dueColumnDates,
  isColumnEditorialDay,
  isoWeek,
} from "./catchup.ts";

/** 한국 날짜를 그대로 다루기 위해 UTC 자정으로 만듭니다. */
function 날짜(value) {
  return new Date(`${value}T00:00:00Z`);
}

test("화요일과 목요일은 칼럼이 나오는 날이다", () => {
  assert.equal(isColumnEditorialDay(날짜("2026-08-11")), true); // 화
  assert.equal(isColumnEditorialDay(날짜("2026-08-13")), true); // 목
});

test("월·수·금·일은 칼럼이 나오지 않는다", () => {
  for (const value of ["2026-08-10", "2026-08-12", "2026-08-14", "2026-08-16"]) {
    assert.equal(isColumnEditorialDay(날짜(value)), false, value);
  }
});

test("토요일은 격주로만 나온다", () => {
  const 토요일 = ["2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29"];
  const 나오는날 = 토요일.filter((value) => isColumnEditorialDay(날짜(value)));
  // 짝수 주차만 남습니다. 두 주에 한 번입니다.
  assert.equal(나오는날.length, 2);
  for (const value of 나오는날) {
    assert.equal(isoWeek(날짜(value)) % 2, 0, value);
  }
});

test("지난 일주일에 나왔어야 할 날짜를 뽑는다", () => {
  // 실제로 놓친 날입니다. 8월 13일(목)에 돌아보면 11일(화)이 잡혀야 합니다.
  const dates = dueColumnDates(날짜("2026-08-13"));
  assert.ok(dates.includes("2026-08-11"), dates.join(","));
  assert.ok(!dates.includes("2026-08-13"), "오늘은 세지 않습니다");
  assert.ok(!dates.includes("2026-08-12"), "수요일은 칼럼 날이 아닙니다");
});

test("되짚는 기간을 좁히면 그만큼만 본다", () => {
  assert.deepEqual(dueColumnDates(날짜("2026-08-13"), 1), []);
});

test("모자란 만큼만, 한 번에 한 편만 채운다", () => {
  assert.equal(columnCatchupCount(3, 1), 1);
  assert.equal(columnCatchupCount(3, 3), 0);
  assert.equal(columnCatchupCount(1, 5), 0);
  assert.equal(columnCatchupCount(0, 0), 0);
});
