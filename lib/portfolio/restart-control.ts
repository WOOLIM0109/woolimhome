import { contentAdmin } from "@/lib/content-ops/data";

export async function assertPortfolioRestartApproved() {
  const { data, error } = await contentAdmin().from("portfolio_automation_control")
    .select("first_run_approved").eq("id", true).single();
  if (error) throw new Error(error.message);
  if (!data.first_run_approved) throw new Error("PORTFOLIO_RESTART_APPROVAL_REQUIRED: 보류 정리와 후보 미리보기 확인 후 첫 제작 승인이 필요합니다.");
}
