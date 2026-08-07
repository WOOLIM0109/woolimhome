export type OpenchatProgramStatus =
  | "collected"
  | "review_required"
  | "approved"
  | "deferred"
  | "excluded"
  | "ready"
  | "published";

export type OpenchatContentStatus =
  | "topic_candidate"
  | "review_required"
  | "approved"
  | "deferred"
  | "ready"
  | "published"
  | "on_hold";

export type OpenchatSource = {
  id: string;
  source_key: string;
  category: string;
  name: string;
  base_url: string;
  listing_url: string;
  collection_method: "page" | "json" | "manual";
  priority: number;
  enabled: boolean;
  last_checked_at: string | null;
  last_succeeded_at: string | null;
  last_status: string | null;
  last_error: string | null;
};

export type CollectedProgram = {
  sourceKey: string;
  externalId?: string | null;
  title: string;
  url: string;
  rawText?: string;
  applicantSummary?: string;
  supportSummary?: string;
  applicationPeriodText?: string;
  startsAt?: string | null;
  deadlineAt?: string | null;
  applicationMethod?: string;
  sourcePayload?: Record<string, unknown>;
};

export type OpenchatProgram = {
  id: string;
  fingerprint: string;
  title: string;
  applicant_summary: string;
  support_summary: string;
  application_method: string;
  application_period_text: string;
  source_url: string;
  starts_at: string | null;
  deadline_at: string | null;
  regions: string[];
  categories: string[];
  status: OpenchatProgramStatus;
  priority: number;
  draft_for: string | null;
  exclusion_reason: string | null;
  review_note: string | null;
  source?: Pick<OpenchatSource, "name" | "category" | "source_key"> | null;
};

export type OpenchatContentDraft = {
  id: string;
  content_date: string;
  weekday_theme: string;
  title: string;
  body: string;
  reference_urls: string[];
  keywords: string[];
  similarity_score: number;
  status: OpenchatContentStatus;
  review_note: string | null;
  metadata?: Record<string, unknown>;
};

export type OpenchatCronTask =
  | "morning-collect"
  | "morning-repair"
  | "morning-draft-notify"
  | "morning-approval-reminder"
  | "morning-cutoff"
  | "morning-ready"
  | "afternoon-draft"
  | "afternoon-cutoff"
  | "afternoon-ready";
