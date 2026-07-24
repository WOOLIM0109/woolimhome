import AdminPortal from "@/components/admin/AdminPortal";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";

export default function AdminSchedulePage() {
  return (
    <AdminPortal
      title="통합 발행 일정"
      description="홈페이지 칼럼과 컨설팅·디자인 네이버 블로그의 향후 2주 계획입니다."
    >
      <section className="mt-8">
        <TwoWeekSchedule />
      </section>
      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-white p-5 text-sm leading-7 text-[var(--muted)]">
        모든 콘텐츠는 처음에는 비공개 초안으로 준비됩니다. 네이버 예약발행은 완성본 승인과 편집기 입력 확인이 끝난 뒤에만 진행합니다.
      </section>
    </AdminPortal>
  );
}
