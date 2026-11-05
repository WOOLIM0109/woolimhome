/**
 * 같은 공고가 두 줄로 있는 것을 가려냅니다.
 *
 * 같은 사업이 여러 곳에 올라옵니다. 기업마당·K-Startup·소진공이 같은 공고를
 * 서로 다른 제목으로 싣습니다. 실측 2026-11-05: 살아 있는 600건 중 29묶음
 * 58줄이 같은 공고였습니다. LG디스플레이 Dream Play 는 기업마당 줄과
 * K-Startup 줄이 따로 있고, 아침 정독 목록에는 K-Startup 줄이 떴습니다.
 * 그래서 수집기가 뽑아 둔 모집분야가 **목록에 뜨는 줄로 가지 못했습니다.**
 *
 * 이 규칙은 수집기의 `gonggo/dedupe` 를 그대로 옮긴 것입니다. 제목만 보고
 * 접으면 멀쩡한 공고가 사라집니다:
 *
 *     [경기] 하남시 2027년 유기질비료 지원사업 추가
 *     [경기] 화성시 2027년 유기질비료 지원사업 추가   ← 다른 시, 다른 공고
 *
 * 막는 장치가 다섯 개입니다.
 *   1. **같은 곳에서 온 두 건은 비교하지 않습니다.** 위 두 줄은 둘 다
 *      기업마당에서 옵니다. 이것만으로 막힙니다. 한 게시판이 같은 공고를
 *      두 번 올리는 것은 (기관, 공고번호) 로 따로 처리합니다.
 *   2. 지역이 둘 다 적혀 있고 다르면 다른 공고입니다.
 *   3. 마감일이 3일 넘게 벌어지면 다른 공고입니다.
 *   4. 지자체 이름이 양쪽에 있고 겹치지 않으면 다른 공고입니다.
 *   5. 제목에서 해마다·회차마다 달라지는 부분을 걷어낸 뒤 낱말로 비교하고,
 *      애매한 사이는 접지 않고 '확인 필요' 로 남깁니다.
 *
 * 위 두 줄은 1번만으로도 막히지만, 서로 다른 곳에서 올라오더라도 4번에서
 * 걸립니다. 4번이 필요한 이유: 남는 낱말이 {하남시, 유기질비료, 추가} 와
 * {화성시, 유기질비료, 추가} 라서 닮음이 **0.50** 입니다. 접는 기준 0.70 에는
 * 못 미쳐도 '확인 필요' 기준 0.45 는 넘어서, 4번이 없으면 이런 것이 확인
 * 목록에 쌓입니다. 같은 사업명에 지자체만 다른 공고는 아주 흔합니다.
 *
 * 수집기와 다른 점이 하나 있습니다. 수집기는 지역을 비교 묶음의 열쇠로 써서
 * 지역을 못 읽은 건은 지역이 적힌 건과 아예 비교하지 않습니다. 여기서는
 * 마감일로만 묶고 지역은 **둘 다 적혀 있을 때만** 가릅니다 — 홈페이지가 스스로
 * 모은 줄은 지역 칸이 비어 있는 경우가 있고, 비었다고 비교를 막으면 정작
 * 접어야 할 두 줄을 놓칩니다. 빈칸을 '다른 지역' 으로 읽지 않습니다.
 */

/** 같은 공고로 볼 제목 닮음 기준. 기관명까지 같으면 더 낮은 값도 인정합니다. */
export const SAME_TITLE = 0.70;
export const SAME_TITLE_WITH_ORG = 0.55;
/** 이 사이는 접지 않고 '확인 필요' 로 남깁니다. */
export const MAYBE_TITLE = 0.45;
/** 마감일이 이만큼 안에 있어야 비교합니다. */
export const DEADLINE_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

// 제목 앞에 붙는 지역·분류 꼬리표: [부산] [경북] [모집공고]
const BRACKET = /[[(【][^\])】]{1,14}[\])】]/gu;
// 연도: 2026년도 / 2026년 / '26년 / 26년.
// 파이썬 `\b` 는 한글도 낱말 글자로 보므로, 앞 글자가 글자·숫자가 아닐 때만 봅니다.
const YEAR = /(?:20\d{2}|['’]\d{2}|(?<![\p{L}\p{N}_])\d{2})\s*년도?/gu;
// 공고 호수: 공고 제2026-185호 / 2026-185호
const NOTICE_NO = /제?\s*20\d{2}\s*-\s*\d+\s*호/gu;
// '년' 없이 연도만 적은 것: [2027 Dream Play]. 포털마다 적는 법이 달라서
// 한쪽은 '2027년', 한쪽은 '2027' 입니다. 걷어내지 않으면 닮음이 깎입니다.
const YEAR_BARE = /(?<![\p{L}\p{N}_])20\d{2}(?![\p{L}\p{N}_])/gu;
// 회차: 제2차 / 2차 / 3회 / 4기 ('기술' 의 기는 아닙니다)
const ROUND = /제?\s*(\d{1,2})\s*(?:차|회|기(?!술))/gu;
// 개정 표시
const REVISION = /(변경|수정|정정|연장|재공고|추가\s*모집|재모집|마감\s*안내)/gu;
const TOKEN = /[가-힣A-Za-z0-9]+/gu;
/**
 * 지자체 이름으로 보이는 낱말: 하남시 · 화성시 · 옹진군.
 *
 * 같은 사업명에 지자체만 다른 공고가 아주 흔합니다 (유기질비료·농기계·
 * 소상공인 지원). 제목 닮음만 보면 이런 것이 0.50 까지 나와 '확인 필요' 에
 * 쌓입니다. 지자체 이름이 양쪽에 있고 서로 겹치지 않으면 다른 공고입니다.
 *
 * 세 글자 이상만 봅니다 — '일시·즉시·공군' 같은 두 글자 낱말을 지자체로
 * 읽으면 안 됩니다. '구' 로 끝나는 것은 보지 않습니다 ('연구·지구·기구' 가
 * 걸립니다). 동구·북구처럼 두 글자인 자치구는 이 장치로 가려지지 않고
 * 제목 닮음으로 넘어갑니다.
 *
 * 꼬리표를 떼고 비교합니다. 포털마다 '서울시' 와 '서울특별시' 로 다르게 적는데,
 * 글자 그대로 보면 **같은 곳이 다른 곳으로 읽혀** 접어야 할 두 줄이 갈립니다.
 */
const PLACE = /^.{2,}(?:시|군)$/u;
const PLACE_TAIL = /(?:특별자치시|특별시|광역시|자치시|시|군)$/u;

function placeKey(token: string) {
  const bare = token.replace(PLACE_TAIL, "");
  return bare.length >= 2 ? bare : token;
}
const WHITESPACE = /\s+/gu;
// 법인 형태 표기와 괄호. 기관명을 비교할 때 걷어냅니다.
const ORG_NOISE = /[(（][^)）]*[)）]|주식회사|㈜|재단법인|사단법인|\s/gu;

/** 흔해서 구분에 도움이 안 되는 낱말. 이것만 겹쳐도 같은 공고로 보지 않습니다. */
const STOPWORDS = new Set([
  "공고", "모집", "안내", "사업", "지원", "지원사업", "참여", "참여기업", "신청",
  "접수", "선정", "기업", "모집공고", "시행", "시행계획", "계획", "및", "등",
  "관련", "대상", "자", "공모", "추천", "운영", "년", "차", "회",
  // 수집기 목록에 없는 것을 세 개 더했습니다. 포털마다 같은 뜻을 다르게 적습니다
  // ('참가기업 모집' 과 '참여기업 모집'), '추가' 는 아무것도 구분해 주지 않습니다.
  "참가", "참가기업", "추가",
]);

/** 제목에서 해마다·회차마다 달라지는 부분을 떼어 낸 결과. */
export type TitleParts = {
  normalized: string;
  tokens: Set<string>;
  /** 제목에 적힌 지자체 이름. 비어 있으면 지자체로 가리지 않습니다. */
  places: Set<string>;
};

/**
 * 쪼갠 결과를 재사용합니다. 살아 있는 공고 141건을 서로 비교하면 짝이 1만 개쯤
 * 되고, 그때마다 제목을 다시 쪼개면 2만 번 쪼갭니다. 같은 제목은 한 번만 쪼갭니다.
 */
const CACHE = new Map<string, TitleParts>();
const CACHE_MAX = 4_000;

export function splitTitle(title: string): TitleParts {
  const cached = CACHE.get(title);
  if (cached) return cached;
  const parts = splitTitleUncached(title);
  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(title, parts);
  return parts;
}

function splitTitleUncached(title: string): TitleParts {
  if (!title) return { normalized: "", tokens: new Set(), places: new Set() };
  const text = title.normalize("NFC");
  const stripped = text
    .replace(BRACKET, " ")
    .replace(NOTICE_NO, " ")
    .replace(YEAR, " ")
    .replace(YEAR_BARE, " ")
    .replace(ROUND, " ")
    .replace(REVISION, " ");
  const normalized = stripped.replace(WHITESPACE, " ").trim().replace(/^[-·,.\s]+|[-·,.\s]+$/gu, "");
  // 지자체 이름은 꼬리표를 뗀 모양으로 담습니다 — '서울시' 와 '서울특별시' 가
  // 같은 낱말이 되어야 닮음이 깎이지 않습니다.
  const tokens = new Set<string>();
  const places = new Set<string>();
  for (const token of normalized.match(TOKEN) ?? []) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    if (!PLACE.test(token)) { tokens.add(token); continue; }
    const key = placeKey(token);
    tokens.add(key);
    places.add(key);
  }
  return { normalized, tokens, places };
}

function disjoint(left: Set<string>, right: Set<string>) {
  for (const value of left) if (right.has(value)) return false;
  return true;
}

export function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** 기관명 비교용. 법인 형태 표기와 괄호를 걷어냅니다. */
export function orgKey(name: string | null | undefined) {
  return (name ?? "").replace(ORG_NOISE, "").toLowerCase();
}

/**
 * 광역 지역 이름을 하나의 열쇠로 모읍니다. 모르는 값은 빈 글자입니다.
 *
 * 지역 칸을 글자 그대로 쓰면 안 됩니다 (실측 2026-11-06, 살아 있는 141건):
 *   - `["전국"]` 27건. **지역 제한이 없다**는 뜻이라 `["서울특별시"]` 와
 *     부딪히지 않습니다. 이걸 '다른 지역' 으로 읽어서 LG디스플레이 공고
 *     두 줄(기업마당 `서울특별시` · K-Startup `전국`)이 접히지 않았습니다.
 *   - `["과학기술정보통신부"]` `["중소벤처기업부"]` `["산업통상부"]` 18건.
 *     지역이 아니라 부처 이름입니다. 모르는 값으로 두고 가리지 않습니다.
 *   - `[]` 58건. 비었습니다.
 *
 * 그래서 **아는 광역 이름일 때만** 가립니다. 빈칸도, 전국도, 모르는 값도
 * '다른 지역' 으로 읽지 않습니다.
 */
const REGION_CODES: [RegExp, string][] = [
  [/^서울/u, "서울"], [/^부산/u, "부산"], [/^대구/u, "대구"], [/^인천/u, "인천"],
  [/^광주/u, "광주"], [/^대전/u, "대전"], [/^울산/u, "울산"], [/^세종/u, "세종"],
  [/^경기/u, "경기"], [/^강원/u, "강원"], [/^제주/u, "제주"],
  [/^충(?:청)?북/u, "충북"], [/^충(?:청)?남/u, "충남"],
  [/^전(?:라)?북/u, "전북"], [/^전(?:라)?남/u, "전남"],
  [/^경(?:상)?북/u, "경북"], [/^경(?:상)?남/u, "경남"],
];

export function regionCode(regions: readonly string[] | null | undefined) {
  const first = (regions ?? []).map((value) => (value ?? "").trim()).find(Boolean) ?? "";
  if (!first || first.startsWith("전국")) return "";
  return REGION_CODES.find(([pattern]) => pattern.test(first))?.[1] ?? "";
}

/** 비교에 쓰는 공고 한 줄. 화면 행에서 이 모양만 뽑아 씁니다. */
export type DedupeRow = {
  id: string;
  title: string;
  /** 어디서 온 줄인가. **같으면 비교하지 않습니다** — 한 게시판의 두 건은 다른 공고입니다. */
  sourceId: string | null;
  orgName?: string | null;
  regions?: readonly string[] | null;
  /** 마감 시각 (ISO). 없으면 없는 것끼리만 비교합니다. */
  deadlineAt?: string | null;
};

export type Verdict = "same" | "maybe" | "different";

function deadlineMs(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * 두 줄이 같은 공고인가.
 *
 * `maybe` 는 접지 않습니다 — 사람이 보게 남깁니다. 공고를 사라지게 하느니
 * 두 줄로 두는 편이 낫습니다.
 */
export function classify(left: DedupeRow, right: DedupeRow): Verdict {
  // 1. 같은 곳에서 온 두 건은 서로 다른 공고로 봅니다.
  if (left.sourceId && right.sourceId && left.sourceId === right.sourceId) return "different";

  // 2. 아는 광역 지역이 둘 다 있고 다르면 다른 공고입니다. 빈칸·전국은 가리지 않습니다.
  const leftRegion = regionCode(left.regions);
  const rightRegion = regionCode(right.regions);
  if (leftRegion && rightRegion && leftRegion !== rightRegion) return "different";

  // 3. 마감일. 한쪽만 비어 있으면 비교하지 않습니다.
  const leftDeadline = deadlineMs(left.deadlineAt);
  const rightDeadline = deadlineMs(right.deadlineAt);
  if ((leftDeadline === null) !== (rightDeadline === null)) return "different";
  if (leftDeadline !== null && rightDeadline !== null
    && Math.abs(leftDeadline - rightDeadline) > DEADLINE_WINDOW_DAYS * DAY_MS) return "different";

  // 4. 지자체 이름이 양쪽에 있고 겹치지 않으면 다른 공고입니다.
  const leftTitle = splitTitle(left.title);
  const rightTitle = splitTitle(right.title);
  if (leftTitle.places.size && rightTitle.places.size
    && disjoint(leftTitle.places, rightTitle.places)) return "different";

  // 5. 제목 닮음. 기관명까지 같으면 기준을 낮춥니다.
  const score = jaccard(leftTitle.tokens, rightTitle.tokens);
  const leftOrg = orgKey(left.orgName);
  const sameOrg = Boolean(leftOrg) && leftOrg === orgKey(right.orgName);
  if (score >= (sameOrg ? SAME_TITLE_WITH_ORG : SAME_TITLE)) return "same";
  return score >= MAYBE_TITLE ? "maybe" : "different";
}

/** 같은 공고로 묶인 한 묶음. 하나도 버리지 않습니다. */
export type DuplicateGroup<T extends DedupeRow> = {
  members: T[];
  /** 접기에는 애매해서 사람이 봐야 하는 줄. */
  uncertain: T[];
};

/**
 * 같은 공고로 보이는 줄들을 묶습니다.
 *
 * 들어온 순서대로 훑으면서 이미 만든 묶음에 붙입니다. 묶음 안의 **모든** 줄과
 * 비교해서 하나라도 `different` 면 붙이지 않습니다 — 셋이 사슬처럼 이어져
 * 엉뚱한 둘이 한 묶음에 드는 것을 막습니다.
 */
export function groupDuplicates<T extends DedupeRow>(rows: readonly T[]): DuplicateGroup<T>[] {
  const groups: DuplicateGroup<T>[] = [];
  for (const row of rows) {
    let placed = false;
    for (const group of groups) {
      const verdicts = group.members.map((member) => classify(row, member));
      if (verdicts.some((verdict) => verdict === "different")) continue;
      if (verdicts.every((verdict) => verdict === "same")) {
        group.members.push(row);
        placed = true;
        break;
      }
      // 하나라도 애매하면 묶지 않고, 그 묶음에 '확인 필요' 로 달아 둡니다.
      if (verdicts.some((verdict) => verdict === "maybe")) {
        group.uncertain.push(row);
      }
    }
    if (!placed) groups.push({ members: [row], uncertain: [] });
  }
  return groups;
}

/** 두 줄 이상인 묶음만. 접을 거리입니다. */
export function duplicateGroups<T extends DedupeRow>(rows: readonly T[]) {
  return groupDuplicates(rows).filter((group) => group.members.length > 1);
}
