import AdminPortal from "@/components/admin/AdminPortal";
import ProgramReviewOperations from "@/components/admin/ProgramReviewOperations";

export default function ProgramReviewAdminPage() {
  return (
    <AdminPortal
      title="공고 검토"
      description="공고의 지원 조건과 대상별 매칭을 확인하고, 원문 근거를 바탕으로 검토합니다."
    >
      <ProgramReviewOperations />
    </AdminPortal>
  );
}
