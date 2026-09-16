import assert from "node:assert/strict";
import test from "node:test";

import {
  describeRedactions,
  redactionReasonLabel,
  summarizeRedactions,
} from "./redaction-summary.ts";

test("사유별로 세고 많은 것부터 보여 준다", () => {
  const summary = summarizeRedactions([
    "logo", "logo", "logo",
    "small_text", "small_text",
    "client_identifier",
  ]);
  assert.deepEqual(summary.map((entry) => [entry.reason, entry.count]), [
    ["logo", 3],
    ["small_text", 2],
    ["client_identifier", 1],
  ]);
});

test("같은 개수면 언제나 같은 순서로 나온다", () => {
  const first = summarizeRedactions(["footer", "logo"]);
  const second = summarizeRedactions(["logo", "footer"]);
  assert.deepEqual(first, second);
});

test("사람이 읽을 이름을 붙인다", () => {
  assert.equal(redactionReasonLabel("client_identifier"), "고객사·기관 이름");
  assert.equal(redactionReasonLabel("person_photo"), "사람이 찍힌 사진");
  assert.equal(redactionReasonLabel("small_text"), "잔글씨 (각주·출처)");
  // 모르는 값이 와도 그대로 보여 줍니다. 화면이 비는 것보다 낫습니다.
  assert.equal(redactionReasonLabel("unknown_reason"), "unknown_reason");
});

test("한 줄 설명을 만든다", () => {
  const summary = summarizeRedactions(["logo", "logo", "small_text"]);
  assert.equal(describeRedactions(summary), "로고·워터마크 2곳 · 잔글씨 (각주·출처) 1곳");
  assert.equal(describeRedactions([]), "가린 곳 없음");
});
