import assert from "node:assert/strict";
import test from "node:test";
import { getAdminEmails, getPartnerEmails } from "./auth.ts";

test("설정한 주소를 소문자로 다듬어 읽는다", () => {
  assert.deepEqual(
    getAdminEmails({ ADMIN_EMAILS: " First@Example.com , second@example.com ", NODE_ENV: "production" }),
    ["first@example.com", "second@example.com"],
  );
});

/**
 * 이 두 가지가 이 파일의 핵심입니다.
 *
 * 환경변수가 비었을 때 코드에 적힌 계정으로 넘어가면, 변수를 지우거나 이름을
 * 잘못 적어도 아무 일 없는 것처럼 보입니다. 그 계정만 조용히 열린 채로
 * 운영되고, 프리뷰 배포에도 똑같이 열립니다.
 */
test("운영에서 관리자 주소가 비면 아무도 들이지 않는다", () => {
  assert.deepEqual(getAdminEmails({ NODE_ENV: "production" }), []);
  assert.deepEqual(getAdminEmails({ ADMIN_EMAILS: "", NODE_ENV: "production" }), []);
  assert.deepEqual(getAdminEmails({ ADMIN_EMAILS: " , ", NODE_ENV: "production" }), []);
});

test("개발에서는 기본 계정을 남겨 로컬 작업이 막히지 않는다", () => {
  assert.ok(getAdminEmails({ NODE_ENV: "development" }).length > 0);
});

test("외주 주소는 설정한 것만 인정한다", () => {
  assert.deepEqual(getPartnerEmails({ NODE_ENV: "production" }), []);
  assert.deepEqual(getPartnerEmails({ NODE_ENV: "development" }), []);
  assert.deepEqual(
    getPartnerEmails({ PARTNER_EMAILS: "Writer@Example.com" }),
    ["writer@example.com"],
  );
});
