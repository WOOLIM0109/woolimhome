export type PortfolioProgress = {
  stage?: string;
  shouldContinue?: boolean;
  cancelled?: boolean;
  message: string;
  error?: string;
};

const MAX_PREPARE_ATTEMPTS = 14;

function waitForNextStep(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, delay);
    function cancel() {
      clearTimeout(timer);
      reject(signal?.reason || new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/** All manual portfolio entry points continue the same saved request, including inspection. */
export async function continuePortfolioPreparation(options: {
  requestId: string;
  signal?: AbortSignal;
  onProgress: (progress: PortfolioProgress) => void;
  fetcher?: typeof fetch;
  wait?: (delay: number, signal?: AbortSignal) => Promise<void>;
}) {
  const fetcher = options.fetcher || fetch;
  const wait = options.wait || waitForNextStep;
  let progress: PortfolioProgress = { message: "후보 검사를 준비하고 있습니다." };
  for (let attempt = 0; attempt < MAX_PREPARE_ATTEMPTS; attempt += 1) {
    const response = await fetcher("/api/admin/naver-works/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: options.requestId }),
      signal: options.signal,
    });
    progress = await response.json() as PortfolioProgress;
    if (!response.ok) throw new Error(progress.error || "포트폴리오 초안을 준비하지 못했습니다.");
    options.onProgress(progress);
    if (progress.cancelled || progress.stage === "cancelled" || progress.stage === "review" || !progress.shouldContinue) {
      return progress;
    }
    if (attempt + 1 < MAX_PREPARE_ATTEMPTS) {
      await wait(["converting", "pc_waiting", "pc_running"].includes(progress.stage || "") ? 5000 : 1000, options.signal);
    }
  }
  progress = { ...progress, message: `${progress.message} · ${progress.stage === "inspecting"
    ? "검사 결과를 저장했습니다. 다음 준비 요청에서 남은 후보 검사를 이어갑니다."
    : "진행 상황을 저장했습니다. 작업 큐에서 이어지는 처리를 확인해 주세요."}` };
  options.onProgress(progress);
  return progress;
}
