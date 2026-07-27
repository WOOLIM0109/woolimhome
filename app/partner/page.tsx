import type { Metadata } from "next";
import PartnerPortal from "@/components/partner/PartnerPortal";

export const metadata: Metadata = {
  title: "네이버 블로그 포스팅 작업실 | 울림컴퍼니",
  description: "승인된 컨설팅·디자인 블로그 원고와 이미지를 전달하는 외주 전용 작업실입니다.",
  robots: { index: false, follow: false },
};

export default function PartnerPage() {
  return <PartnerPortal />;
}

