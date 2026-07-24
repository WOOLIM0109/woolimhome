export type ContentChannel = "homepage" | "naver_consulting" | "naver_design";
export type ContentFormat =
  | "column"
  | "informational"
  | "authority"
  | "portfolio"
  | "design_insight";

export type WorkflowStatus =
  | "topic_candidate"
  | "researching"
  | "creating"
  | "review_required"
  | "approved"
  | "naver_ready"
  | "scheduled"
  | "published"
  | "on_hold";

export interface ContentWorkItem {
  id: string;
  channel: ContentChannel;
  format: ContentFormat;
  title: string;
  summary: string;
  status: WorkflowStatus;
  scheduledAt?: string | null;
  imageUrl?: string | null;
  sourceLabel?: string | null;
  reviewNote?: string | null;
}

export interface EditorialSlot {
  key: string;
  channel: ContentChannel;
  format: ContentFormat;
  weekday: number;
  hour: number;
  label: string;
}
