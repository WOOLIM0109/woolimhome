import assert from "node:assert/strict";
import test from "node:test";
import { workerJobFailureDisposition } from "./job-state.ts";

test("a retryable conversion is requeued below its attempt limit", () => {
  assert.equal(workerJobFailureDisposition({
    retryable: true,
    attempts: 2,
    maxAttempts: 3,
  }), "retry");
});

test("a retryable conversion stops when its attempt limit is reached", () => {
  assert.equal(workerJobFailureDisposition({
    retryable: true,
    attempts: 3,
    maxAttempts: 3,
  }), "exhausted");
});

test("a non-retryable conversion remains a permanent failure", () => {
  assert.equal(workerJobFailureDisposition({
    retryable: false,
    attempts: 1,
    maxAttempts: 3,
  }), "permanent");
});
