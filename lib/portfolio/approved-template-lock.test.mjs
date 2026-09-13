import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { APPROVED_16X9_BACKGROUNDS } from "./approved-16x9-templates.ts";
import { approvedTemplateFingerprint } from "./approved-mockup-suite-renderer.ts";
import {
  APPROVED_MOCKUP_SUITES,
  approvedMockupSuiteTemplates,
} from "./approved-mockup-suites.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOCK_PATH = path.join(
  REPOSITORY_ROOT,
  "docs",
  "portfolio-mockup-references",
  "stage-1-lock.json",
);
const REQUIRED_ASSET_FILES = [
  "public/fonts/Paperlogy-7Bold.ttf",
  "public/images/mockup-templates/a4-portrait-dark-wood.png",
  "public/images/woolim-logo-cropped.png",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function repositoryAssetPath(file) {
  assert.equal(typeof file, "string", "승인 에셋 경로는 문자열이어야 합니다.");
  assert.ok(file.length > 0, "승인 에셋 경로가 비어 있습니다.");
  assert.equal(path.isAbsolute(file), false, `승인 에셋은 저장소 상대 경로여야 합니다: ${file}`);
  assert.equal(path.win32.isAbsolute(file), false, `Windows 절대 경로를 사용할 수 없습니다: ${file}`);
  assert.equal(path.posix.isAbsolute(file), false, `절대 경로를 사용할 수 없습니다: ${file}`);

  const resolved = path.resolve(REPOSITORY_ROOT, file);
  const relative = path.relative(REPOSITORY_ROOT, resolved);
  assert.ok(
    relative && relative !== ".." && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    `승인 에셋 경로가 저장소 밖으로 나갈 수 없습니다: ${file}`,
  );
  return resolved;
}

async function readLockManifest() {
  try {
    return JSON.parse(await readFile(LOCK_PATH, "utf8"));
  } catch (error) {
    assert.fail(
      `승인 템플릿 lock을 읽지 못했습니다: ${LOCK_PATH}\n`
      + "baseline을 자동으로 다시 만들지 말고 승인 기록과 현재 템플릿을 확인하세요.\n"
      + String(error),
    );
  }
}

test("stage-one lock exactly matches all approved templates and visual assets", async () => {
  const manifest = await readLockManifest();
  assert.equal(manifest.schemaVersion, 1, "stage-1 lock schemaVersion은 1이어야 합니다.");
  assert.ok(Array.isArray(manifest.templates), "stage-1 lock templates가 배열이 아닙니다.");
  assert.ok(Array.isArray(manifest.assetHashes), "stage-1 lock assetHashes가 배열이 아닙니다.");

  const currentTemplates = APPROVED_MOCKUP_SUITES.flatMap((suite) => (
    approvedMockupSuiteTemplates(suite).map((template) => ({
      suiteId: suite.suiteId,
      templateId: template.id,
      version: template.version,
      geometryHash: approvedTemplateFingerprint(template),
      template,
      background: APPROVED_16X9_BACKGROUNDS[template.backgroundId],
    }))
  ));
  assert.equal(currentTemplates.length, 15, "등록된 승인 템플릿은 정확히 15개여야 합니다.");
  assert.equal(
    new Set(currentTemplates.map(({ templateId }) => templateId)).size,
    15,
    "등록된 승인 템플릿 ID가 중복됐습니다.",
  );
  assert.deepEqual(
    manifest.templates,
    currentTemplates,
    "승인 템플릿 ID·버전·geometryHash·좌표·배경이 stage-1 lock과 다릅니다. "
      + "baseline을 자동 갱신하지 말고 변경 시안을 다시 검수·승인하세요.",
  );

  assert.deepEqual(
    [...manifest.assetHashes.map(({ file }) => file)].sort(),
    REQUIRED_ASSET_FILES,
    "stage-1 lock의 승인 에셋 목록이 다릅니다. baseline을 자동 갱신하지 마세요.",
  );
  assert.equal(
    new Set(manifest.assetHashes.map(({ file }) => file)).size,
    manifest.assetHashes.length,
    "stage-1 lock에 같은 에셋 경로가 중복됐습니다.",
  );
  for (const asset of manifest.assetHashes) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/, `${asset.file}: SHA-256 형식이 아닙니다.`);
    const actual = sha256(await readFile(repositoryAssetPath(asset.file)));
    assert.equal(
      actual,
      asset.sha256,
      `${asset.file}: 승인 에셋 bytes가 stage-1 lock과 다릅니다. baseline을 자동 갱신하지 마세요.`,
    );
  }
});
