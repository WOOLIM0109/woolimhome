import { CONSULTING_TOPIC_FAMILIES } from "../content-ops/config.ts";

/**
 * 칼럼 주제를 고르게 펴는 장치.
 *
 * 예전에는 중기부 RSS 오늘치를 그대로 주제로 썼습니다. 그러다 보니 나오는 글이
 * 전부 "정부가 무엇을 발표했다"였고, 마케팅·재무·조직 같은 주제는 이름만 있고
 * 나올 통로가 없었습니다. 매일 올려도 검색해서 들어올 이유가 없는 글이었습니다.
 *
 * 컨설팅 블로그는 이 문제를 이미 풀어 두었습니다. 주제군을 정해 놓고, 최근에
 * 안 다룬 쪽에서 먼저 고릅니다. 칼럼도 같은 목록을 씁니다. 두 채널이 서로 다른
 * 주제군을 갖게 되면 한쪽만 조용히 좁아집니다.
 */
export const COLUMN_TOPIC_FAMILIES = CONSULTING_TOPIC_FAMILIES;

/**
 * 지난 글이 어느 주제군이었는지 알아냅니다.
 *
 * 앞으로 만드는 글은 주제군을 기록에 남기므로 그대로 읽으면 됩니다. 그러나 이미
 * 쌓여 있는 글에는 그 기록이 없습니다. 그것들을 "주제군 없음"으로 두면 최근에
 * 무엇을 다뤘는지 알 수 없어, 고치기 전과 똑같이 지원사업만 반복하게 됩니다.
 * 그래서 기록이 없으면 제목·태그에 나온 말로 짐작합니다.
 */
const FAMILY_HINTS: [string, string[]][] = [
  ["정책자금·융자·투자유치", ["정책자금", "융자", "보증", "투자유치", "vc", "대출", "펀드"]],
  ["정부지원사업·R&D", ["지원사업", "보조금", "r&d", "연구개발", "공고", "선정", "바우처"]],
  ["기업인증·제품인증·해외인증", ["인증", "iso", "ce", "kc", "벤처기업", "이노비즈", "메인비즈"]],
  ["사업계획서·IR", ["사업계획서", "ir", "피칭", "투자제안", "ir덱", "발표자료"]],
  ["창업·법인설립", ["창업", "법인설립", "개인사업자", "사업자등록", "예비창업"]],
  ["마케팅·영업", ["마케팅", "영업", "브랜딩", "광고", "고객", "seo", "콘텐츠"]],
  ["재무·수익구조", ["재무", "회계", "세무", "세금", "원가", "수익구조", "현금흐름", "결산"]],
  ["조직·업무체계", ["조직", "인사", "채용", "노무", "근로", "업무체계", "취업규칙"]],
  ["수출·해외진출", ["수출", "해외진출", "무역", "관세", "바이어", "fta"]],
  ["기술사업화·지식재산", ["특허", "상표", "지식재산", "기술이전", "기술사업화", "ip"]],
  ["조달·입찰·공공시장", ["조달", "입찰", "나라장터", "공공시장", "관급"]],
  ["위기관리·문제해결", ["위기", "폐업", "구조조정", "분쟁", "리스크", "회생"]],
  ["경영전략·사업기획", ["경영전략", "사업기획", "비즈니스모델", "성장전략", "swot"]],
  ["업종별 경영 이슈", ["제조업", "도소매", "음식점", "프랜차이즈", "물류", "건설업"]],
  ["컨설팅 사례·대표자 인터뷰", ["사례", "인터뷰", "후기", "컨설팅 사례"]],
];

export function familyOfPost(post: {
  generation_metadata?: Record<string, unknown> | null;
  title?: string | null;
  tags?: string[] | null;
  category?: string | null;
}): string | null {
  const planned = (post.generation_metadata as { topicPlan?: { topicFamily?: unknown } } | null)
    ?.topicPlan?.topicFamily;
  if (typeof planned === "string" && COLUMN_TOPIC_FAMILIES.includes(planned)) return planned;

  const haystack = [post.title, post.category, ...(post.tags || [])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (!haystack.trim()) return null;
  for (const [family, hints] of FAMILY_HINTS) {
    if (hints.some((hint) => haystack.includes(hint))) return family;
  }
  return null;
}

/**
 * 최근에 덜 쓴 주제군을 앞에 놓습니다.
 *
 * 한 번도 안 쓴 주제군이 먼저 오고, 그다음은 오래전에 쓴 순서입니다.
 * 목록 순서를 그대로 두면 늘 앞쪽 주제군만 뽑히므로, 쓴 횟수로 다시 세웁니다.
 */
export function underusedFamilies(
  posts: Parameters<typeof familyOfPost>[0][],
  limit = 6,
) {
  const counts = new Map<string, number>(COLUMN_TOPIC_FAMILIES.map((family) => [family, 0]));
  const lastSeen = new Map<string, number>();
  posts.forEach((post, index) => {
    const family = familyOfPost(post);
    if (!family) return;
    counts.set(family, (counts.get(family) || 0) + 1);
    // posts 는 최신순입니다. index 가 작을수록 최근입니다.
    if (!lastSeen.has(family)) lastSeen.set(family, index);
  });
  return [...counts.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) return left[1] - right[1];
      // 같은 횟수면 더 오래전에 쓴 쪽을 앞에 둡니다.
      return (lastSeen.get(right[0]) ?? Infinity) - (lastSeen.get(left[0]) ?? Infinity);
    })
    .slice(0, limit)
    .map(([family]) => family);
}

/**
 * 최근 글 목록을 주제 기획에 넘길 만큼만 줄입니다.
 * 본문까지 넣으면 입력이 커져 요금만 오르고, 겹치는지 보는 데는 제목이면 됩니다.
 */
export function recentColumnSummary(posts: {
  title?: string | null;
  category?: string | null;
  created_at?: string | null;
  generation_metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
}[], limit = 30) {
  return posts.slice(0, limit).map((post) => ({
    title: post.title || "",
    family: familyOfPost(post) || "미분류",
    date: (post.created_at || "").slice(0, 10),
  }));
}

export type ColumnTopicPlan = {
  topicFamily: string;
  primaryTopic: string;
  angle: string;
  audience: string;
  workingTitle: string;
  rationale: string;
};

export const COLUMN_TOPIC_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topicFamily: { type: "STRING" },
          primaryTopic: { type: "STRING" },
          angle: { type: "STRING" },
          audience: { type: "STRING" },
          workingTitle: { type: "STRING" },
          rationale: { type: "STRING" },
        },
        required: ["topicFamily", "primaryTopic", "angle", "audience", "workingTitle", "rationale"],
      },
    },
  },
  required: ["candidates"],
} as const;

export function parseColumnTopicPlans(raw: string): ColumnTopicPlan[] {
  const text = String(raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("주제 후보 JSON을 찾지 못했습니다.");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { candidates?: unknown };
  if (!Array.isArray(parsed.candidates)) throw new Error("주제 후보가 없습니다.");
  return parsed.candidates
    .filter((candidate): candidate is ColumnTopicPlan => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as Record<string, unknown>;
      return ["topicFamily", "primaryTopic", "angle", "audience", "workingTitle", "rationale"]
        .every((key) => typeof item[key] === "string" && (item[key] as string).trim().length > 0);
    })
    .slice(0, 5);
}

/**
 * 최근에 쓴 주제와 겹치는 후보를 걸러냅니다.
 *
 * 주제군만 펴 놓아도 "정부지원사업" 안에서 같은 사업을 다시 쓰는 일이 있습니다.
 * 제목이 지난 글과 거의 같으면 다음 후보로 넘어갑니다.
 */
export function pickFreshPlan(
  plans: ColumnTopicPlan[],
  recentTitles: string[],
): ColumnTopicPlan | null {
  const normalize = (value: string) => value.toLowerCase().replace(/[^0-9a-z가-힣]+/g, " ").trim();
  const recentWords = recentTitles.map((title) => new Set(normalize(title).split(" ").filter(Boolean)));
  const overlaps = (plan: ColumnTopicPlan) => {
    const words = new Set(
      normalize(`${plan.primaryTopic} ${plan.workingTitle}`).split(" ").filter(Boolean),
    );
    if (!words.size) return true;
    return recentWords.some((recent) => {
      if (!recent.size) return false;
      const shared = [...words].filter((word) => recent.has(word)).length;
      return shared / words.size >= 0.6;
    });
  };
  return plans.find((plan) => !overlaps(plan)) || plans[0] || null;
}

/** 주제 기획에게 주는 지시문. */
export function columnTopicPlanningRules({
  families,
  recent,
  feedTitles,
}: {
  families: string[];
  recent: ReturnType<typeof recentColumnSummary>;
  feedTitles: string[];
}) {
  return `[주제 기획]
울림컴퍼니 홈페이지 칼럼에 쓸 주제 후보 5개를 만든다.

먼저 아래를 지킨다.
- 후보의 topicFamily 는 [우선 주제군] 안에서 고른다. 다섯 후보의 주제군이 서로 달라야 한다.
- [최근 칼럼]과 같은 제도·사업·관점을 다시 쓰지 않는다.
- 정부가 무엇을 발표했는지가 아니라, **기업이 무엇을 해야 하는지**를 주제로 삼는다.
  "OO사업 지원대상 선정"은 주제가 아니다. "지원사업에 떨어진 뒤 다음에 할 일"은 주제다.
- 이미 끝났거나 폐지된 제도는 주제로 삼지 않는다. 시점이 불확실하면 고르지 않는다.
- audience 는 "중소기업 대표" 같은 뭉뚱그린 말 대신 한 사람으로 적는다.

[우선 주제군 — 최근에 덜 다룬 순서]
${families.map((family, index) => `${index + 1}. ${family}`).join("\n")}

[최근 칼럼 — 주제·관점이 겹치면 안 됨]
${JSON.stringify(recent)}

[오늘 공식 자료에 올라온 것 — 참고만 한다. 여기서 주제를 그대로 베끼지 않는다]
${JSON.stringify(feedTitles.slice(0, 20))}

JSON 객체 하나만 반환한다.`;
}
