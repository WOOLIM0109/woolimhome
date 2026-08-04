export const WORKER_HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;

export type ContentWorkerRecord = {
  id: string;
  display_name: string;
  status: string;
  current_job_id: string | null;
  last_seen_at: string;
  last_error: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ContentWorkerStatus = ContentWorkerRecord & {
  online: boolean;
  busy: boolean;
};

export function deriveWorkerStatus(
  worker: ContentWorkerRecord,
  now = Date.now(),
): ContentWorkerStatus {
  const lastSeen = Date.parse(worker.last_seen_at);
  const online = Number.isFinite(lastSeen)
    && now - lastSeen < WORKER_HEARTBEAT_TIMEOUT_MS;
  const status = !online
    ? "offline"
    : worker.status === "busy" || worker.status === "error"
      ? worker.status
      : "online";

  return {
    ...worker,
    status,
    online,
    busy: online && status === "busy",
  };
}

export function summarizeWorkers(
  records: ContentWorkerRecord[],
  now = Date.now(),
) {
  const workers = records.map((worker) => deriveWorkerStatus(worker, now));
  const onlineCount = workers.filter((worker) => worker.online).length;
  const busyCount = workers.filter((worker) => worker.busy).length;

  return {
    workers,
    online: onlineCount > 0,
    busy: busyCount > 0,
    onlineCount,
    busyCount,
    errorCount: workers.filter((worker) => worker.status === "error").length,
  };
}
