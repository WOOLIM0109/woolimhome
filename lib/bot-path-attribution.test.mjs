import assert from "node:assert/strict";
import test from "node:test";
import { attributeBotPath } from "./bot-path-attribution.ts";

/**
 * 이 파일이 지키는 것은 한 가지입니다 — **지금 서비스되는 주소**가
 * `other` 로 떨어지지 않는 것.
 *
 * 예전 코드는 `projects`·`cases` 만 알고 있었습니다. 그런데 `next.config.ts` 가
 * 그 둘을 `/portfolio/*`·`/success/*` 로 308 이동시키므로 봇이 실제로 받아 가는
 * 주소는 뒤쪽입니다. 그래서 30일 봇 방문 4,371건 가운데 1,461건(33%)이
 * 「기타」로 쌓였습니다. 아래 표가 그 회귀를 막습니다.
 */
test("지금 서비스되는 주소가 각자 제 종류로 묶인다", () => {
  const cases = [
    ["/", "home", null],
    ["/about", "company", null],
    ["/services/consulting", "service", "consulting"],
    ["/portfolio", "portfolio", null],
    ["/portfolio/ppt", "portfolio", "ppt"],
    ["/portfolio/business-ir", "portfolio", "business-ir"],
    ["/success", "success", null],
    ["/success/funding", "success", "funding"],
    ["/columns", "column", null],
    ["/columns/b2b-cold-outbound-3steps", "column", "b2b-cold-outbound-3steps"],
    ["/news", "news", null],
    ["/contact", "contact", null],
  ];
  for (const [path, pageKind, entitySlug] of cases) {
    assert.deepEqual(attributeBotPath(path), { pageKind, entitySlug }, path);
  }
});

test("308로 이동당하는 옛 주소는 목적지와 같은 종류로 묶인다", () => {
  assert.deepEqual(attributeBotPath("/projects/design"), { pageKind: "portfolio", entitySlug: "design" });
  assert.deepEqual(attributeBotPath("/cases/ppt"), { pageKind: "success", entitySlug: "ppt" });
});

test("모르는 첫 칸만 기타로 떨어진다", () => {
  assert.deepEqual(attributeBotPath("/index.html"), { pageKind: "other", entitySlug: null });
  assert.deepEqual(attributeBotPath("/wp-login.php"), { pageKind: "other", entitySlug: null });
  assert.deepEqual(attributeBotPath("/sitemap.xml"), { pageKind: "other", entitySlug: null });
});

test("경로 끝 빗금과 한글 주소를 견딘다", () => {
  assert.deepEqual(attributeBotPath("/portfolio/ppt/"), { pageKind: "portfolio", entitySlug: "ppt" });
  assert.deepEqual(attributeBotPath("//about//"), { pageKind: "company", entitySlug: null });
  assert.deepEqual(attributeBotPath("/columns/%EC%B9%BC%EB%9F%BC"), { pageKind: "column", entitySlug: "칼럼" });
  // 깨진 퍼센트 인코딩이 와도 던지지 않고 원문을 그대로 둔다.
  assert.deepEqual(attributeBotPath("/columns/%E0%A4%A"), { pageKind: "column", entitySlug: "%E0%A4%A" });
});

test("슬러그를 쓰지 않는 종류는 뒷조각을 읽지 않는다", () => {
  assert.equal(attributeBotPath("/about/ceo").entitySlug, null);
  assert.equal(attributeBotPath("/contact/pricing").entitySlug, null);
});
