"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

const CATEGORIES = [
  "정부지원사업",
  "정책자금",
  "기업인증 (벤처인증)",
  "기업인증 (이노비즈, 메인비즈)",
  "기업인증 (ISO)",
  "연구소 또는 연구개발전담부서 설립",
  "사업계획서 IR",
  "소개서, 제안서 등 PPT",
  "디자인 서비스",
  "종합 경영컨설팅",
  "기타문의",
];

export default function ContactForm() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(result?.message || "문의 접수 중 오류가 발생했습니다.");
      }

      setDone(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "문의 접수 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
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
      <form onSubmit={handleSubmit} className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="이름 / 회사명" required>
            <input
              name="name"
              required
              placeholder="예) 울림컴퍼니 박미성"
              className="form-input"
            />
          </Field>
          <Field label="연락처" required>
            <input
              name="phone"
              required
              inputMode="tel"
              placeholder="예) 010-0000-0000"
              className="form-input"
            />
          </Field>
        </div>

        <Field label="이메일">
          <input name="email" type="email" placeholder="예) name@company.com" className="form-input" />
        </Field>

        <Field label="상담 분야" required>
          <select name="category" required defaultValue="" className="form-input">
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
            name="message"
            required
            rows={5}
            maxLength={2000}
            placeholder="현재 상황과 필요하신 내용을 자유롭게 적어주세요. 관련 자료가 있다면 상담 시 함께 검토합니다."
            className="form-input resize-y"
          />
        </Field>

        {/*
          사람에게는 보이지 않는 항목입니다. 자동으로 폼을 채우는 도구는 이것까지
          채우기 때문에, 채워져 오면 사람이 아니라고 봅니다. 화면에서 감추되
          읽기 도구와 키보드 이동에서도 빠지게 해 둡니다.
        */}
        <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="contact-website">이 항목은 비워 두세요</label>
          <input
            id="contact-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        <label className="flex items-start gap-2 text-xs leading-6 text-[var(--muted)]">
          <input type="checkbox" required className="mt-1 h-4 w-4 accent-[var(--primary)]" />
          <span>
            개인정보 수집·이용에 동의합니다. 입력하신 정보는 상담 답변 목적으로만 사용되며 목적 달성 후 파기됩니다.
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
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
