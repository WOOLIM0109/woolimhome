/**
 * 놓친 칼럼 일정 세기
 *
 * 칼럼 크론은 화·목·격주 토 오전 10시 17분에 하루 한 번만 돕니다.
 * 그날 실패하거나 배포와 시각이 겹치면 그 회차는 그대로 사라졌습니다.
 * 실제로 8월 11일과 13일 두 편이 그렇게 없어졌습니다.
 *
 * 그래서 실행할 때마다 지난 일주일에 나왔어야 할 편 수를 세고,
 * 실제로 나온 편 수와 견줘 모자란 만큼을 다음 회차에서 채웁니다.
 *
 * 한 번에 한 편만 채웁니다. 밀린 것을 한꺼번에 만들면 지출이 튀고,
 * 같은 날 비슷한 글이 여러 편 쌓입니다.
 */

/** 칼럼을 내보내는 요일. 화·목·토 입니다. */
export const COLUMN_EDITORIAL_WEEKDAYS = [2, 4, 6];

/** 한 번 실행에서 채울 최대 편 수. */
export const COLUMN_CATCHUP_PER_RUN = 1;

/** 되짚어 볼 기간(일). 일주일이면 화·목·토 세 회차가 들어옵니다. */
export const COLUMN_CATCHUP_LOOKBACK_DAYS = 7;

export function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

/** 그날 칼럼이 나와야 하는 날인지 봅니다. 토요일은 격주입니다. */
export function isColumnEditorialDay(date: Date) {
  const weekday = date.getUTCDay();
  if (!COLUMN_EDITORIAL_WEEKDAYS.includes(weekday)) return false;
  if (weekday === 6 && isoWeek(date) % 2 !== 0) return false;
  return true;
}

/**
 * 오늘 이전에 칼럼이 나왔어야 할 날짜들.
 *
 * @param kstNow 한국 시각 기준의 오늘
 * @param days 며칠 전까지 되짚을지
 */
export function dueColumnDates(kstNow: Date, days = COLUMN_CATCHUP_LOOKBACK_DAYS) {
  const dates: string[] = [];
  for (let offset = 1; offset <= days; offset += 1) {
    const day = new Date(kstNow.getTime());
    day.setUTCDate(day.getUTCDate() - offset);
    if (!isColumnEditorialDay(day)) continue;
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates.sort();
}

/**
 * 채워야 할 편 수.
 *
 * @param dueCount 나왔어야 할 편 수
 * @param producedCount 실제로 나온 편 수 (사람이 직접 쓴 것도 셉니다)
 */
export function columnCatchupCount(dueCount: number, producedCount: number) {
  return Math.max(0, Math.min(COLUMN_CATCHUP_PER_RUN, dueCount - producedCount));
}
