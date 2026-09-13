import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  approvedTemplateFingerprint,
  renderApprovedMockupSuite,
} from "./approved-mockup-suite-renderer.ts";
import {
  approvedMockupSuiteTemplates,
  getRegisteredApprovedMockupSuite,
} from "./approved-mockup-suites.ts";
import { renderShortDocumentMockups } from "./short-mockup.ts";

const SUITE_CASES = [
  { aspectClass: "16:9", count: 8, width: 320, height: 180 },
  { aspectClass: "a4_landscape", count: 7, width: 280, height: 198 },
  { aspectClass: "a4_portrait", count: 7, width: 198, height: 280 },
];

async function samplePng({ width, height, index, variant = 0 }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: {
        r: (31 + index * 47 + variant * 19) % 256,
        g: (83 + index * 71 + variant * 29) % 256,
        b: (149 + index * 37 + variant * 43) % 256,
      },
    },
  }).png().toBuffer();
}

async function sampleSlides(suiteCase, count = suiteCase.count) {
  return Promise.all(Array.from({ length: count }, async (_, index) => ({
    index,
    buffer: await samplePng({ ...suiteCase, index }),
  })));
}

function assignmentGeometry(asset) {
  return asset.slotAssignments.map((assignment) => ({
    slotId: assignment.slotId,
    role: assignment.role,
    sourceSlideIndex: assignment.sourceSlideIndex,
    x: assignment.x,
    y: assignment.y,
    width: assignment.width,
    height: assignment.height,
    angle: assignment.angle,
    z: assignment.z,
  }));
}

test("strictly fills every approved slot in all three suites with real PNG slides", {
  timeout: 120_000,
}, async () => {
  for (const suiteCase of SUITE_CASES) {
    const slides = await sampleSlides(suiteCase);
    const coverIndex = slides.at(-1).index;
    const suite = getRegisteredApprovedMockupSuite(suiteCase.aspectClass);
    assert.ok(suite);
    const result = await renderApprovedMockupSuite({
      aspectClass: suiteCase.aspectClass,
      slides,
      coverIndex,
      title: "승인 템플릿 렌더 검증",
    });

    assert.equal(result.aspectClass, suiteCase.aspectClass);
    assert.equal(result.assets.length, 5);
    assert.ok(result.geometry.every((geometry) => geometry.passed));
    assert.equal(result.assets[0].slotAssignments[0].sourceSlideIndex, coverIndex);
    assert.deepEqual(
      result.assets.map((asset) => asset.geometryHash),
      approvedMockupSuiteTemplates(suite).map(approvedTemplateFingerprint),
    );

    for (const [index, asset] of result.assets.entries()) {
      const templateContract = result.contract.templates[index];
      assert.equal(asset.templateId, templateContract.templateId);
      assert.equal(asset.slotAssignments.length, templateContract.requiredSlotCount);
      assert.equal(
        new Set(asset.slotAssignments.map((assignment) => assignment.sourceSlideIndex)).size,
        templateContract.requiredSlotCount,
      );
      assert.ok(asset.slotAssignments.every((assignment) => /^[a-f0-9]{64}$/.test(
        assignment.contentHash,
      )));
      assert.equal(asset.geometryHash.length, 64);

      const metadata = await sharp(asset.bytes).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.deepEqual([metadata.width, metadata.height], [asset.width, asset.height]);
    }

    if (suiteCase.aspectClass === "16:9") {
      const changedSlides = [...slides];
      changedSlides[2] = {
        index: slides[2].index,
        buffer: await samplePng({ ...suiteCase, index: 2, variant: 11 }),
      };
      const changed = await renderApprovedMockupSuite({
        aspectClass: suiteCase.aspectClass,
        slides: changedSlides,
        coverIndex,
        title: "승인 템플릿 렌더 검증",
      });

      assert.deepEqual(
        changed.assets.map((asset) => asset.geometryHash),
        result.assets.map((asset) => asset.geometryHash),
      );
      assert.deepEqual(
        changed.assets.map(assignmentGeometry),
        result.assets.map(assignmentGeometry),
      );
      assert.ok(changed.assets.some((asset, index) => !asset.bytes.equals(result.assets[index].bytes)));
      assert.ok(changed.assets.some((asset, index) => (
        asset.slotAssignments.some((assignment, slotIndex) => (
          assignment.contentHash !== result.assets[index].slotAssignments[slotIndex].contentHash
        ))
      )));
    }
  }
});

test("rejects a source shortage before rendering any approved suite", async () => {
  for (const suiteCase of SUITE_CASES) {
    const slides = await sampleSlides(suiteCase, suiteCase.count - 1);
    await assert.rejects(
      renderApprovedMockupSuite({ aspectClass: suiteCase.aspectClass, slides }),
      new RegExp(`서로 다른 장표 ${suiteCase.count}장이 필요합니다`),
    );
  }
});

test("rejects duplicate source indexes and duplicate image bytes", async () => {
  const suiteCase = SUITE_CASES[0];
  const slides = await sampleSlides(suiteCase);

  await assert.rejects(
    renderApprovedMockupSuite({
      aspectClass: suiteCase.aspectClass,
      slides: slides.map((slide, index) => index === 1 ? { ...slide, index: 0 } : slide),
    }),
    /원본 장표 1이 중복됐습니다/,
  );
  await assert.rejects(
    renderApprovedMockupSuite({
      aspectClass: suiteCase.aspectClass,
      slides: slides.map((slide, index) => index === 1
        ? { ...slide, buffer: slides[0].buffer }
        : slide),
    }),
    /내용이 같은 장표 이미지가 중복됐습니다/,
  );
});

test("rejects a wrong source aspect, missing cover, and unsupported 4:3", async () => {
  const suiteCase = SUITE_CASES[0];
  const slides = await sampleSlides(suiteCase);
  const wrongAspect = [...slides];
  wrongAspect[0] = {
    index: 0,
    buffer: await samplePng({ width: 180, height: 320, index: 0, variant: 5 }),
  };

  await assert.rejects(
    renderApprovedMockupSuite({ aspectClass: suiteCase.aspectClass, slides: wrongAspect }),
    /비율이 16:9 템플릿과 다릅니다/,
  );
  await assert.rejects(
    renderApprovedMockupSuite({ aspectClass: suiteCase.aspectClass, slides, coverIndex: 99 }),
    /선택된 장표에 표지 장표가 없습니다/,
  );
  await assert.rejects(
    renderApprovedMockupSuite({ aspectClass: "4:3", slides: [] }),
    /승인된 목업 세트가 없는 규격입니다: 4:3/,
  );
});

test("keeps a five-slide portrait deck on the existing production templates", {
  timeout: 60_000,
}, async () => {
  const suiteCase = SUITE_CASES.find(({ aspectClass }) => aspectClass === "a4_portrait");
  const slides = await sampleSlides(suiteCase, 5);
  const result = await renderShortDocumentMockups({
    deckSlideCount: 5,
    aspectClass: "a4_portrait",
    slides,
  });

  assert.equal(result.boards.length, 4);
  assert.ok(result.boards.every((board) => (
    board.mockupTemplateId.startsWith("legacy-a4_portrait-")
  )));
  assert.ok(result.boards.every((board) => (
    !board.mockupTemplateId.startsWith("a4-portrait-")
  )));
});
