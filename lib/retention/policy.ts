/**
 * 보존 정책 정의.
 *
 * 이 파일은 데이터베이스를 건드리지 않습니다. "무엇을, 언제, 어떤 방식으로
 * 정리하는가"만 선언해 두고, 실제 집계는 survey.ts 가 맡습니다.
 * 정책과 실행을 나눠 두면 기간을 조정할 때 이 파일 하나만 보면 됩니다.
 *
 * 지우는 방식이 세 가지입니다.
 *   delete_rows   행 자체를 지웁니다.
 *   clear_fields  행은 남기고 무거운 필드만 비웁니다.
 *   delete_files  스토리지 파일을 지웁니다.
 *
 * 행을 지우면 안 되는 데이터가 있습니다. 아래 ROW_DELETION_FORBIDDEN_TABLES
 * 와 policy.test.mjs 의 회귀 테스트가 그 결정을 붙잡아 둡니다.
 */

export type RetentionAction = "delete_rows" | "clear_fields" | "delete_files";

export type RetentionRule = {
  /** 집계 결과와 로그에서 규칙을 식별하는 키. */
  key: string;
  /** 관리자 화면에 그대로 보여 줄 한국어 설명. */
  label: string;
  action: RetentionAction;
  /** 규칙이 읽고 쓰는 테이블. 행 삭제 금지 검사가 이 값을 봅니다. */
  table: string;
  /** delete_files 규칙이 정리하는 스토리지 버킷. */
  bucket?: string;
  /** 기준 시각으로부터 며칠 뒤에 정리하는가. 0 이면 조건을 만족하는 즉시. */
  afterDays: number;
  /** 며칠을 세는 기준이 되는 시각. */
  basis: string;
  /** 이 규칙이 지켜야 하는 조건. 왜 이 조건이 필요한지까지 적습니다. */
  guard: string;
};

/**
 * 행을 절대 지우지 않는 대상입니다. 규칙으로 만들지 않는 것만으로는
 * 나중에 누가 추가하는 걸 막지 못하므로, 테스트가 이 목록을 검사합니다.
 *
 * content_work_items
 *   발행 완료 행의 published_url_normalized 유니크 제약이 같은 글을 두 번
 *   발행하는 걸 막는 유일한 장치입니다. 행이 사라지면 중복 차단이 풀립니다.
 *
 * portfolio_candidates
 *   드라이브 동기화가 upsert(onConflict: "drive_file_id", ignoreDuplicates)
 *   로 후보를 넣습니다. 즉 이 행이 "이 파일은 이미 검토했다"는 유일한
 *   기억입니다. 지우면 같은 파일을 다시 내려받아 변환하고 검토합니다.
 *   Gemini 예산이 하루 3콜, 월 30콜이라 재처리 한 번이 예산을 통째로
 *   먹습니다. 아끼는 건 수백 바이트, 잃는 건 월 예산입니다.
 */
export const ROW_DELETION_FORBIDDEN_TABLES = [
  "content_work_items",
  "portfolio_candidates",
  "openchat_content_history",
  "content_publication_events",
  "column_posts",
] as const;

export const RETENTION_RULES: RetentionRule[] = [
  // ── 스토리지. 용량의 대부분이 여기 있습니다. ────────────────────────────
  {
    key: "portfolio_source_files",
    table: "content_jobs",
    bucket: "portfolio-sources",
    label: "변환이 끝난 원본 PPTX",
    action: "delete_files",
    afterDays: 0,
    basis: "변환 작업 성공 시각",
    guard: "원본이 네이버웍스 드라이브에 그대로 있고 external_file_id 로 다시"
      + " 받을 수 있어 즉시 지웁니다. 변환이 성공한 건만 대상입니다.",
  },
  {
    key: "portfolio_rendered_slides",
    table: "content_jobs",
    bucket: "portfolio-rendered",
    label: "초안까지 끝난 슬라이드 PNG",
    action: "delete_files",
    afterDays: 3,
    basis: "초안 작업 완료 시각",
    guard: "재빌드 함수들이 conversionResult.slidePaths 를 다시 읽습니다."
      + " 지울 때 slidesPurgedAt 을 남겨, 재빌드가 드라이브 재다운로드부터"
      + " 다시 타도록 만든 뒤에만 이 규칙을 켭니다.",
  },
  {
    key: "published_review_assets",
    table: "content_review_assets",
    label: "발행이 끝난 검토용 이미지",
    action: "delete_rows",
    afterDays: 3,
    basis: "발행 완료 시각",
    guard: "네이버에 이미 올라간 사본입니다. 행과 스토리지 파일을 함께"
      + " 지웁니다. 발행 완료 상태인 작업의 것만 대상입니다.",
  },

  // ── 무거운 필드만 비우기. 행은 남깁니다. ───────────────────────────────
  {
    key: "published_work_item_body",
    table: "content_work_items",
    label: "발행이 끝난 원고 본문",
    action: "clear_fields",
    afterDays: 3,
    basis: "발행 완료 시각",
    guard: "metadata.generated 만 비웁니다. 행은 중복 발행 차단의 근거라"
      + " 남깁니다. 홈페이지 칼럼 본문은 column_posts.content 라는 별도"
      + " 테이블에 있어 공개 페이지는 영향을 받지 않습니다.",
  },
  {
    key: "published_openchat_draft_body",
    table: "openchat_content_drafts",
    label: "발행이 끝난 오픈채팅 초안 본문",
    action: "clear_fields",
    afterDays: 180,
    basis: "발행 시각",
    guard: "body 만 비웁니다. content_date 가 유니크 키라 행을 지우면 같은"
      + " 날짜 초안이 다시 만들어집니다. 제목과 요약은 history 에 남습니다.",
  },
  {
    key: "excluded_candidate_metadata",
    table: "portfolio_candidates",
    label: "탈락한 포트폴리오 후보의 부가 정보",
    action: "clear_fields",
    afterDays: 365,
    basis: "마지막 갱신 시각",
    guard: "metadata 만 비웁니다. 행을 지우면 드라이브 동기화가 같은 파일을"
      + " 새 후보로 다시 만들어 변환과 AI 검토를 되풀이합니다.",
  },

  // ── 작업 부산물. ───────────────────────────────────────────────────────
  {
    key: "finished_content_jobs",
    table: "content_jobs",
    label: "끝난 변환·목업·초안 작업 기록",
    action: "delete_rows",
    afterDays: 7,
    basis: "마지막 갱신 시각",
    guard: "완료와 실패만 지웁니다. queued · running · on_hold 는 제외합니다."
      + " 지우면 진행 중이거나 재시도를 기다리는 작업이 사라집니다."
      + " 3일이 아니라 7일인 것은, 금요일 밤 장애를 월요일 아침에 볼 수"
      + " 있어야 하기 때문입니다.",
  },
  {
    key: "column_generation_runs",
    table: "column_generation_runs",
    label: "칼럼 생성 요청·응답 기록",
    action: "delete_rows",
    afterDays: 7,
    basis: "생성 시각",
    guard: "AI 요청과 응답 전문이 담겨 행이 무겁습니다. 장애 분석에 필요한"
      + " 기간만 남깁니다.",
  },

  // ── 로그. 용량은 작지만 행이 계속 늘어납니다. ──────────────────────────
  {
    key: "bot_traffic_logs",
    table: "bot_traffic_logs",
    label: "봇 접속 기록",
    action: "delete_rows",
    afterDays: 30,
    basis: "접속 시각",
    guard: "일자별 집계를 먼저 만들어 두고 원본을 지웁니다. 집계는 지우지"
      + " 않으므로 봇 트래픽 화면의 추이는 그대로 남습니다.",
  },
  {
    key: "openchat_run_logs",
    table: "openchat_run_logs",
    label: "오픈채팅 크론 실행 기록",
    action: "delete_rows",
    afterDays: 14,
    basis: "시작 시각",
    guard: "실패 원인은 며칠 안에 확인하고 끝납니다.",
  },
  {
    key: "content_automation_runs",
    table: "content_automation_runs",
    label: "크론 중복 실행 방지 기록",
    action: "delete_rows",
    afterDays: 14,
    basis: "예정 시각",
    guard: "status='running' 인 행은 제외합니다. 아직 리스를 들고 있는"
      + " 실행이라 지우면 같은 작업이 두 번 돕니다.",
  },
  {
    key: "reviewed_source_changes",
    table: "content_source_changes",
    label: "검토가 끝난 원천자료 변경 기록",
    action: "delete_rows",
    afterDays: 180,
    basis: "검토 시각",
    guard: "reviewed_at 이 채워진 건만 지웁니다. 미검토 건은 남깁니다."
      + " fingerprint 유니크 인덱스가 같은 변경의 재감지를 막고 있어"
      + " 최근 것은 남아 있어야 합니다.",
  },
  {
    key: "column_editorial_feedback",
    table: "column_editorial_feedback",
    label: "칼럼 편집 전후 기록",
    action: "delete_rows",
    afterDays: 365,
    basis: "생성 시각",
    guard: "문체 학습이나 품질 분석에 쓸 계획이면 기간을 늘려야 합니다.",
  },
  {
    key: "stale_drive_files",
    table: "naver_works_drive_files",
    label: "드라이브에서 사라진 파일 인덱스",
    action: "delete_rows",
    afterDays: 365,
    basis: "마지막 발견 시각",
    guard: "sync_status='ignored' 인 건만 지웁니다. 후보가 참조하는 행은"
      + " 외래키로 묶여 있어 함께 사라지면 안 됩니다.",
  },
  {
    key: "stale_push_subscriptions",
    table: "openchat_push_subscriptions",
    label: "오래된 브라우저 푸시 구독",
    action: "delete_rows",
    afterDays: 365,
    basis: "마지막 갱신 시각",
    guard: "410·404 응답이 오면 지우는 처리가 이미 있습니다. 그 그물에"
      + " 걸리지 않은 것만 정리합니다.",
  },
];

const DAY_MS = 24 * 60 * 60 * 1_000;

/** 이 규칙의 기준 시각이 이보다 이전이면 정리 대상입니다. */
export function retentionCutoff(rule: RetentionRule, now: Date) {
  return new Date(now.getTime() - rule.afterDays * DAY_MS).toISOString();
}

export function retentionRule(key: string) {
  return RETENTION_RULES.find((rule) => rule.key === key) || null;
}
