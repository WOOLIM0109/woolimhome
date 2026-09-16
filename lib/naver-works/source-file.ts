/**
 * 드라이브 파일 하나를 놓고 "포트폴리오로 쓸 수 있는 원본인가"를 판정합니다.
 *
 * 원래 lib/naver-works/client.ts 안에 있었습니다. 그런데 그 파일은 Supabase
 * 관리자 클라이언트를 불러와서, 시험에서 그대로 가져올 수가 없었습니다.
 * 그래서 22 일 동안 후보를 마르게 만든 판정이 한 번도 시험을 거치지 못했습니다.
 *
 * 판정 자체는 파일명과 경로만 보면 끝나는 순수한 계산입니다.
 * 여기로 옮겨 두면 시험이 닿습니다. client.ts 는 그대로 다시 내보냅니다.
 */

export type PortfolioSourceFile = {
  fileName: string;
  filePath?: string;
};

/**
 * 개인정보가 담긴 서류인지 봅니다. 이런 파일은 순위와 무관하게 후보에서 뺍니다.
 */
export function sensitivePortfolioDocument(file: Pick<PortfolioSourceFile, "fileName" | "filePath">) {
  const sensitiveDocumentPattern =
    /주민등록|등본|초본|가족관계|사대보험|4대보험|보험가입|홈택스|부가가치세|원천징수|소득금액|납세|통장|계좌|임대차|근로계약|사업자등록증|법인등기|인감증명|신분증/i;
  return sensitiveDocumentPattern.test(`${file.filePath || ""}/${file.fileName}`);
}

/**
 * 공개해도 되는 폴더에 있는 파일인지 봅니다.
 *
 * 담당자가 정한 자리는 `완성본_외부공유금지/PPT` 아래입니다.
 * 레퍼런스 폴더는 남의 작업물이라 제외합니다.
 */
export function approvedPortfolioSource(file: Pick<PortfolioSourceFile, "filePath">) {
  const segments = (file.filePath || "")
    .split(/[\\/>]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const completedRoot = segments.findIndex((segment) => segment === "완성본_외부공유금지");
  if (completedRoot < 0) return false;
  if (segments.some((segment) => segment === "레퍼런스")) return false;
  return segments[completedRoot + 1]?.toLowerCase() === "ppt";
}

/**
 * 자동 후보로 쓸 수 있는 원본인지 최종 판정합니다.
 *
 * PDF 는 뺍니다. 가림 영역은 PowerPoint 로 도형을 하나씩 열어봐야 알 수 있는데
 * PDF 에는 그 정보가 없어서, 변환까지 성공해도 lib/portfolio/source-policy.ts 의
 * PDF_LOCAL_REDACTION_UNSUPPORTED 에서 반드시 되돌아옵니다. 그런데도 선정 점수는
 * PDF 를 우대하고 있어서, PDF 가 1 등으로 뽑히면 내려받고 변환하는 데 한 회차를
 * 다 쓰고 결과는 0 이 됐습니다. 되돌리는 자리는 그대로 두고 애초에 뽑지 않습니다.
 *
 * 이 함수는 후보를 만드는 쪽(app/api/admin/naver-works/sync/route.ts)과
 * 후보를 골라 쓰는 쪽(portfolio-selection.ts)이 함께 씁니다.
 * 두 곳의 기준이 갈리면 "넣어는 두고 영원히 안 쓰는" 후보가 쌓입니다.
 */
export function supportedPortfolioFile(
  file: Pick<PortfolioSourceFile, "fileName" | "filePath">,
) {
  if (!/\.(ppt|pptx)$/i.test(file.fileName)) return false;
  return approvedPortfolioSource(file) && !sensitivePortfolioDocument(file);
}
