export class PortfolioCheckpointYield extends Error {
  constructor(message = "다음 실행에서 체크포인트부터 계속합니다.") {
    super(message);
    this.name = "PortfolioCheckpointYield";
  }
}

export function yieldPortfolioCheckpointIfNeeded(shouldYield?: () => boolean) {
  if (shouldYield?.()) throw new PortfolioCheckpointYield();
}
