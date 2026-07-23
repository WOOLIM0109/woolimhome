"use client";

import { useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";

/* ------------------------------------------------------------------ *
 *  구글폼 연동 설정 (★ 사장님이 구글폼 생성 후 이 부분만 채우면 됩니다)
 *
 *  1) 구글폼을 만들고 아래 5개 질문을 동일 순서로 추가
 *     - 이름 / 연락처 / 이메일 / 상담분야 / 문의내용
 *  2) 구글폼 "미리보기"에서 우클릭 → 페이지 소스 보기 →
 *     각 입력칸의 name="entry.000000000" 값을 복사해 아래에 붙여넣기
 *  3) FORM_ACTION 은 폼 주소의 끝 .../viewform → .../formResponse 로 변경
 *
 *  설정이 비어 있으면(FORM_ACTION === "") 폼은 "준비중" 안내를 표시합니다.
 * ------------------------------------------------------------------ */
const FORM_ACTION = ""; // 예: "https://docs.google.com/forms/d/e/XXXX/formResponse"
const ENTRY = {
  name: "entry.0000000001",
  phone: "entry.0000000002",
  email: "entry.0000000003",
  category: "entry.0000000004",
  message: "entry.0000000005",
};

const CATEGORIES = [
  "경영컨설팅",
  "정부지원사업·정책자금",
  "기업인증",
  "사업계획서·IR",
  "비즈니스문서·PPT",
  "디자인서비스",
  "기타 문의",
];

export default function ContactForm() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const configured = FORM_ACTION.length > 0;

  function handleSubmit() {
    if (!configured) return;
    setSubmitting(true);
    // 숨김 iframe 으로 제출 → CORS 없이 구글폼에 저장
    window.setTimeout(() => {
      setSubmitting(false);
      setDone(true);
    }, 1200);
  }

  if (done) {
    return (
      <div className="card items-center p-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--primary)]">
          <Send size={24} />
        </div>
        <h3 className="mt-5 text-xl font-bold">문의가 접수되었습니다.</h3>
        <p className="prose-muted mt-3 text-sm">
          빠른 시간 내에 담당자가 연락드리겠습니다.
          <br />
          급한 문의는 {""}
          <a className="font-bold text-[var(--primary)]" href="tel:01095220350">
            010-9522-0350
          </a>{" "}
          으로 연락 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6 sm:p-8">
      {!configured && (
        <p className="mb-5 rounded-xl border border-dashed border-[#e6b78f] bg-[var(--accent-soft)] px-4 py-3 text-xs leading-6 text-[#8a5a1f]">
          ⚙️ 관리자 안내: 이 폼은 구글폼 연결 후 작동합니다. (components/ContactForm.tsx 상단 설정)
          현재는 미리보기 상태입니다.
        </p>
      )}

      <iframe ref={iframeRef} name="hidden_gform" title="form-target" className="hidden" />

      <form
        action={FORM_ACTION || undefined}
        method="POST"
        target="hidden_gform"
        onSubmit={handleSubmit}
        className="grid gap-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="이름 / 회사명" required>
            <input
              name={ENTRY.name}
              required
              placeholder="예) 울림컴퍼니 박미성"
              className="form-input"
            />
          </Field>
          <Field label="연락처" required>
            <input
              name={ENTRY.phone}
              required
              inputMode="tel"
              placeholder="예) 010-0000-0000"
              className="form-input"
            />
          </Field>
        </div>

        <Field label="이메일">
          <input name={ENTRY.email} type="email" placeholder="예) name@company.com" className="form-input" />
        </Field>

        <Field label="상담 분야" required>
          <select name={ENTRY.category} required defaultValue="" className="form-input">
            <option value="" disabled>
              상담 분야를 선택해 주세요
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="문의 내용" required>
          <textarea
            name={ENTRY.message}
            required
            rows={5}
            placeholder="현재 상황과 필요하신 내용을 자유롭게 적어주세요. 관련 자료가 있다면 상담 시 함께 검토합니다."
            className="form-input resize-y"
          />
        </Field>

        <label className="flex items-start gap-2 text-xs leading-6 text-[var(--muted)]">
          <input type="checkbox" required className="mt-1 h-4 w-4 accent-[var(--primary)]" />
          <span>
            개인정보 수집·이용에 동의합니다. 입력하신 정보는 상담 답변 목적으로만 사용되며 목적 달성 후 파기됩니다.
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting || !configured}
          className="btn-gradient inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={17} />}
          {submitting ? "전송 중..." : "상담 신청하기"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold text-[#2d241d]">
        {label}
        {required && <span className="ml-1 text-[var(--primary)]">*</span>}
      </span>
      {children}
    </label>
  );
}
