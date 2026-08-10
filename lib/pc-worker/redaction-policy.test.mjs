import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_REGION_TYPES,
  DEFAULT_REDACTED_REGION_TYPES,
  redactableRegions,
  redactedRegionTypes,
  smallTextMaxHeight,
} from "./redaction-manifest.ts";

function 영역(type, height = 0.02) {
  return { slideIndex: 0, type, label: `local_${type}`, x: 0.1, y: 0.1, width: 0.2, height };
}

const 모든종류 = [
  영역("body_text"), 영역("small_text"), 영역("table_content"), 영역("chart_label"),
  영역("embedded_photo"), 영역("screenshot"), 영역("logo"), 영역("footer"),
  영역("client_identifier"), 영역("project_identifier"),
];

function 환경(value, work, key = "PORTFOLIO_REDACTED_REGION_TYPES") {
  const before = process.env[key];
  if (value === null) delete process.env[key];
  else process.env[key] = value;
  try { work(); } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
}

test("기본 정책은 고객사명·개인정보·작은 글씨·로고·바닥글만 가린다", () => {
  환경(null, () => {
    const 가리는것 = [...new Set(redactableRegions(모든종류).map((region) => region.type))].sort();
    assert.deepEqual(가리는것, [...DEFAULT_REDACTED_REGION_TYPES].sort());
  });
});

test("기본 정책에서 본문·표·차트·사진·화면 캡처는 남는다", () => {
  환경(null, () => {
    const 가리는것 = new Set(redactableRegions(모든종류).map((region) => region.type));
    for (const 남길것 of ["body_text", "table_content", "chart_label", "embedded_photo", "screenshot"]) {
      assert.ok(!가리는것.has(남길것), `${남길것} 을 가리면 장표가 뭉개집니다.`);
    }
  });
});

test("기본 정책은 고객사명·개인정보·작은 글씨·로고를 반드시 가린다", () => {
  환경(null, () => {
    const 가리는것 = new Set(redactableRegions(모든종류).map((region) => region.type));
    for (const 필수 of ["client_identifier", "project_identifier", "small_text", "logo", "footer"]) {
      assert.ok(가리는것.has(필수), `${필수} 를 가리지 않습니다.`);
    }
  });
});

test("예전처럼 전부 가리도록 환경변수로 되돌릴 수 있다", () => {
  환경(ALL_REGION_TYPES.join(","), () => {
    assert.equal(redactableRegions(모든종류).length, 모든종류.length);
  });
});

test("알 수 없는 값이 섞이면 무시하고 나머지만 적용한다", () => {
  환경("client_identifier,없는종류,logo", () => {
    const types = redactedRegionTypes();
    assert.deepEqual([...types].sort(), ["client_identifier", "logo"]);
  });
});

test("전부 알 수 없는 값이면 기본 정책으로 돌아간다", () => {
  환경("없는종류,또다른값", () => {
    assert.deepEqual([...redactedRegionTypes()].sort(), [...DEFAULT_REDACTED_REGION_TYPES].sort());
  });
});

test("작은 글씨로 기록됐어도 본문 크기면 가리지 않는다", () => {
  // 실제로 보고된 현상: 워커가 18pt 미만을 전부 작은 글씨로 분류해
  // 제안서 본문이 통째로 가려졌습니다. 높이로 한 번 더 거릅니다.
  환경(null, () => {
    const 본문크기 = [영역("small_text", 0.05)];
    assert.equal(redactableRegions(본문크기).length, 0);
  });
});

test("각주 크기의 작은 글씨는 그대로 가린다", () => {
  환경(null, () => {
    const 각주 = [영역("small_text", 0.02)];
    assert.equal(redactableRegions(각주).length, 1);
  });
});

test("높이 기준을 환경변수로 넓힐 수 있다", () => {
  환경("0.08", () => {
    assert.equal(smallTextMaxHeight(), 0.08);
    assert.equal(redactableRegions([영역("small_text", 0.05)]).length, 1);
  }, "PORTFOLIO_SMALL_TEXT_MAX_HEIGHT");
});

test("잘못된 높이 값은 무시하고 기본값을 쓴다", () => {
  환경("이상한값", () => {
    assert.equal(smallTextMaxHeight(), 0.028);
  }, "PORTFOLIO_SMALL_TEXT_MAX_HEIGHT");
  환경("-1", () => {
    assert.equal(smallTextMaxHeight(), 0.028);
  }, "PORTFOLIO_SMALL_TEXT_MAX_HEIGHT");
});

test("높이 정보가 없는 기록은 예전처럼 가린다", () => {
  환경(null, () => {
    const 높이없음 = [{ slideIndex: 0, type: "small_text", label: "local_small_text" }];
    assert.equal(redactableRegions(높이없음).length, 1);
  });
});
