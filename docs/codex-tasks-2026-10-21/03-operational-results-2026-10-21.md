# 03 — AI 직원 API와 승인 프로필 운영 결과

**2026-10-21 19:23 KST 기준 03 완료 기준 통과.** 아래 운영 API 호출·재매칭·권한 확인을 마친 뒤 04 화면 작업을 시작했다. 이는 03 완료 시점의 기록이며, 이후 화면 검증과 프로필 표기 승인 결과는 04 보고서에 기록한다.

## 문서별 보고

| 항목 | 결과 |
|---|---|
| PR / 병합 커밋 | [#159](https://github.com/WOOLIM0109/woolimhome/pull/159), `1c54bf6c796815aa96312f9a5488d521b84acbc4` |
| 변경 파일 | 총 25개. 아래 목록과 [전체 diff](https://github.com/WOOLIM0109/woolimhome/pull/159/files) 참조 |
| 마이그레이션 | `20261021094429_openchat_program_agent_api.sql` → 운영 이력 **`20261021100427`** 적용. 기존 6개 포함 누적 7개 |
| npm test | 로컬 전체 1,288개: 1,283 통과·5 생략·실패 0, 이후 추가 DAL 8/8 통과. 최종 [CI 39582226178](https://github.com/WOOLIM0109/woolimhome/actions/runs/39582226178)는 **1,296개: 1,285 통과·11 생략·실패 0**. 추가 생략 6개는 기존 Windows 전용 PC worker 테스트이며 새 03 테스트 생략은 없음 |
| 다른 검증 | typecheck·lint·build·Vercel Preview 통과. 신규 인증·route·DAL·실제 PGlite 집중 검증 26/26 통과 |
| 운영 반영 | `dpl_F2tkuhuAeyLXktVqf2yrdojyJL4V` READY, 운영 Git SHA = 위 main. www 도메인·project production·cron deployment ID 일치 |
| 기존 동작 | 기존 수집→초안→승인→발행 코드와 **15개 크론 경로·시간 모두 동일** |
| 대표가 할 일 | 없음 |

변경 파일은 다음과 같다.

- API 7개: `app/api/agent/programs/route.ts`, `programs/today/route.ts`, `programs/[id]/route.ts`, `programs/[id]/text/route.ts`, `programs/[id]/review/route.ts`, `app/api/agent/profiles/route.ts`, `profiles/[key]/proposal/route.ts` (축약 경로도 `app/api/agent/` 아래).
- 서비스·인증·프로필: `lib/program-review/agent-api.ts`, `agent-auth.ts`, `agent-route.ts`, `profiles-store.ts`, `profiles.ts`, `profiles-run.ts`, `matching.ts`, `requirements-runner.ts`.
- 테스트 8개: 같은 디렉터리의 `agent-api.test.mjs`, `agent-auth.test.mjs`, `agent-routes.test.mjs`, `agent-schema.test.mjs`, `profiles.test.mjs`, `profiles-run.test.mjs`, `matching.test.mjs`, `requirements-runner.test.mjs`.
- 위 SQL 1개와 `03-implementation-notes.md`.

## 05 승인 값 반영

대표가 반영을 지시한 초안의 확정 사실만 비공개 `openchat_program_self_profiles` 2개에 저장했다. 두 행 모두 version 2, 매칭 context revision 3이며 입력한 승인 JSON과 저장 정본이 정확히 일치함을 확인했다. 실제 회사 비공개 사실이나 고객 정보는 코드·migration seed·공개 테스트에 넣지 않았다.

셀라벤토의 법인·소재지·설립일·업종·대표 제외 인원·확인된 연구개발전담부서·지원 이력은 반영했다. 매출은 0으로 추정하지 않고 null이다. 여성 대표라는 사실을 여성기업 확인서 보유로 바꾸지 않았다. 울림의 부산 소재지·업종은 반영하고 구 단위 소재지·정확한 설립일·개인/법인·인원·현재 인증은 비웠다. 연도만으로 설립일을 만들거나 유효기간 미확인 인증을 현재 보유로 가산하지 않는다. 부분 인증 목록은 `certifications_complete=false`여서 미기재를 미보유로 판정하지 않는다.

토큰은 운영 Secret과 지정된 `C:\dev\.secrets\woolimhome-agent.env`에만 저장했다. 값은 로그·응답·보고·커밋에 출력하지 않았다. API의 응답·요청 보호와 git staged 내용의 실제 토큰 미포함도 확인했다.

## 실제 재매칭

관리자 버튼 실행은 **19:17:04.886–19:19:30.002 KST, 145.116초**에 끝났다. **54건 재사용·54건 매칭·새 추출 0·실패 0·ready 0·예산 보류 0**, 시간 부족 중단도 없었다. 469개 대상에 매칭했다.

15:44 확대 검사 76건 중 I-PLEX광주 공고는 17:00, 구로구 창업교육은 18:00에 마감됐다. 이 2건을 되살리지 않아 현재 확인된 미마감 모집단은 **74건**, 그중 추출 정본이 있는 공고는 **54건**이다. 기존 요건 정본 56건의 입력 해시는 전부 그대로이며 원래 시도 56개·복구 1개도 증가하지 않았다. 따라서 이번 보완의 **추가 Gemini 호출은 0회**다.

| 대상 | 정상 흐름의 현재 추출 공고 | 조건부 후보 | 확인 필요 | 명백한 불일치 |
|---|---:|---:|---:|---:|
| 울림컴퍼니 | 32 | 15 | 17 | 0 |
| 주식회사 셀라벤토(로닛 포함) | 32 | 15 | 17 | 0 |

기존 제외 상태 22건의 독립 검사 결과는 각 6건 조건부·16건 확인 필요지만, 정상 상위 목록·정독·승인·발행으로 복원하지 않는다. 54건 전체의 대상별 판정과 정상 흐름 32건의 판정을 섞지 않았다. 정상 목록에서 두 자사 모두 조건부 후보 상위 10건이 실제 조회됐고 stale=false였다.

‘조건부 후보’는 확인된 조건의 일치가 있고 남은 요건은 확인해야 하는 공고다. 지원금 점수만으로 후보로 만들지 않으며 정보 부족을 감점·탈락으로 쓰지 않는다. 명백한 불일치는 우선한다. 조건부 후보가 없는 대상은 불일치를 복원하는 대신 unknown 공고를 ‘확인 필요’ 목록으로 제공한다.

## 운영 curl 결과

실제 `curl.exe --config -` 호출에서 인증 헤더는 비공개 파일에서 stdin으로만 전달했다. 명령 인자·화면·결과 예시에는 실제 토큰이 없다. **조회·권한·입력 검사 22/22 통과**, 별도로 정상 쓰기 3회도 확인했다.

| 요청 | 실제 HTTP / 응답 예시(축약) |
|---|---|
| GET `/api/agent/programs/today` | 200, `{review_date, programs:[…]}`. 최대 8개·기관·대상별 brief·판정 합계 |
| GET `/api/agent/programs?eligible=true&limit=10` | 200, `{programs:[…],limit:10,offset:0,has_more:…}` |
| GET `/api/agent/programs/:id` | 200, `{program,requirements,extraction,matches_stale,matches,attachments}` |
| GET `/api/agent/programs/:id/text` | 200, `{program_id,detail_text,attachments:[{…,text_content:"[p.1] …"}]}`. 전체 글자 유지 |
| GET 위 text에 `?attachment=:id` | 200. 다른 공고의 첨부 ID를 조합하면 **404** |
| GET `/api/agent/profiles` | 200, `{profiles:[{id:"woolim-company",version:2,…},{id:"cellavento",version:2,…}]}` |
| GET 대상별 `target_kind=self&target_id=…&limit=10` | 두 자사 모두 200·조건부 후보 10개·마감/제외/불일치 0·stale 0 |
| POST `/api/agent/programs/:id/review` | 두 자사에 각각 **201**, `{review:{id:"가림",created_at:"…"}}`. 이력 2행 추가 |
| POST `/api/agent/profiles/woolim-company/proposal` | **201**, `{proposal:{id:"가림",status:"pending",base_version:2,…}}`. 승인 프로필은 전후 정확히 동일 |
| 위 7개 endpoint에 토큰 없이 호출 | 모두 **401**, `{error:"Unauthorized"}` |
| agent 토큰만으로 기존 관리자 실행 API | **401** |
| 64KiB 초과 검토 JSON | **413**, `{error:"BODY_TOO_LARGE"}` |
| 허용되지 않은 reviewer/프로필 필드·잘못된 limit | **400** |

검토 POST는 허위 연결 확인문이 아니라 실제 원문을 확인한 바이오 공고의 주의사항을 두 자사에 기록했다. HWPX 문단 68/PDF 6쪽의 **10월 21일 16:00 Pooling 마감**, 문단 85/PDF 7쪽의 **11월 2일 16:00 협업제안 마감**, 문단 88의 선행 Pooling 필수를 구분했다. 기신청 여부와 바이오 분야·참여 역할이 미확인이므로 결론은 ‘확인 필요’다. 점수 1위라는 이유로 신규 신청 가능으로 확정하지 않는다.

프로필 POST는 이미 승인된 부산 소재지를 ‘부산광역시’로 표기만 통일하자는 실제 제안이다. 저장 직후 pending이고 version 2·context revision 3·기존 값이 그대로임을 확인했다. 승인/반려 화면 동작은 04에서 검증한다.

## 비공개 권한 실측과 증거

새 4개 테이블 모두 RLS=true, anon/authenticated SELECT=false다. reviews는 service_role SELECT/INSERT만 허용하고 UPDATE/DELETE=false였다. 새 함수 5개는 SECURITY INVOKER이며 anon/authenticated EXECUTE=false·service_role=true다. 신규 공고 검토 관련 security advisor WARN은 0개다. 기존 portfolio trigger 실행권한·Auth 비밀번호 보호 경고 3개는 적용 전후 같고 이 작업에서 바꾸지 않았다.

로컬 비공개 증거는 `.codex-tmp/program-review/03-api-smoke.json`, `03-api-responses-private.json`, `03-write-verification.json`, `03-db-verification.json`, `03-rematch-completed.png`, `pr159-release-verification.json`이다. 고객명이 들어 있는 전체 응답은 공개 저장소에 커밋하지 않는다. 구현 계약은 [03 구현 기록](03-implementation-notes.md)을 참조한다. 다음 날 아침 자동 실행 결과는 아직 관측하지 않았다.
