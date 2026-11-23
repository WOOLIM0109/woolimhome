/**
 * 봇이 다녀간 경로를 "어떤 종류의 페이지인가"로 묶습니다.
 *
 * 주의 — 여기 적는 첫 칸(`/` 다음 첫 조각)은 **지금 서비스되는 주소**여야 합니다.
 * `next.config.ts`의 `redirects()`가 `/projects/*` → `/portfolio/*`,
 * `/cases/*` → `/success/*` 로 308 영구 이동을 걸어 두었으므로, 봇이 실제로
 * 받아 가는 주소는 `portfolio`·`success` 쪽입니다. 예전에는 이 함수가
 * `projects`·`cases` 만 알고 있어서 `/portfolio/*`·`/success/*` 방문이 전부
 * `other` 로 떨어졌습니다(2026-11-24 실측: 30일 4,371건 중 1,461건, 33%).
 *
 * 옛 주소도 그대로 남겨 둡니다. 이동당하기 전에 기록된 방문과, 외부에 아직
 * 남아 있는 옛 링크를 타고 오는 봇이 같은 종류로 묶여야 하기 때문입니다.
 */
export type BotPageKind =
  | "home"
  | "company"
  | "service"
  | "portfolio"
  | "success"
  | "column"
  | "news"
  | "contact"
  | "other";

export interface BotPathAttribution {
  pageKind: BotPageKind;
  entitySlug: string | null;
}

/** 첫 조각 → 페이지 종류. 옛 주소(`projects`·`cases`)는 이동 목적지와 같은 종류로 묶습니다. */
const HEAD_TO_KIND: Record<string, BotPageKind> = {
  about: "company",
  services: "service",
  portfolio: "portfolio",
  projects: "portfolio",
  success: "success",
  cases: "success",
  columns: "column",
  news: "news",
  contact: "contact",
};

/** 뒤에 개별 대상(슬러그)이 붙는 종류. 나머지는 슬러그를 읽지 않습니다. */
const KINDS_WITH_SLUG = new Set<BotPageKind>([
  "service",
  "portfolio",
  "success",
  "column",
  "news",
]);

function segment(parts: string[], index: number) {
  const raw = parts[index];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function attributeBotPath(pathname: string): BotPathAttribution {
  if (!pathname || pathname === "/") return { pageKind: "home", entitySlug: null };
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const head = parts[0];
  if (!head) return { pageKind: "home", entitySlug: null };

  const kind = HEAD_TO_KIND[head];
  if (!kind) return { pageKind: "other", entitySlug: segment(parts, 1) };
  return {
    pageKind: kind,
    entitySlug: KINDS_WITH_SLUG.has(kind) ? segment(parts, 1) : null,
  };
}
