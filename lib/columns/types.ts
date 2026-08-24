export type ColumnKind = "informational" | "hybrid" | "authority";
/**
 * 칼럼에 붙일 수 있는 상태 딱지.
 *
 * 이 목록은 저장소 쪽 검사와 글자 하나까지 같아야 합니다.
 * supabase/migrations/202607240001_columns_automation_v1.sql 의
 * column_posts.generation_status check 구문이 짝입니다.
 *
 * 한쪽만 바뀌면 글을 다 써 놓고 저장하는 마지막 순간에 저장소가 거절합니다.
 * 실제로 코드가 목록에 없는 needs_style_fix 를 쓰다가 그렇게 죽었습니다.
 * 그 일이 다시 없도록 두 목록을 대조하는 시험을 붙여 두었습니다(types.test.mjs).
 */
export const COLUMN_STATUSES = ["draft", "generated", "needs_expert_input", "reviewed"] as const;
export type ColumnStatus = (typeof COLUMN_STATUSES)[number];

export function isColumnStatus(value: unknown): value is ColumnStatus {
  return typeof value === "string" && (COLUMN_STATUSES as readonly string[]).includes(value);
}
export type ExpertiseArea =
  | "planning"
  | "design"
  | "government_support"
  | "business_plan"
  | "ir_ppt"
  | "management"
  | "general";

export interface ColumnSource {
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string | null;
}

export interface ColumnFaq {
  question: string;
  answer: string;
}

export interface ColumnPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  tags: string[];
  category: string | null;
  content_kind: ColumnKind;
  audience: string | null;
  core_message: string | null;
  published: boolean;
  published_at: string | null;
  scheduled_at: string | null;
  generation_status: ColumnStatus;
  generation_metadata: Record<string, unknown>;
  author_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpertKnowledge {
  id: string;
  topic: string;
  source_type: "interview" | "case" | "note";
  raw_text: string;
  perspective: string | null;
  case_evidence: string | null;
  differentiator: string | null;
  expertise_area: ExpertiseArea;
  approved: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewQuestion {
  question: string;
  followUps: string[];
}

export interface InterviewRequest {
  id: string;
  expertise_area: ExpertiseArea;
  title: string;
  rationale: string;
  recommended_minutes: number;
  questions: InterviewQuestion[];
  status: "pending" | "completed";
  generation_metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}
