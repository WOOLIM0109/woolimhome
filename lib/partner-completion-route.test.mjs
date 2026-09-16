import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("../app/api/partner/content/[id]/route.ts", import.meta.url),
  "utf8",
);

test("일반 완료 등록은 원고·목업 상태가 아니라 네이버 주소만 검사한다", () => {
  assert.match(routeSource, /validateNaverPublication/);
  assert.doesNotMatch(routeSource, /partnerEditorialPublicationIssues/);
  assert.doesNotMatch(routeSource, /validatePortfolioPublicationMetadata/);
  assert.doesNotMatch(routeSource, /validatePortfolioSourceState/);
  assert.doesNotMatch(routeSource, /EDITORIAL_REVIEW_REQUIRED/);
  assert.doesNotMatch(routeSource, /PORTFOLIO_REVIEW_REQUIRED/);
});

test("강제승인은 주소를 검증 필드가 아닌 메모로 저장한다", () => {
  assert.match(routeSource, /normalizePartnerForceApprovalMemo/);
  assert.match(routeSource, /forceApproved: true/);
  assert.match(routeSource, /forceApprovalMemo/);
  assert.match(routeSource, /published_url: publication\?\.normalizedUrl \|\| null/);
  assert.match(routeSource, /forced: forceRequested/);
});

test("주소 중복과 동시 수정 보호는 계속 유지한다", () => {
  assert.match(routeSource, /PUBLISHED_URL_CONFLICT/);
  assert.match(routeSource, /published_url_normalized/);
  assert.match(routeSource, /\.eq\("updated_at", item\.updated_at\)/);
});
