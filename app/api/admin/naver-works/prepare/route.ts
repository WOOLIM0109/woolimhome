import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import { processNextPortfolioDownload } from "@/lib/naver-works/job-runner";
import { processNextPortfolioConversion } from "@/lib/cloudconvert/job-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const resumedDownload = await processNextPortfolioDownload();
    if (resumedDownload) {
      return NextResponse.json({
        prepared: null,
        downloaded: resumedDownload,
        message: `${resumedDownload.originalFileName} 원본을 안전하게 내려받아 변환 대기열로 이동했습니다.`,
      });
    }
    const conversion = await processNextPortfolioConversion();
    if (conversion) {
      return NextResponse.json({
        prepared: null,
        converted: conversion,
        message: conversion.status === "completed"
          ? "PPT를 PDF로 변환해 비공개 저장소에 보관했습니다."
          : "PPT의 글꼴과 레이아웃을 보존하는 변환을 진행하고 있습니다.",
      });
    }
    const prepared = await prepareNextPortfolioCandidate();
    if (!prepared) {
      return NextResponse.json({
        prepared: null,
        message: "현재 자동 기준을 통과한 새 디자인 프로젝트 후보가 없습니다.",
      });
    }
    const downloaded = await processNextPortfolioDownload(prepared.candidateId);
    return NextResponse.json({
      prepared,
      downloaded,
      message: `${prepared.projectName} 프로젝트를 비공개 제작 작업으로 등록하고 원본을 안전하게 내려받았습니다.`,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "포트폴리오 준비 실패",
    }, { status: 500 });
  }
}
