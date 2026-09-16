/**
 * 남은 시간이 모자라면 시작하지 않습니다.
 *
 * 크론과 관리자 요청 모두 실행 시간에 상한이 있습니다. 그 시간을 넘기면
 * 함수가 통째로 죽습니다. 그때까지 부른 AI 요금은 그대로 나가고, 결과는
 * 남지 않고, 작업 항목은 '제작 중'인 채로 굳습니다. 다음 날 그것부터
 * 다시 돌리면 같은 자리에서 또 죽습니다.
 *
 * 그래서 각 단계를 시작하기 전에 남은 시간을 봅니다. 그 단계를 끝낼 만큼
 * 없으면 아예 시작하지 않고 멈춥니다. 돈을 쓰지 않고 멈추는 것이,
 * 쓰고 죽는 것보다 언제나 낫습니다.
 */

/** 이 오류는 실패가 아니라 '다음 기회로 미룸'입니다. 시도 횟수를 깎지 않습니다. */
export const GENERATION_DEADLINE = "GENERATION_DEADLINE";

/**
 * 원고 생성 한 건에 떼어 두는 시간. 크론과 여기가 같은 값을 봐야 합니다.
 *
 * 함수 상한이 300초입니다. 마무리 기록과 목업 처리에 쓸 몫을 남기고
 * 원고에 이만큼을 줍니다.
 */
export const GENERATION_BUDGET_MS = 240_000;

/**
 * 단계별로 잡아 두는 시간(밀리초).
 *
 * 세 단계를 한 번씩 거치는 것이 최소 경로입니다. 그 합이 위 예산을 넘으면
 * 마지막 단계에서 언제나 미뤄지고, 자동 생성은 한 편도 나오지 않습니다.
 * 아래 값은 그래서 '최악'이 아니라 '한 번씩 부르면 이 정도'로 잡습니다.
 * 보정과 재요청은 남은 시간을 보고 중간에 그만둡니다.
 */
export const STAGE_BUDGET_MS = {
  topicPlan: 70_000,
  research: 70_000,
  articleBody: 90_000,
} as const;

export type StageName = keyof typeof STAGE_BUDGET_MS;

export function deadlineExceeded(
  stage: StageName,
  deadlineAt: number | null | undefined,
  now = Date.now(),
) {
  if (!deadlineAt) return false;
  return now + STAGE_BUDGET_MS[stage] > deadlineAt;
}

/**
 * 남은 시간이 모자라면 던집니다.
 *
 * 부르는 쪽은 이 오류를 실패가 아니라 '아직 안 함'으로 다뤄야 합니다.
 * 실패로 세면 몇 번 미뤄진 것만으로 그 자리가 영영 건너뛰어집니다.
 */
export function assertStageFits(
  stage: StageName,
  deadlineAt: number | null | undefined,
  now = Date.now(),
) {
  if (deadlineExceeded(stage, deadlineAt, now)) throw new Error(GENERATION_DEADLINE);
}

export function isDeadlineError(error: unknown) {
  return error instanceof Error && error.message === GENERATION_DEADLINE;
}
