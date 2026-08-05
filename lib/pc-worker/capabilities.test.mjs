import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_REDACTION_WORKER_CAPABILITY,
  supportsLocalRedactionClaims,
} from "./capabilities.ts";

test("accepts a current worker with the explicit local-redaction capability", () => {
  assert.equal(supportsLocalRedactionClaims({
    workerVersion: "2.5.0",
    capabilities: [LOCAL_REDACTION_WORKER_CAPABILITY],
  }), true);
  assert.equal(supportsLocalRedactionClaims({
    workerVersion: "3.0.0-beta.1",
    capabilities: [LOCAL_REDACTION_WORKER_CAPABILITY],
  }), true);
});

test("rejects legacy, malformed, or capability-free workers", () => {
  assert.equal(supportsLocalRedactionClaims({
    workerVersion: "2.4.3",
    capabilities: [LOCAL_REDACTION_WORKER_CAPABILITY],
  }), false);
  assert.equal(supportsLocalRedactionClaims({
    workerVersion: "2.5.0",
    capabilities: [],
  }), false);
  assert.equal(supportsLocalRedactionClaims({ workerVersion: "2.4" }), false);
  assert.equal(supportsLocalRedactionClaims(null), false);
});
