import assert from "node:assert/strict";
import test from "node:test";
import {
  naverChannelAccounts,
  normalizeNaverBlogUrl,
  validateNaverPublication,
} from "./publication.ts";

test("canonical and PostView Naver URLs normalize to one publication URL", () => {
  assert.deepEqual(normalizeNaverBlogUrl("https://m.blog.naver.com/WL_0109/123456789"), {
    account: "wl_0109",
    postId: "123456789",
    normalizedUrl: "https://blog.naver.com/wl_0109/123456789",
  });
  assert.deepEqual(normalizeNaverBlogUrl(
    "https://blog.naver.com/PostView.naver?blogId=wl_0109&logNo=123456789&redirect=Dlog",
  ), {
    account: "wl_0109",
    postId: "123456789",
    normalizedUrl: "https://blog.naver.com/wl_0109/123456789",
  });
});

test("non-post and non-Naver URLs are rejected", () => {
  assert.equal(normalizeNaverBlogUrl("https://example.com/wl_0109/123456"), null);
  assert.equal(normalizeNaverBlogUrl("https://blog.naver.com/wl_0109"), null);
  assert.equal(normalizeNaverBlogUrl("http://blog.naver.com/wl_0109/123456"), null);
});

test("channel validation uses the server account mapping", () => {
  const config = JSON.stringify({ naver_consulting: "consult", naver_design: "design" });
  assert.equal(validateNaverPublication({
    channel: "naver_design",
    publishedUrl: "https://blog.naver.com/design/123456",
    accountConfig: config,
  }).ok, true);
  const mismatch = validateNaverPublication({
    channel: "naver_design",
    publishedUrl: "https://blog.naver.com/consult/123456",
    accountConfig: config,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "PUBLISHED_ACCOUNT_MISMATCH");
});

test("malformed account configuration fails closed", () => {
  assert.deepEqual(naverChannelAccounts("not-json"), { configured: true, accounts: null });
  assert.equal(validateNaverPublication({
    channel: "naver_design",
    publishedUrl: "https://blog.naver.com/wl_0109/123456",
    accountConfig: "not-json",
  }).code, "PUBLICATION_ACCOUNT_CONFIG_INVALID");
});
