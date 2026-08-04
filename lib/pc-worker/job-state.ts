export type WorkerJobFailureDisposition = "retry" | "exhausted" | "permanent";

export function workerJobFailureDisposition(input: {
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
}): WorkerJobFailureDisposition {
  if (!input.retryable) return "permanent";
  return input.attempts < input.maxAttempts ? "retry" : "exhausted";
}
