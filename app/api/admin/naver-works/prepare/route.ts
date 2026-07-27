import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import { processNextPortfolioDownload } from "@/lib/naver-works/job-runner";
import { processNextPortfolioConversion } from "@/lib/cloudconvert/job-runner";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const completedDraft = await processNextPortfolioMockup();
    if (completedDraft) {
      return NextResponse.json({
        prepared: null,
        completedDraft,
        stage: completedDraft.status === "rejected" ? "rejected" : "review",
        shouldContinue: completedDraft.status === "rejected",
        message: completedDraft.status === "rejected"
          ? "실제 페이지를 확인한 결과 포트폴리오 기준에 맞지 않아 자동 제외했습니다. 다음 후보를 이어서 확인합니다."
          : `${completedDraft.title} 비공개 초안을 완성했습니다. 관리자 화면에서 이미지와 본문을 검수할 수 있습니다.`,
      });
    }
    const resumedDownload = await processNextPortfolioDownload();
    if (resumedDownload) {
      return NextResponse.json({
        prepared: null,
        downloaded: resumedDownload,
        stage: "downloaded",
        shouldContinue: true,
        message: `${resumedDownload.originalFileName} 원본을 안전하게 내려받아 변환 대기열로 이동했습니다.`,
      });
    }
    const conversion = await processNextPortfolioConversion();
    if (conversion) {
      return NextResponse.json({
        prepared: null,
        converted: conversion,
        stage: conversion.status === "completed" ? "converted" : "converting",
        shouldContinue: true,
        message: conversion.status === "completed"
          ? "원본 페이지 변환을 마쳤습니다. 이제 실제 화면 적합성과 민감정보를 판정합니다."
          : "원본의 글꼴과 레이아웃을 보존하는 변환을 진행하고 있습니다.",
      });
    }
    const prepared = await prepareNextPortfolioCandidate();
    if (!prepared) {
      return NextResponse.json({
        prepared: null,
        stage: "empty",
        shouldContinue: false,
        message: "현재 자동 기준을 통과한 새 디자인 프로젝트 후보가 없습니다.",
      });
    }
    const downloaded = await processNextPortfolioDownload(prepared.candidateId);
    return NextResponse.json({
      prepared,
      downloaded,
      stage: "selected",
      shouldContinue: true,
      message: `${prepared.projectName} 프로젝트를 비공개 제작 작업으로 등록하고 원본을 안전하게 내려받았습니다.`,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "포트폴리오 준비 실패",
    }, { status: 500 });
  }
}
