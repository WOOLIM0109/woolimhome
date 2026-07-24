import { FileCheck2 } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import WorkQueue from "@/components/admin/WorkQueue";

export default function ReviewsPage() {
  return (
    <AdminPortal
      title="검토 요청"
      description="완성된 글과 JPG·PNG 이미지만 확인합니다. 수정 요청, 승인, 보류 결과는 실제 작업 큐에 저장됩니다."
    >
      <section className="mt-8">
        <div className="flex items-center gap-3">
          <FileCheck2 className="text-[var(--primary)]" />
          <div>
            <h2 className="text-2xl font-bold">검토가 필요한 완성본</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">제작 중간 정보와 원본 파일 구조는 표시하지 않습니다.</p>
          </div>
        </div>
        <WorkQueue reviewMode />
      </section>
    </AdminPortal>
  );
}
