import { STATUS_LABELS, STATUS_STYLES } from "@/lib/content-ops/config";
import type { WorkflowStatus } from "@/lib/content-ops/types";

export default function StatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
