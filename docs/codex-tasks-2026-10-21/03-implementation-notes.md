# 03 구현 계약

기존 수집·초안·승인·발행 경로와 크론은 변경하지 않는다. 다음은 구현 계약이며 운영 호출 실측은 별도 결과 보고서에 기록한다. 토큰 값은 문서·응답·로그에 기록하지 않는다.

## 인증과 응답

신규 `/api/agent/*`는 `Authorization: Bearer <PROGRAM_AGENT_TOKEN>`만 허용한다. 관리자 쿠키·크론·PC 작업자·Hub 토큰을 대체 인증으로 인정하지 않는다. 인증 전에는 DB를 생성하거나 본문을 읽지 않는다. 응답은 `private, no-store`, 오류는 고정 코드이며 DB/공급사/파서 메시지를 전달하지 않는다.

검토·제안 요청은 JSON 객체이며 실제 UTF-8 본문 65,536 bytes 이하로 제한한다. Content-Length가 작거나 없어도 스트림 누적 바이트를 검사한다. 원문과 디코딩된 JSON, 응답에 대해 비밀 패턴과 설정된 주요 서버 비밀의 포함을 검사한다. 검토·제안 본문에는 비밀 값을 넣지 않는다.

프로그램 기본정보, 요건의 정해진 필드와 근거, 매칭 대상·판정·점수·이유, 첨부 이름·상태·글자만 명시적으로 직렬화한다. 저장소 경로·첨부 다운로드 URL·서명 URL·시도 이력·원시 모델 응답·고객 캐시/연락처/메모는 반환하지 않는다. 공고 원문 URL의 인증성 매개변수는 제거한다. 상세·오늘·전체 텍스트 응답은 스트리밍 JSON이며 쪽/문단 표시나 전체 글자를 묵시적으로 잘라내지 않는다.

## 조회

| 경로 | 응답 |
|---|---|
| `GET /api/agent/programs/today` | KST 오늘의 live 선정 공고 최대 8개, 기관, 대상별 간단 매칭 및 판정별 합계. 긴 이유는 상세에서 조회 |
| `GET /api/agent/programs/:id` | `program`, `requirements`, `extraction`, `matches_stale`, `matches`, `attachments` |
| `GET /api/agent/programs/:id/text` | `program_id`, `detail_text`, 첨부별 전체 `text_content`. `?attachment=<uuid>`는 그 공고에 속한 첨부만 조회 |
| `GET /api/agent/programs?status=&since=&q=` | 최근 60일 검색. `limit` 1~100(기본 50), `offset` 0~5000, `has_more` 제공. since가 60일보다 이르면 범위 하한으로 제한 |
| `GET /api/agent/profiles` | 승인된 자사 2개의 ID·이름·별칭·프로필·버전. 고객 프로필은 제공하지 않음 |

공고 ID 조회와 첨부 조회도 최근 60일 하한을 적용한다. 검색은 기존 제외 상태도 명시적으로 확인할 수 있다. `target_kind=self|customer&target_id=<id>&limit=10`을 주면 오늘 대상별 순위를 조회한다. 대상 조회는 기본적으로 제외/마감 공고를 뺀다. 해당 조건에 맞는 candidate가 있으면 candidate를 점수순으로, 없으면 unknown을 ‘확인 필요’로 제공하며 mismatch는 반환하지 않는다. `eligible=false`는 과거 판정의 의도적 점검용이다. 전역 선정 8개와 대상별 상위 10개는 서로 다른 보기다.

`candidate`의 이유에 ‘조건부 후보:’가 있으면 표시 이름은 ‘조건부 후보’, 순수 unknown은 ‘확인 필요’다. 둘을 같은 상태로 표시하지 않는다. 마감일 null은 미래 마감이 확인된 공고라는 뜻이 아니다.

`matches_stale`는 정본 버전·검토일·원문 확인 시각, 승인 프로필/고객 캐시 revision, 매칭 규칙 버전뿐 아니라 이후 상세·첨부 변경 시각도 비교한다. stale 결과를 최신 추천으로 확정하지 않는다.

## 검토 추가

`POST /api/agent/programs/:id/review` 본문:

```json
{
  "target_kind": "self",
  "target_id": "woolim-company",
  "conclusion": "확인 필요",
  "review_markdown": "원문과 대상 조건을 확인한 검토 내용",
  "missing_documents": ["확인할 자료"],
  "next_actions": ["다음 확인 작업"]
}
```

conclusion은 ‘추천/검토/제외/확인 필요’만 받는다. 두 배열은 문자열 배열(각 최대 100개, 항목 최대 1000자)이다. review_markdown은 최대 50,000자다. 대상 이름은 승인 자사 프로필 또는 유효한 고객 캐시에서 결정한다. 선택 입력 target_name이 이름과 다르면 거부한다. reviewer는 서버가 `ai:gongo-matcher`로 고정한다. 같은 공고·대상의 재검토도 새 행을 추가하며, service_role에는 reviews SELECT/INSERT만 허용한다. 프로그램이나 다른 테이블은 수정하지 않는다.

## 프로필 제안과 관리자 승인

`POST /api/agent/profiles/:key/proposal` 본문은 `base_version`, 비어 있지 않은 `patch`, `reason`이다. key는 기존 `woolim-company`, `cellavento`만 허용한다. patch는 region/founded_on/business_type/industries/employees/revenue_krw/revenue_band/certifications/certifications_complete/has_support_history/notes만 받으며 값 형식·날짜·범위와 알 수 없는 필드를 검사한다. 제안 저장은 항상 pending이며 승인 프로필을 바꾸지 않는다.

비공개 authoritative 저장소는 `openchat_program_self_profiles`다. 초기 미확정 정보는 null이고, 인증 목록 완전성은 `certifications_complete=false`로 둔다. 승인 트랜잭션 RPC는 `apply_openchat_program_profile_proposal(p_proposal_id uuid,p_expected_version integer,p_actor text,p_approve boolean)`다. 쿠키 관리자 인증을 거친 서버에서만 `applySelfProfileProposal` 헬퍼를 사용한다. 미승인·버전 충돌·중복 승인·null 버전은 거부하며 승인 시 프로필 버전과 매칭 context revision을 갱신한다.

새 context revision 또는 매칭 규칙 버전은 성공 정본도 다시 매칭 대상으로 만든다. 원문 해시/프롬프트를 바꾸거나 Gemini를 재호출할 필요는 없다. 런타임은 프로필을 읽기 전후 revision을 확인하고, 5인자 `save_openchat_program_matches`가 같은 revision을 잠금 안에서 검사한 뒤 저장한다. 승인과 매칭 저장이 겹쳐도 오래된 스냅샷이 새 완료로 표시되지 않는다. 미완료 고객 캐시 진행 저장은 revision을 바꾸지 않는다.

## 검증 범위

신규 migration과 로컬 PGlite에서 기본 ACL이 service_role ALL인 경우까지 시험한다. 실제 운영 마이그레이션 적용·토큰 발급·운영 curl·커밋은 루트 담당자가 별도로 수행한다. 실제 고객 값이나 승인된 회사 비공개 사실을 테스트 fixture나 마이그레이션 seed에 넣지 않는다.
