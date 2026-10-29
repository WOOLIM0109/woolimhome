import { STATUS_LABELS, STATUS_STYLES } from "@/lib/content-ops/config";
import type { WorkflowStatus } from "@/lib/content-ops/types";

/*
  상태 표시.

  예전에는 알약 모양에 파스텔 면을 깔았습니다. 공개 사이트는 면을 칠하지
  않고 1px 선으로만 나누기 때문에, 이 배지들이 화면에서 가장 겉돌았습니다.
  모양은 각지게 두고 테두리로만 구분하되, 열 가지 상태를 한눈에 가려내야
  하므로 색의 차이는 남겨 둡니다.
*/
export default function StatusBadge({ status, label }: { status: WorkflowStatus; label?: string }) {
  return (
    <span className={`inline-flex border px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[status]}`}>
      {label || STATUS_LABELS[status]}
    </span>
  );
}
