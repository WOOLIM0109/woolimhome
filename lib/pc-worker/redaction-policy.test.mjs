import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDED_REDACTED_REGION_TYPES,
  redactableRegions,
  redactedRegionTypes,
} from "./redaction-manifest.ts";

function 영역(type) {
  return { slideIndex: 0, type, label: `local_${type}`, x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
}

const 모든종류 = [
  영역("body_text"), 영역("small_text"), 영역("table_content"), 영역("chart_label"),
  영역("embedded_photo"), 영역("screenshot"), 영역("logo"), 영역("footer"),
  영역("client_identifier"), 영역("project_identifier"),
];

function 환경(value, work) {
  const before = process.env.PORTFOLIO_REDACTED_REGION_TYPES;
  if (value === null) delete process.env.PORTFOLIO_REDACTED_REGION_TYPES;
  else process.env.PORTFOLIO_REDACTED_REGION_TYPES = value;
  try { work(); } finally {
    if (before === undefined) delete process.env.PORTFOLIO_REDACTED_REGION_TYPES;
    else process.env.PORTFOLIO_REDACTED_REGION_TYPES = before;
  }
}

test("설정이 없으면 지금까지와 같이 모든 영역을 가린다", () => {
  환경(null, () => {
    assert.equal(redactableRegions(모든종류).length, 모든종류.length);
  });
});

test("권장 정책을 켜면 본문·표·차트 라벨은 남는다", () => {
  환경(RECOMMENDED_REDACTED_REGION_TYPES.join(","), () => {
    const 남는것 = 모든종류
      .filter((region) => !redactableRegions(모든종류).includes(region))
      .map((region) => region.type);
    assert.deepEqual(남는것.sort(), ["body_text", "chart_label", "table_content"]);
  });
});

test("권장 정책은 고객사명·개인정보·작은 글씨·로고를 반드시 가린다", () => {
  환경(RECOMMENDED_REDACTED_REGION_TYPES.join(","), () => {
    const 가리는것 = new Set(redactableRegions(모든종류).map((region) => region.type));
    for (const 필수 of ["client_identifier", "project_identifier", "small_text", "logo", "footer"]) {
      assert.ok(가리는것.has(필수), `${필수} 를 가리지 않습니다.`);
    }
  });
});

test("알 수 없는 값이 섞이면 무시하고 나머지만 적용한다", () => {
  환경("client_identifier,없는종류,logo", () => {
    const types = redactedRegionTypes();
    assert.deepEqual([...types].sort(), ["client_identifier", "logo"]);
  });
});

test("전부 알 수 없는 값이면 안전하게 모든 영역을 가린다", () => {
  환경("없는종류,또다른값", () => {
    assert.equal(redactableRegions(모든종류).length, 모든종류.length);
  });
});
