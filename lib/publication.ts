import type { ContentChannel } from "@/lib/content-ops/types";

export type NaverPublicationChannel = Extract<
  ContentChannel,
  "naver_consulting" | "naver_design"
>;

const DEFAULT_NAVER_CHANNEL_ACCOUNTS: Record<NaverPublicationChannel, string> = {
  naver_consulting: "ygamsjzys",
  naver_design: "wl_0109",
};

const NAVER_ACCOUNT_PATTERN = /^[a-z0-9_.-]{2,80}$/;
const NAVER_POST_ID_PATTERN = /^\d{3,30}$/;

export type NormalizedNaverPublication = {
  account: string;
  postId: string;
  normalizedUrl: string;
};

type PublicationValidationFailure = {
  ok: false;
  code:
    | "INVALID_PUBLISHED_URL"
    | "PUBLICATION_ACCOUNT_CONFIG_INVALID"
    | "PUBLISHED_ACCOUNT_MISMATCH";
  message: string;
  expectedAccount?: string;
  receivedAccount?: string;
};

type PublicationValidationResult =
  | PublicationValidationFailure
  | { ok: true; publication: NormalizedNaverPublication; expectedAccount: string };

function normalizedAccount(value: string | null | undefined) {
  const account = value?.trim().toLowerCase() || "";
  return NAVER_ACCOUNT_PATTERN.test(account) ? account : null;
}

export function naverChannelAccounts(raw = process.env.NAVER_CHANNEL_ACCOUNTS) {
  if (!raw?.trim()) {
    return { configured: false, accounts: DEFAULT_NAVER_CHANNEL_ACCOUNTS };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const consulting = normalizedAccount(
      typeof parsed?.naver_consulting === "string" ? parsed.naver_consulting : null,
    );
    const design = normalizedAccount(
      typeof parsed?.naver_design === "string" ? parsed.naver_design : null,
    );
    if (!consulting || !design || consulting === design) {
      return { configured: true, accounts: null };
    }
    return {
      configured: true,
      accounts: { naver_consulting: consulting, naver_design: design },
    };
  } catch {
    return { configured: true, accounts: null };
  }
}

export function expectedNaverAccount(
  channel: NaverPublicationChannel,
  raw = process.env.NAVER_CHANNEL_ACCOUNTS,
) {
  return naverChannelAccounts(raw).accounts?.[channel] || null;
}

export function normalizeNaverBlogUrl(value: unknown): NormalizedNaverPublication | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !["blog.naver.com", "m.blog.naver.com"].includes(hostname)) {
      return null;
    }

    let account: string | null = null;
    let postId = "";
    if (url.pathname.toLowerCase() === "/postview.naver") {
      account = normalizedAccount(url.searchParams.get("blogId"));
      postId = url.searchParams.get("logNo")?.trim() || "";
    } else {
      const segments = url.pathname.split("/").filter(Boolean);
      account = normalizedAccount(segments[0]);
      postId = segments[1]?.trim() || "";
    }

    if (!account || !NAVER_POST_ID_PATTERN.test(postId)) return null;
    return {
      account,
      postId,
      normalizedUrl: `https://blog.naver.com/${account}/${postId}`,
    };
  } catch {
    return null;
  }
}

export function validateNaverPublication(input: {
  channel: NaverPublicationChannel;
  publishedUrl: unknown;
  accountConfig?: string;
}): PublicationValidationResult {
  const publication = normalizeNaverBlogUrl(input.publishedUrl);
  if (!publication) {
    return {
      ok: false as const,
      code: "INVALID_PUBLISHED_URL",
      message: "네이버 블로그의 실제 게시글 주소를 입력해 주세요.",
    };
  }
  const expectedAccount = expectedNaverAccount(input.channel, input.accountConfig);
  if (!expectedAccount) {
    return {
      ok: false as const,
      code: "PUBLICATION_ACCOUNT_CONFIG_INVALID",
      message: "채널별 네이버 계정 서버 설정을 확인해 주세요.",
    };
  }
  if (publication.account !== expectedAccount) {
    return {
      ok: false as const,
      code: "PUBLISHED_ACCOUNT_MISMATCH",
      message: `이 채널은 네이버 계정 ${expectedAccount}의 게시글만 등록할 수 있습니다.`,
      expectedAccount,
      receivedAccount: publication.account,
    };
  }
  return { ok: true as const, publication, expectedAccount };
}
