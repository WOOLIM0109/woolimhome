import assert from "node:assert/strict";
import test from "node:test";
import { actorLabel, appendStatusChange, statusHistoryOf } from "./status-history.ts";

/**
 * 이 기록이 없어서 「어제 10시 글이 왜 안 나왔지」를 알아보려면 매번
 * 저장소에 직접 질의해야 했습니다. 화면에는 답이 없었습니다.
 */

test("상태가 바뀔 때마다 한 줄씩 쌓인다", () => {
  let metadata = appendStatusChange({}, "review_required", "automation@woolimcompany.kr", "2026-08-26T01:11:00Z");
  metadata = appendStatusChange(metadata, "approved", "대표@x.kr", "2026-08-26T05:32:00Z");
  metadata = appendStatusChange(metadata, "published", "대표@x.kr", "2026-08-27T00:05:00Z");
  assert.deepEqual(statusHistoryOf(metadata).map((item) => item.status),
    ["review_required", "approved", "published"]);
});

test("같은 상태를 두 번 써도 줄이 늘지 않는다", () => {
  /*
   * 검토 화면에서 메모만 고쳐도 상태를 함께 보냅니다. 그때마다 줄이 늘면
   * 기록이 금세 쓸모없어집니다. 처음 그 상태가 된 시각을 지킵니다.
   */
  let metadata = appendStatusChange({}, "review_required", "자동", "2026-08-26T01:00:00Z");
  metadata = appendStatusChange(metadata, "review_required", "대표@x.kr", "2026-08-26T09:00:00Z");
  const history = statusHistoryOf(metadata);
  assert.equal(history.length, 1);
  assert.equal(history[0].at, "2026-08-26T01:00:00Z");
});

test("되돌린 기록도 남는다", () => {
  // 승인했다가 보류로 내리고 다시 승인한 것이 보여야 합니다.
  let metadata = appendStatusChange({}, "approved", "대표@x.kr", "2026-08-26T01:00:00Z");
  metadata = appendStatusChange(metadata, "on_hold", "대표@x.kr", "2026-08-26T02:00:00Z");
  metadata = appendStatusChange(metadata, "approved", "대표@x.kr", "2026-08-26T03:00:00Z");
  assert.deepEqual(statusHistoryOf(metadata).map((item) => item.status),
    ["approved", "on_hold", "approved"]);
});

test("metadata 의 다른 항목을 지우지 않는다", () => {
  // 여기서 실수하면 생성 결과와 조사 자료가 통째로 날아갑니다.
  const before = { generated: { title: "제목" }, slotKey: "consult-wed", automated: true };
  const after = appendStatusChange(before, "approved", "대표@x.kr");
  assert.deepEqual(after.generated, { title: "제목" });
  assert.equal(after.slotKey, "consult-wed");
  assert.equal(after.automated, true);
});

test("원래 metadata 를 고치지 않는다", () => {
  const before = { slotKey: "consult-wed" };
  appendStatusChange(before, "approved", "대표@x.kr");
  assert.equal("statusHistory" in before, false);
});

test("기록이 없거나 모양이 이상해도 견딘다", () => {
  assert.deepEqual(statusHistoryOf(null), []);
  assert.deepEqual(statusHistoryOf({}), []);
  assert.deepEqual(statusHistoryOf({ statusHistory: "기록" }), []);
  assert.deepEqual(statusHistoryOf({ statusHistory: [null, 3, { status: "approved", at: "x" }] }),
    [{ status: "approved", at: "x", by: "" }]);
});

test("옛 항목에 기록을 더해도 앞이 비어 있지 않다", () => {
  // 이 기능이 생기기 전에 만들어진 글부터는 그 시점 이후만 남습니다.
  const after = appendStatusChange({ generated: {} }, "published", "대표@x.kr");
  assert.equal(statusHistoryOf(after).length, 1);
});

test("자동으로 된 것과 사람이 한 것을 가른다", () => {
  assert.equal(actorLabel("automation@woolimcompany.kr"), "자동");
  assert.equal(actorLabel("selavento.geo@gmail.com"), "selavento.geo@gmail.com");
  assert.equal(actorLabel(""), "");
});

test("기록이 끝없이 길어지지 않는다", () => {
  let metadata = {};
  for (let index = 0; index < 60; index += 1) {
    // 상태를 번갈아 써야 줄이 실제로 늘어납니다.
    metadata = appendStatusChange(metadata, index % 2 ? "approved" : "on_hold", "대표@x.kr",
      `2026-08-26T00:${String(index).padStart(2, "0")}:00Z`);
  }
  assert.equal(statusHistoryOf(metadata).length, 40);
});
