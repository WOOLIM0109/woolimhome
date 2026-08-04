import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeWorkerCredential,
  LEGACY_PC_WORKER_LEASE_SECONDS,
  PC_WORKER_ID,
  PC_WORKER_LEASE_SECONDS,
  parseWorkerSecrets,
  resolveWorkerIdentity,
  workerLeaseSeconds,
} from "./identity.ts";

function headers(values = {}) {
  return new Headers(values);
}

test("requests without an identity retain the deployed legacy worker", () => {
  const worker = resolveWorkerIdentity(headers());
  assert.deepEqual(worker, {
    id: PC_WORKER_ID,
    displayName: "울림 집 PC (기존)",
    legacy: true,
  });
  assert.equal(workerLeaseSeconds(worker), LEGACY_PC_WORKER_LEASE_SECONDS);
});

test("headers take precedence while the JSON body supplies a Unicode display name", () => {
  const worker = resolveWorkerIdentity(
    headers({ "X-Woolim-Worker-Id": "woolim-office-pc" }),
    { workerId: "ignored-id", workerName: "울림 사무실 PC" },
  );
  assert.deepEqual(worker, {
    id: "woolim-office-pc",
    displayName: "울림 사무실 PC",
    legacy: false,
  });
  assert.equal(workerLeaseSeconds(worker), PC_WORKER_LEASE_SECONDS);
});

test("invalid worker IDs are rejected before authentication", () => {
  assert.equal(resolveWorkerIdentity(
    headers({ "X-Woolim-Worker-Id": "../../office" }),
  ), null);
  assert.equal(resolveWorkerIdentity(
    headers({ "X-Woolim-Worker-Id": "Woolim-Office-PC" }),
  ), null);
});

test("the shared secret is a rollout fallback while no per-worker registry exists", () => {
  const worker = resolveWorkerIdentity(
    headers({ "X-Woolim-Worker-Id": "woolim-office-pc" }),
  );
  assert.equal(authorizeWorkerCredential(
    worker,
    "Bearer shared-secret",
    { PC_WORKER_SECRET: "shared-secret" },
  ), true);
});

test("an enabled registry requires the matching secret for explicit worker IDs", () => {
  const worker = resolveWorkerIdentity(
    headers({ "X-Woolim-Worker-Id": "woolim-office-pc" }),
  );
  const environment = {
    PC_WORKER_SECRET: "shared-secret",
    PC_WORKER_SECRETS: JSON.stringify({
      "woolim-office-pc": "office-secret",
      "becky-office-pc": "home-secret",
    }),
  };
  assert.equal(authorizeWorkerCredential(worker, "Bearer office-secret", environment), true);
  assert.equal(authorizeWorkerCredential(worker, "Bearer shared-secret", environment), false);
  assert.equal(authorizeWorkerCredential(worker, "Bearer home-secret", environment), false);
});

test("legacy requests continue accepting the shared secret after registry rollout", () => {
  const worker = resolveWorkerIdentity(headers());
  assert.equal(authorizeWorkerCredential(
    worker,
    "Bearer shared-secret",
    {
      PC_WORKER_SECRET: "shared-secret",
      PC_WORKER_SECRETS: JSON.stringify({ "becky-office-pc": "home-secret" }),
    },
  ), true);
});

test("a malformed secret registry fails closed for explicit identities", () => {
  const worker = resolveWorkerIdentity(
    headers({ "X-Woolim-Worker-Id": "woolim-office-pc" }),
  );
  assert.deepEqual(parseWorkerSecrets("not-json"), { configured: true, secrets: {} });
  assert.equal(authorizeWorkerCredential(
    worker,
    "Bearer shared-secret",
    { PC_WORKER_SECRET: "shared-secret", PC_WORKER_SECRETS: "not-json" },
  ), false);
});

test("legacy authentication can be disabled after every worker is migrated", () => {
  const legacyWorker = resolveWorkerIdentity(headers());
  const explicitWorker = resolveWorkerIdentity(
    headers({ "X-Woolim-Worker-Id": "woolim-office-pc" }),
  );
  const environment = {
    PC_WORKER_SECRET: "shared-secret",
    PC_WORKER_SECRETS: JSON.stringify({ "woolim-office-pc": "office-secret" }),
    PC_WORKER_ALLOW_LEGACY: "false",
  };

  assert.equal(authorizeWorkerCredential(
    legacyWorker,
    "Bearer shared-secret",
    environment,
  ), false);
  assert.equal(authorizeWorkerCredential(
    explicitWorker,
    "Bearer shared-secret",
    { PC_WORKER_SECRET: "shared-secret", PC_WORKER_ALLOW_LEGACY: "false" },
  ), false);
  assert.equal(authorizeWorkerCredential(
    explicitWorker,
    "Bearer office-secret",
    environment,
  ), true);
});
