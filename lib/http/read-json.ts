/**
 * 서버 응답을 안전하게 읽습니다.
 *
 * response.json() 을 그냥 부르면, 서버가 JSON 이 아닌 것을 돌려줬을 때
 * "Unexpected token 'A', \"An error o\"... is not valid JSON" 같은 말이
 * 화면에 그대로 뜹니다. 사람이 읽을 수 없는 말입니다.
 *
 * 실제로 Vercel 이 시간 초과 안내 페이지(HTML)를 돌려줬을 때 그랬습니다.
 * 여기서는 빈 객체를 돌려주고, 부르는 쪽이 사람이 읽을 수 있는 말을 붙입니다.
 */
export async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}
