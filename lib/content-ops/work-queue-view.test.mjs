import assert from "node:assert/strict";
import test from "node:test";
import {
  filterWorkQueueItems,
  isChannelWorkspaceItem,
  isReviewQueueItem,
} from "./work-queue-view.ts";

const ITEMS = [
  {
    channel: "naver_design",
    format: "portfolio",
    status: "review_required",
    title: "아파트 입찰 제안서",
    summary: "검토가 필요한 완성본",
    source_label: "NAVER WORKS",
    source_reference: "우리페인트_입찰제안용.pptx",
  },
  {
    channel: "naver_design",
    format: "design_insight",
    status: "on_hold",
    title: "PPT 글꼴 고르는 법",
    summary: "보류 원고",
    source_label: "공식 출처",
    source_reference: null,
  },
  {
    channel: "naver_consulting",
    format: "informational",
    status: "approved",
    title: "정책자금 안내",
    summary: "포스팅 대기",
    source_label: "기업마당",
    source_reference: "https://example.com/policy",
  },
];

test("review and channel workspaces partition every item without overlap", () => {
  const review = ITEMS.filter(isReviewQueueItem);
  const workspace = ITEMS.filter(isChannelWorkspaceItem);

  assert.deepEqual(review.map((item) => item.title), ["아파트 입찰 제안서"]);
  assert.equal(review.length + workspace.length, ITEMS.length);
  assert.deepEqual(review.filter((item) => workspace.includes(item)), []);
});

test("combines search, status, format, and channel filters", () => {
  assert.deepEqual(filterWorkQueueItems(ITEMS, { query: "우리페인트" }).map((item) => item.title), [
    "아파트 입찰 제안서",
  ]);
  assert.deepEqual(filterWorkQueueItems(ITEMS, {
    status: "approved",
    format: "informational",
    channel: "naver_consulting",
  }).map((item) => item.title), ["정책자금 안내"]);
  assert.deepEqual(filterWorkQueueItems(ITEMS, {
    query: "  ppt 글꼴  ",
    status: "on_hold",
    format: "design_insight",
    channel: "naver_design",
  }).map((item) => item.title), ["PPT 글꼴 고르는 법"]);
});

test("all filter values keep the complete list", () => {
  assert.equal(filterWorkQueueItems(ITEMS, {
    query: "",
    status: "all",
    format: "all",
    channel: "all",
  }).length, ITEMS.length);
});
