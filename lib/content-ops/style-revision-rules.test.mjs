import assert from "node:assert/strict";
import test from "node:test";
import {
  createStyleRevisionStamp,
  FRIENDLY_STYLE_VERSION,
  hasPublicationEvidence,
  minimumStyleRevisionBodyLength,
  shouldRewritePendingStyleItem,
  styleRevisionFingerprint,
} from "./style-revision-rules.ts";

function candidate(overrides = {}) {
  return {
    status: "review_required",
    published_at: null,
    published_url: null,
    published_url_normalized: null,
    metadata: {
      generated: {
        summary: "요약",
        bodyHtml: "<p>본문입니다.</p>",
        faq: [{ question: "질문인가요?", answer: "답변입니다." }],
      },
    },
    ...overrides,
  };
}

test("검토 요청과 미발행 대기 상태를 정리 대상으로 포함한다", () => {
  for (const status of ["review_required", "approved", "naver_ready", "scheduled"]) {
    assert.equal(shouldRewritePendingStyleItem(candidate({ status })), true, status);
  }
  assert.equal(shouldRewritePendingStyleItem(candidate({ status: "published" })), false);
  assert.equal(shouldRewritePendingStyleItem(candidate({ status: "on_hold" })), false);
});

test("말투 다듬기가 넘어간 원고는 다시 대상이 된다", () => {
  const item = candidate();
  const stamped = candidate({
    metadata: {
      ...item.metadata,
      styleRevision: createStyleRevisionStamp(item.metadata.generated, { styleComplete: false }),
    },
  });
  assert.equal(shouldRewritePendingStyleItem(stamped), true);
});

test("끝까지 다듬은 원고는 다시 손대지 않는다", () => {
  const item = candidate();
  const stamped = candidate({
    metadata: {
      ...item.metadata,
      styleRevision: createStyleRevisionStamp(item.metadata.generated, { styleComplete: true }),
    },
  });
  assert.equal(shouldRewritePendingStyleItem(stamped), false);
});

test("상태가 대기여도 발행 증거가 있으면 제외한다", () => {
  assert.equal(hasPublicationEvidence(candidate({ published_at: "2026-08-10T00:00:00.000Z" })), true);
  assert.equal(hasPublicationEvidence(candidate({ published_url: "https://blog.naver.com/example/1" })), true);
  assert.equal(hasPublicationEvidence(candidate({
    metadata: {
      ...candidate().metadata,
      partnerHandoff: { completedAt: "2026-08-10T00:00:00.000Z" },
    },
  })), true);
  assert.equal(shouldRewritePendingStyleItem(candidate({ published_url_normalized: "https://blog.naver.com/example/1" })), false);
  assert.equal(shouldRewritePendingStyleItem(candidate({ published_account: "example" })), false);
});

test("간결화해도 채널별 최소 본문 길이를 지킨다", () => {
  assert.equal(minimumStyleRevisionBodyLength("informational", 2_000), 1_800);
  assert.equal(minimumStyleRevisionBodyLength("portfolio", 2_000), 1_600);
  assert.equal(minimumStyleRevisionBodyLength("informational", 4_000), 2_600);
  assert.equal(minimumStyleRevisionBodyLength("informational", 1_200), 1_200);
  assert.equal(minimumStyleRevisionBodyLength("portfolio", 1_000), 1_000);
});

test("같은 규칙 버전과 현재 콘텐츠 지문이 모두 같을 때만 건너뛴다", () => {
  const item = candidate();
  const generated = item.metadata.generated;
  const stamp = createStyleRevisionStamp(generated, { appliedBy: "admin@example.com" });
  assert.equal(stamp.version, FRIENDLY_STYLE_VERSION);
  assert.equal(stamp.fingerprint, styleRevisionFingerprint(generated));

  const stamped = {
    ...item,
    metadata: { ...item.metadata, styleRevision: stamp },
  };
  assert.equal(shouldRewritePendingStyleItem(stamped), false);
  assert.equal(shouldRewritePendingStyleItem({
    ...stamped,
    metadata: {
      ...stamped.metadata,
      generated: { ...generated, bodyHtml: "<p>본문이 수정되었습니다.</p>" },
    },
  }), true);
  assert.equal(shouldRewritePendingStyleItem({
    ...stamped,
    metadata: {
      ...stamped.metadata,
      generated: {
        ...generated,
        faq: [{ question: "다른 질문인가요?", answer: "답변입니다." }],
      },
    },
  }), true);
  assert.equal(shouldRewritePendingStyleItem({
    ...stamped,
    metadata: {
      ...stamped.metadata,
      generated: {
        ...generated,
        sourceUrls: ["https://example.com/source"],
      },
    },
  }), true);
});
