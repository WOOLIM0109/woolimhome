import { redirect } from "next/navigation";

/**
 * 옛 주소를 새 주소로 넘겨줍니다.
 *
 * 노하우 자료실이 칼럼 하위에 있어서 칼럼 전용처럼 보였습니다. 실제로는
 * 홈페이지·컨설팅·디자인 세 채널이 함께 쓰는 자료실이라 좌측 메인 메뉴로
 * 옮겼습니다. 즐겨찾기나 옛 링크로 들어와도 그대로 열리게 남겨 둡니다.
 */
export default function LegacyKnowledgeRedirect() {
  redirect("/admin/knowledge");
}
