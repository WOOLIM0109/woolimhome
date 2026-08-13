import assert from "node:assert/strict";
import test from "node:test";

import { selectRotatingKnowledge } from "./knowledge-rotation.ts";

function 자료(id, area, use_count, created_at = "2026-01-01") {
  return { id, expertise_area: area, use_count, created_at };
}

test("덜 쓰인 자료를 먼저 고른다", () => {
  const picked = selectRotatingKnowledge([
    자료("a", "planning", 3),
    자료("b", "planning", 0),
    자료("c", "planning", 1),
  ], 2);
  assert.deepEqual(picked.map((item) => item.id), ["b", "c"]);
});

test("오래 전에 올린 자료도 안 쓰였으면 뽑힌다", () => {
  // 실제로 보고된 현상: 최신 12개만 넘겨, 먼저 올린 자료가 계속 잠들어 있었습니다.
  const picked = selectRotatingKnowledge([
    자료("최신", "planning", 3, "2026-08-01"),
    자료("오래된", "planning", 0, "2026-01-05"),
  ], 1);
  assert.deepEqual(picked.map((item) => item.id), ["오래된"]);
});

test("한 분야가 자리를 다 차지하지 못한다", () => {
  const items = [
    ...Array.from({ length: 8 }, (_, index) => 자료(`기획${index}`, "planning", 0)),
    자료("컨설팅1", "consulting", 0),
    자료("IR1", "ir", 0),
  ];
  const picked = selectRotatingKnowledge(items, 4);
  const areas = new Set(picked.map((item) => item.expertise_area));
  assert.equal(picked.length, 4);
  assert.equal(areas.size, 3, picked.map((item) => item.id).join(","));
});

test("분야가 하나뿐이면 그 분야로 자리를 채운다", () => {
  const items = Array.from({ length: 5 }, (_, index) => 자료(`기획${index}`, "planning", index));
  const picked = selectRotatingKnowledge(items, 3);
  assert.deepEqual(picked.map((item) => item.id), ["기획0", "기획1", "기획2"]);
});

test("자료가 요청 수보다 적으면 있는 만큼만 준다", () => {
  const picked = selectRotatingKnowledge([자료("a", "planning", 0)], 12);
  assert.equal(picked.length, 1);
});

test("전문 분야가 비어 있어도 빠뜨리지 않는다", () => {
  const picked = selectRotatingKnowledge([
    { id: "무분야", use_count: 0 },
    자료("기획1", "planning", 1),
  ], 2);
  assert.deepEqual(picked.map((item) => item.id).sort(), ["기획1", "무분야"]);
});

test("사용 횟수가 없거나 이상해도 0으로 본다", () => {
  const picked = selectRotatingKnowledge([
    자료("a", "planning", 5),
    { id: "b", expertise_area: "planning", use_count: null, created_at: "2026-01-01" },
  ], 1);
  assert.deepEqual(picked.map((item) => item.id), ["b"]);
});

test("같은 목록이면 항상 같은 결과가 나온다", () => {
  const items = [
    자료("a", "planning", 0, "2026-02-01"),
    자료("b", "consulting", 0, "2026-02-02"),
    자료("c", "ir", 0, "2026-02-03"),
  ];
  const first = selectRotatingKnowledge(items, 2).map((item) => item.id);
  const second = selectRotatingKnowledge([...items].reverse(), 2).map((item) => item.id);
  assert.deepEqual(first, second);
});
