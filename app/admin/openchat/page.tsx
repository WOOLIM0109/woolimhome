import { MessageSquareText } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import OpenchatOperations from "@/components/admin/OpenchatOperations";

export default function OpenchatAdminPage() {
  return (
    <AdminPortal
      title="오픈채팅 자동배포"
      description="지원사업과 오후 콘텐츠를 자동으로 준비하고, 검토·승인한 최종 게시문을 복사합니다. 카카오톡 전송은 담당자가 직접 진행합니다."
      actions={(
        <div className="inline-flex items-center gap-2 rounded-xl bg-[#241a15] px-4 py-3 text-sm font-bold text-white">
          <MessageSquareText size={18} /> 오전 11시 · 오후 6시 게시
        </div>
      )}
    >
      <OpenchatOperations />
    </AdminPortal>
  );
}

