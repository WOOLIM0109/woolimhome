import { createAdminClient } from "@/lib/supabase/admin";
import type { ExpertiseArea, InterviewQuestion } from "./types";

export const EXPERTISE_AREAS: { value: ExpertiseArea; label: string }[] = [
  { value: "planning", label: "기획" },
  { value: "design", label: "디자인" },
  { value: "government_support", label: "정부지원사업·정책자금" },
  { value: "business_plan", label: "사업계획서" },
  { value: "ir_ppt", label: "IR·PPT" },
  { value: "management", label: "경영컨설팅" },
  { value: "general", label: "종합 노하우" },
];

const DEFAULT_QUESTIONS: Record<ExpertiseArea, InterviewQuestion[]> = {
  planning: [
    { question: "고객이 처음 요청한 것과 실제로 해결해야 했던 문제가 달랐던 사례가 있나요?", followUps: ["처음 어떤 질문으로 차이를 발견했나요?", "결과물은 어떻게 달라졌나요?"] },
    { question: "좋은 기획과 단순한 아이디어를 구분하는 대표님의 기준은 무엇인가요?", followUps: ["반드시 확인하는 근거는 무엇인가요?", "실패한 기획에서 자주 보이는 신호는 무엇인가요?"] },
    { question: "자료가 부족하거나 고객의 설명이 모호할 때 어떤 순서로 가설을 세우나요?", followUps: ["첫 가설을 검증하는 방법은 무엇인가요?", "어느 시점에 방향을 바꾸나요?"] },
    { question: "기획 단계에서 바로 디자인이나 제작으로 넘어가지 않는 이유는 무엇인가요?", followUps: ["먼저 확정해야 하는 항목은 무엇인가요?", "건너뛰었을 때 어떤 문제가 생기나요?"] },
    { question: "복잡한 사업을 한 문장과 한 장의 구조로 정리하는 과정이 궁금합니다.", followUps: ["무엇을 버리고 무엇을 남기나요?", "고객을 설득하는 배열 순서는 어떻게 정하나요?"] },
    { question: "대표님이 상담 초기에 반드시 묻는 질문 다섯 가지는 무엇인가요?", followUps: ["각 질문의 답으로 무엇을 판단하나요?"] },
    { question: "고객의 주장과 시장 자료가 충돌할 때 어떤 결정을 내리나요?", followUps: ["실제로 설득했던 사례가 있나요?"] },
    { question: "좋은 기획자가 갖춰야 할 관찰력과 문서화 습관은 무엇인가요?", followUps: ["대표님이 실제로 사용하는 방식이 있나요?"] },
    { question: "기획 품질을 스스로 검수할 때 사용하는 체크리스트가 있나요?", followUps: ["절대 통과시키지 않는 오류는 무엇인가요?"] },
    { question: "울림의 기획 방식이 다른 컨설팅이나 제작 대행과 다른 점은 무엇인가요?", followUps: ["고객이 가장 크게 체감하는 차이는 무엇인가요?"] },
  ],
  design: [],
  government_support: [],
  business_plan: [],
  ir_ppt: [],
  management: [],
  general: [],
};

function areaLabel(area: ExpertiseArea) {
  return EXPERTISE_AREAS.find((item) => item.value === area)?.label || "종합 노하우";
}

function fallbackQuestions(area: ExpertiseArea): InterviewQuestion[] {
  if (DEFAULT_QUESTIONS[area].length) return DEFAULT_QUESTIONS[area];
  const label = areaLabel(area);
  return [
    { question: `${label} 업무에서 고객이 가장 자주 오해하는 것은 무엇인가요?`, followUps: ["왜 그런 오해가 생기나요?", "어떻게 바로잡나요?"] },
    { question: `좋은 ${label} 결과물과 부족한 결과물을 가르는 기준은 무엇인가요?`, followUps: ["첫눈에 발견하는 신호가 있나요?"] },
    { question: `실제 상담이나 프로젝트에서 방향을 크게 바꾼 사례가 있나요?`, followUps: ["무엇을 근거로 판단했나요?", "전후 결과는 어떻게 달라졌나요?"] },
    { question: `업무를 시작할 때 반드시 받거나 확인하는 자료는 무엇인가요?`, followUps: ["자료가 없을 때는 어떻게 보완하나요?"] },
    { question: `대표님만의 ${label} 업무 순서를 처음부터 끝까지 설명해 주세요.`, followUps: ["가장 많은 시간을 쓰는 단계는 어디인가요?"] },
    { question: `고객의 요구를 그대로 따르지 않고 다른 방향을 제안했던 경험이 있나요?`, followUps: ["고객을 어떻게 설득했나요?"] },
    { question: `${label} 과정에서 절대 하지 않는 방식이나 표현은 무엇인가요?`, followUps: ["그 원칙이 생긴 계기가 있나요?"] },
    { question: `성과를 객관적으로 확인하기 위해 어떤 숫자나 반응을 보나요?`, followUps: ["공개 가능한 사례가 있나요?"] },
    { question: `초보자가 스스로 시도할 때 가장 먼저 할 수 있는 실천은 무엇인가요?`, followUps: ["어느 단계부터 전문가가 필요한가요?"] },
    { question: `울림의 ${label} 전문성을 한 문장으로 정의한다면 무엇인가요?`, followUps: ["다른 업체와의 가장 큰 차이는 무엇인가요?"] },
  ];
}

export async function ensureInterviewRequest(input: {
  createdBy: string;
  expertiseArea?: ExpertiseArea;
  force?: boolean;
}) {
  const admin = createAdminClient();
  const [{ data: knowledge }, { data: pending }] = await Promise.all([
    admin.from("column_expert_knowledge").select("id, topic, expertise_area, approved, use_count").eq("approved", true),
    admin.from("column_interview_requests").select("*").eq("status", "pending").order("created_at", { ascending: false }),
  ]);

  const remainingTotal = (knowledge || []).reduce(
    (total, item) => total + Math.max(0, 3 - Number(item.use_count || 0)),
    0,
  );
  const counts = new Map<ExpertiseArea, { count: number; remaining: number }>();
  for (const area of EXPERTISE_AREAS) counts.set(area.value, { count: 0, remaining: 0 });
  for (const item of knowledge || []) {
    const area = (item.expertise_area || "general") as ExpertiseArea;
    const value = counts.get(area) || { count: 0, remaining: 0 };
    value.count += 1;
    value.remaining += Math.max(0, 3 - Number(item.use_count || 0));
    counts.set(area, value);
  }

  const pendingAreas = new Set((pending || []).map((item) => item.expertise_area as ExpertiseArea));
  const chosenArea = input.expertiseArea || EXPERTISE_AREAS
    .filter((area) => !pendingAreas.has(area.value))
    .sort((a, b) => {
      const aValue = counts.get(a.value) || { count: 0, remaining: 0 };
      const bValue = counts.get(b.value) || { count: 0, remaining: 0 };
      const aPriority = a.value === "planning" ? -1 : 0;
      const bPriority = b.value === "planning" ? -1 : 0;
      return (aValue.remaining + aValue.count + aPriority) - (bValue.remaining + bValue.count + bPriority);
    })[0]?.value;

  if (!chosenArea) return { created: false, reason: "모든 전문 분야의 인터뷰 요청서가 이미 대기 중입니다." };
  const areaState = counts.get(chosenArea) || { count: 0, remaining: 0 };
  if (!input.force && remainingTotal > 6 && areaState.remaining > 3) {
    return { created: false, reason: "현재 원천자료가 충분합니다." };
  }
  const existing = (pending || []).find((item) => item.expertise_area === chosenArea);
  if (existing) return { created: false, item: existing, reason: "해당 분야의 대기 중인 요청서가 있습니다." };

  const label = areaLabel(chosenArea);
  const questions = fallbackQuestions(chosenArea);
  const title = `${label} 전문성을 기록하는 심층 인터뷰`;
  const rationale = `${label} 분야의 승인된 원천자료가 부족해, 대표님의 실제 판단 기준과 사례를 새롭게 기록할 필요가 있습니다.`;

  const { data, error } = await admin.from("column_interview_requests").insert({
    expertise_area: chosenArea,
    title,
    rationale,
    recommended_minutes: 40,
    questions,
    status: "pending",
    generation_metadata: {
      knowledge_remaining_total: remainingTotal,
      area_approved_count: areaState.count,
      area_remaining_uses: areaState.remaining,
      model: "deterministic",
    },
    created_by: input.createdBy,
  }).select().single();
  if (error) throw new Error(error.message);
  return { created: true, item: data };
}
