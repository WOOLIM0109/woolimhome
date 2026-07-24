export type ColumnKind = "informational" | "hybrid" | "authority";
export type ColumnStatus = "draft" | "generated" | "needs_expert_input" | "reviewed";
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
