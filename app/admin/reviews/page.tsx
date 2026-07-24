"use client";

import { useState } from "react";
import { Check, ImageIcon, MessageSquareText, RefreshCw } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import StatusBadge from "@/components/admin/StatusBadge";

export default function ReviewsPage() {
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");

  return (
    <AdminPortal
      title="검토 요청"
      description="제작 중간정보는 제외하고, 완성된 글과 JPG·PNG 이미지만 이곳에서 확인합니다."
    >
      <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8 text-center">
        <ImageIcon className="mx-auto text-[var(--primary)]" size={34} />
        <h2 className="mt-4 text-xl font-bold">관광마케팅 포트폴리오 완성본을 준비하고 있습니다</h2>
        <p className="prose-muted mx-auto mt-2 max-w-2xl text-sm">
          기존 게시물 전체 대조, 개인정보 보호, 썸네일과 본문 이미지 제작이 끝나면
          이 영역에 실제 완성 이미지와 글 미리보기가 표시됩니다.
        </p>
        <div className="mt-5"><StatusBadge status="creating" /></div>
      </section>

      <section className="mt-8 card p-6">
        <div className="flex items-center gap-3">
          <MessageSquareText className="text-[var(--primary)]" />
          <div>
            <h2 className="text-lg font-bold">완성본 수정 요청</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">추가로 가릴 내용이나 이미지 교체 요청을 남기는 자리입니다.</p>
          </div>
        </div>
        <textarea
          className="input mt-5"
          rows={5}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="완성본이 도착한 뒤 수정할 내용을 적어주세요."
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!note.trim()}
            onClick={() => {
              setNotice("수정 요청을 임시 저장했습니다.");
              setNote("");
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-bold disabled:opacity-40"
          >
            <RefreshCw size={17} /> 수정 요청 저장
          </button>
          <button type="button" disabled className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-bold text-white opacity-40">
            <Check size={17} /> 완성본 승인
          </button>
        </div>
        {notice && <p className="mt-4 text-sm font-bold text-emerald-700">{notice}</p>}
      </section>
    </AdminPortal>
  );
}
