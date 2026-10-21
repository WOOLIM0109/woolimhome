# 02 요건 추출·1차 매칭 구현 기록

작성 기준: 2026-10-21 15:44:22 KST 운영 집계. PR #153~157과 후속 SQL 보정을 반영했으며 **02 운영 완료 기준을 통과했다.** 미마감 공고 56건 재검증·매칭 저장, 무작위 10건의 원문·물리 페이지 대조, 일일·확장 범위 전환 표와 하루 정독 8개 상한을 확인했다. 이 문서는 02 구현·완료 기록이며 03·04를 완료한 것은 아니다.

## 문서별 보고

| 항목 | 확인 결과 |
|---|---|
| 커밋 해시 | 현재 main `02b513b4128b23f8ef25ca617de5ab7a1d329353` — PR #157 병합. 아래 PR별 이력 참조 |
| 바꾼 파일 | 아래 구현 파일 표 참조. 이 구현 기록 자체는 미커밋 문서 |
| 마이그레이션 | 02 관련 6개 모두 운영 적용. 실제 이력 버전 `20261021034043`, `20261021044245`, `20261021052109`, `20261021061027`, `20261021063307`, `20261021064135` |
| `npm test` | 후속 SQL 보정 포함 최종 로컬 **총 1,259개: 1,254 통과 / 5 생략 / 0 실패**. typecheck·lint·build 및 PR #157 [CI #39553774369](https://github.com/WOOLIM0109/woolimhome/actions/runs/39553774369) 통과. 후속 SQL·크론을 묶는 새 PR의 CI는 별도 확인 예정 |
| 운영 반영 여부 | `dpl_4hsxVTB517SLv1iCYHfCgnMkzZuz` **READY**. 운영 Git SHA가 위 main과 일치하고 `www.woolimcompany.kr`, project production, cron deployment ID가 모두 같은 배포를 가리킴. 기존 **13개 크론의 경로·시간 동일**. 신규 요건 2개를 더한 로컬 설정 15개는 준비됐으며 PR #158·운영 배포 대기. 현재 실제 등록은 13개 |
| 대표가 할 일 | 없음 |

| PR | 반영 내용 | main 병합 커밋 |
|---|---|---|
| [#153](https://github.com/WOOLIM0109/woolimhome/pull/153) | 근거 검증 요건 추출, 프로필, 보수적 매칭과 하루 8개 선정 | `ff6c64b94d37f3451c3dda492811f763505a27e8` |
| [#154](https://github.com/WOOLIM0109/woolimhome/pull/154) | 최대 100건 배치, 비공개 진단·원문, 전역 lease와 명시적 1회 복구, 요건 크론 경로 준비 | `4c046be59cb9cb83ccdee73e4ffb4bd351867466` |
| [#155](https://github.com/WOOLIM0109/woolimhome/pull/155) | 업력의 엄격 경계·예외 보존, 조건부 제외 업종 검증, 기존 결과 normalization v2 재검증 | `3f5bb2b43a8d45976439fd89ee9e84d6dcb7dbae` |
| [#156](https://github.com/WOOLIM0109/woolimhome/pull/156) | 추출 NUL 제거, 빈 본문 분류와 저장 단계별 고정 오류 | `80b5f0607087ad963c1b8cfcced97870c5c98fba` |
| [#157](https://github.com/WOOLIM0109/woolimhome/pull/157) | 연령 OR 업력·분야별 업력 예외와 가점 총상한 보존, normalization v3 재검증 | `02b513b4128b23f8ef25ca617de5ab7a1d329353` |

로컬 HTTP 업로드 보정 `08278c74b903d735850b541a3d5ba949295c0077`은 PR #154에 포함된 운영 검증 도구 변경으로 구분한다. 수집 → 초안 → 승인 → 발행 로직과 `openchat_programs` 상태는 이 작업에서 변경하지 않는다. 기존 제외 공고의 독립 매칭 결과가 생겨도 승인·발행 상태를 되살리지 않는다.

## 구현 파일과 실행 제한

| 파일 | 역할 |
|---|---|
| `lib/program-review/requirements.ts`, `requirements-generation.ts` 및 각 `.test.mjs` | 입력 해시, 구조화 JSON 생성, 원문 근거·의미 검증과 normalization v3 |
| `lib/program-review/requirements-runner.ts`, `requirements-runner.test.mjs` | 범위별 작업 선택, 생성·재사용·재검증·매칭, 비공개 원문 저장과 1회 복구 |
| `lib/program-review/matching.ts`, `matching.test.mjs` | 대상별 판정·이유·점수와 정독 후보 순위 |
| `lib/program-review/profiles.ts`, `profiles-run.ts` 및 각 `.test.mjs` | 빈 자사 프로필, 공식 Hub API의 활성 고객 조회·축소 저장·재개 캐시 |
| `lib/program-review/jobs.ts`, `jobs.test.mjs` | 첨부·요건의 관리자·크론 실행 간 전역 lease와 안전한 요약 |
| `lib/program-review/requirements-schema.test.mjs`, `review-batches-schema.test.mjs` | 실제 PGlite SQL로 권한·동시성·조회·복구·순위·버전 재검증 |
| `lib/program-review/extract-text.ts`, `attachment-runner.ts` 및 각 `.test.mjs` | NUL만 제거, 무본문 분류, 다운로드·원본 저장·추출·결과 저장 오류 구분 |
| `app/api/admin/program-review/run/route.ts`, `lib/program-review/admin-run.test.mjs` | 관리자 운영 검증 폼·인증·동일 출처·범위 검사 |
| `app/api/cron/program-review/route.ts`, `lib/program-review/cron.ts`, `cron.test.mjs` | 요건 크론의 인증·KST 평일 오전·휴일 제한과 집계 응답. 로컬 설정 준비, 운영 등록 대기 |
| 아래 6개 SQL, `lib/program-review/match-selection-schema.test.mjs`, `docs/codex-tasks-2026-10-21/02-operational-check.sql` | 운영 스키마·대규모 매칭 저장 회귀와 읽기 전용 검증 조회 |

관리자 진입점은 `/api/admin/program-review/run`이다. POST는 최근 60일 수집분의 첨부 처리, 요건·매칭 또는 실패 공고 복구를 실행하며 마감일 미상 포함 여부를 구분한다. 인증·동일 출처를 검사하고 응답은 캐시하지 않는다. 03의 AI 직원 API나 04의 관리자 탭·프로필 승인 기능을 구현한 것은 아니다.

요건은 **1회 최대 100건·작업 시간 240초**, 생성 시작 여유 **60초 이상**이다. 요청은 최대 80초이며 저장 여유 25초를 남긴다. 기존 Gemini 모델·예산 제한을 유지하고 구조화 JSON, 낮은 thinking, 출력 상한 16,000 토큰을 사용하며 자동 재시도하지 않는다. 일반 첨부 크론의 기존 **15건 처리·30건 탐색·240초·45초 시작 여유**는 유지하고 관리자 명시 실행만 최대 100건으로 제한한다.

동일 공고·입력 해시는 자동 유료 재호출하지 않는다. 네트워크 호출 전 시간·예산 보류만 예약을 해제한다. 호출 후 실패는 원래 시도를 보존하며 관리자 명시 복구는 같은 공고·해시당 1회다. 모델 응답 원문은 JSON 파싱 전에 비공개 시도/복구 레코드에 저장한다. job 요약에는 허용된 안전 정수 집계·불리언·날짜만 남기며, 원문·고객값·자격증명·provider 오류 본문은 응답·일반 로그에 출력하지 않는다.

## 원문 근거와 normalization v3

상세 본문과 추출 완료 첨부를 출처별로 구획하고 입력을 최대 60,000자로 제한한다. 해시는 **출처 ID·전체 추출 텍스트·프롬프트 버전**으로 계산하며 첨부 바이너리 해시 자체와 구분한다. 모든 non-null leaf는 `regions.0`, `business_age.max_years` 같은 dotpath별 evidence가 필요하다. `[source:출처ID p.N]` 또는 `[source:출처ID para.N]`의 정확한 위치에 인용이 존재하고 그 인용이 값·숫자·금액·날짜를 뒷받침해야 한다. 원문 명령은 실행 지시로 취급하지 않는다.

근거 없는 값·빈 배열은 `null`이다. 업력 기준일은 원문에 완전한 날짜가 있을 때만 쓰며 오늘이나 공고일을 추정하지 않는다. `미만`·`초과`를 `이하`·`이상` 경계로 바꾸지 않고, 업력 예외·특례나 조건부 제외 업종은 근거와 검토 필요 상태를 보존한다. 일부 첨부 미추출·입력 절단은 확정 배제 대신 `unknown`으로 남긴다.

normalization v3는 모델·프롬프트·입력 해시와 원래 시도 기록을 바꾸지 않고 기존 성공 JSON을 원문으로 다시 검증한다. v1·v2 결과를 우선 재검증하고 canonical 결과에 버전 3을 저장한다. 앞선 v2 보정 13건에 이어 최종 v3 운영 재검증 **56/56 입력 해시 보존·추가 Gemini 호출 0건**을 확인했다. 원래 시도 56건과 명시적 복구 1건도 증가 없이 유지됐다.

PR #157은 `단, 문화/예술/관광 분야 10년` 같은 예외와 대표 연령 OR 창업 업력 중 하나를 충족하는 조건을 무조건 최대 업력으로 저장하지 않는다. 숫자 경계는 비우고 검토 필요 상태를 유지한다. 같은 쪽·문단의 정확한 한 구간만 basis로 보존하며 다른 문단을 합쳐 인용하지 않는다. 명확히 모든 조건을 충족해야 하는 AND 요건과 일반 업력 7년 상한은 유지한다. 가점 항목 숫자의 합계가 원문 총상한을 넘으면 개별 점수는 `null`로 비우고 항목·근거는 보존해 총상한을 넘는 독립 가산을 막는다.

PR #156은 모든 추출 결과에서 **NUL(U+0000)만 제거**하고 글자 수를 다시 계산한다. 빈 결과나 NUL 제외 50자 미만 PDF는 `no_text`로 분류한다. 30MiB·2,000,000자·PDF 500쪽·ZIP 제한은 제거 전 그대로 적용한다. 실제 PDF 3개에서 NUL 4·10·2개만 제거되고 나머지 글자·쪽 표식은 정확히 동일함을 확인했다. 오류는 다운로드·원본 비공개 저장·텍스트 추출·결과 저장 단계별 고정 메시지로 구분한다.

## 프로필과 Hub 읽기 API

울림컴퍼니와 셀라벤토(로닛 포함)는 이름만 둔 빈 자사 프로필이다. 지역·설립일·업종·인원·매출·현재 인증을 추정하지 않는다. 고객은 고정 호스트 `https://hub.woolimcompany.kr`의 공식 읽기 API만 이용하고 리다이렉트는 거부한다. 인증값은 출력하지 않으며 기본 1,100ms 간격과 요청·실행 시간 제한을 적용한다.

활성 고객은 프로젝트 `createdAt`이 한국 달력 기준 최근 18개월 이내이거나, `projectCategory`가 `support_client`·`certification`인 이력이 있거나, 상세 `legacyPrograms`에 지원사업 이력이 있는 경우다. 경계일을 포함하고 미래 등록일은 제외한다. `updatedAt`·`lastActivityAt`은 사업 등록일 대체값으로 쓰지 않고, `supportProjectCount`와 인증 이력도 현재 인증 보유로 해석하지 않는다.

확인할 수 없는 현업종·인원·매출·개인/법인 구분·현재 인증은 `null`과 `missingFields`로 표시한다. 캐시에는 식별자·표시명·지역·설립일·지원 이력 여부만 저장하고 연락처·메모·등록번호·API 원문은 복제하지 않는다. 전체 이력을 제공하는 일괄 endpoint가 없어 상세는 최대 40건씩 비공개 staging에서 재개하며, 갱신 완료 전에는 `refresh_pending`으로 추출·매칭을 보류한다. 날짜별 캐시와 소유권 검증으로 부분 갱신 공개를 막는다.

### 확인한 응답 필드 이름

아래는 필드 **이름**만 기록한 것이다. 고객값은 포함하지 않는다. 고객 목록·프로젝트 목록의 실제 HTTP 200 응답을 확인했고, 고객 상세 구조도 공식 GET으로 확인했다. 상세 표본의 `legacyPrograms`는 빈 배열이므로 **legacy 레코드 내부 필드 목록은 실제 반환 레코드 관측이 아니라 운영 소스 계약 확인**이라는 점을 구분한다.

| 공식 읽기 경로 | 구조·필드 목록 |
|---|---|
| `/api/agent/customers` → `customers[]` | `id`, `name`, `companyName`, `contactName`, `representative`, `companies`, `region`, `source`, `customerKind`, `businessRegistrationNumber`, `corporateRegistrationNumber`, `foundedOn`, `staffContact`, `contactLink`, `businessSummary`, `status`, `displayStatus`, `contractStatus`, `assigneeId`, `assigneeName`, `nextActionDate`, `memo`, `aliases`, `projectCount`, `activeProjectCount`, `completedProjectCount`, `quoteCount`, `supportProjectCount`, `lastActivityAt`, `createdAt`, `updatedAt` |
| 고객 `aliases[]` | `id`, `alias`, `normalizedAlias`, `source` |
| `/api/agent/projects?customerId=` → `projects[]` | `id`, `customerId`, `customerName`, `title`, `projectType`, `projectCategory`, `status`, `priority`, `assigneeId`, `assigneeName`, `startDate`, `dueDate`, `paymentStatus`, `submissionStatus`, `amount`, `memo`, `createdAt`, `updatedAt` |
| `/api/agent/customers/:id` | `customer`, `projects`, `legacyPrograms`, `quoteRequests` |
| 상세 `legacyPrograms[]` — 운영 소스 계약 | `id`, `customerId`, `businessItem`, `agencyName`, `programName`, `programCategory`, `link`, `deadline`, `status`, `note`, `createdAt`, `updatedAt` |

## 1차 매칭과 하루 정독 선정

`matchProgram()`은 대상별 `candidate`·`mismatch`·`unknown`, 이유와 점수를 반환한다. 근거로 확인된 마감 경과나 연구기관·대학·지자체 전용은 전원 불일치다. 지역 전역 제외는 부산·전국 공고가 아니고 **대상 전원의 확인된 지역이 명백히 다를 때만** 적용한다. 빈 자사 프로필이나 정보 없는 고객은 추측해서 제외하지 않는다.

업력은 확정 기준일·설립일이 있어야 판정한다. 제외 업종은 확정 일치, 필수 인증 미보유는 완전한 현재 인증 목록이 있을 때만 자동 불일치다. 예외·택일 조건·부족한 판단 자료와 포함 업종·인원·매출 상한은 검토 사유로 남긴다. **정보 부족으로 점수를 깎지 않는다.**

| 가산 항목 | 점수 |
|---|---|
| 명확한 단일 지원금 | 1억 원 이상 30점 / 5천만 원 이상 20점 / 1천만 원 이상 10점 / 그 미만 양수 5점 |
| 마감까지 7일 이상 | 5점 |
| 근거 있는 현재 인증 가점 | 명시 점수, 인증별 최대 10점·같은 인증 중복 방지 |
| 과거 고객 지원사업 이력 | 5점 |

대출·융자·총예산·총사업비·자부담·복수 트랙 금액과 구분되지 않는 수치는 지원금으로 가산하지 않는다. `rankDailyCandidates()`와 SQL은 프로그램별 최대 대상 점수, 동률 ID 순서, 고유 공고 **하루 최대 8개**를 사용한다. `unknown`도 검토 가능 대상으로 남는다. 독립 범위의 전체 매칭 수와 기존 상태·마감 조건을 지키는 정상 정독 선정 수는 구분해 보고한다.

## 운영 마이그레이션과 검증

| 저장소 파일 | 실제 운영 이력 버전 |
|---|---|
| `20261021032454_openchat_program_requirements.sql` | `20261021034043` |
| `20261021042817_openchat_program_review_batches.sql` | `20261021044245` |
| `20261021051857_openchat_requirement_normalization_version.sql` | `20261021052109` |
| `20261021060019_openchat_requirement_normalization_v3.sql` | `20261021061027` |
| `20261021062847_openchat_match_selection_delta.sql` | `20261021063307` |
| `20261021063654_openchat_match_payload_materialization.sql` | `20261021064135` |

최초 4개 테이블은 요건·시도·매칭·프로필 캐시이며 후속 2개는 복구·job 기록이다. 모두 RLS와 서비스 역할 전용 접근을 적용했다. 운영에서 공개 역할 테이블 접근 차단과 후속 7개 RPC의 `SECURITY INVOKER`·서비스 역할 전용 실행 권한을 확인했다. v2 마이그레이션은 기본 버전 1 열을 추가했다. v3는 4인자 작업 조회·대기 집계의 재검증 조건만 버전 3 미만으로 바꾸며 기존 3인자 RPC·claim 함수·RLS·권한·기본값 1을 보존한다. 앞선 신규 security advisor WARN·ERROR는 없었고 서비스 전용 무정책 테이블의 INFO는 설계와 일치했다.

회귀 검증에는 소수 점수 7.5 저장, SQL/순수 함수 순위 일치, stale hash 차단, 전역 lease 동시성·만료·소유권, 한 해시 복구 1회, 호출 전 예약 해제, 81번째 미처리 공고 진행, 마감일 우선·미상 후순위, `source_checked_at`으로 생성 도중 원문 변경 감지, 원문·근거 재검증, NUL 제거 전 크기 제한과 단계별 오류 비노출을 포함한다. v3 추가 SQL 검증은 v2 성공만 재검증 대상으로 추가하고 v3 성공·같은 해시 실패는 자동 재호출하지 않으며, 해시·모델·시도/복구 행과 기존 함수 정의·ACL·RLS가 그대로임을 확인한다. OR/AND·예외·가점 상한·반복 정규화의 반례 테스트도 포함한다.

### 매칭 저장 시간 초과와 후속 SQL 보정

운영 v3 재검증 중 `save_openchat_program_matches`에서 SQLSTATE `57014` 시간 초과가 확인됐다. 다섯 번째 마이그레이션은 전체 일일 선정 플래그를 초기화하는 대신 변경된 플래그만 쓰고, 매칭이 끝난 정규화 버전·검토일·원문 확인 시각을 함수 말미의 같은 트랜잭션에서 기록한다. 따라서 canonical JSON만 갱신된 뒤 매칭 저장이 실패해도 기존 매칭 행 때문에 대기 목록에서 빠지지 않는다.

실제 읽기 전용 실행계획에서 순위 조회만 약 **4,878ms**, 기존 전체 선정 조회는 약 **7,770ms**가 걸렸다. 여섯 번째 마이그레이션은 순위·플래그 조회 인덱스를 추가하고, 상위 8개 공고 ID를 한 번 계산해 기존 선정에서 빠진 행과 새 선정 행만 갱신한다. 큰 JSON의 삭제 대상은 한 번만 펼쳐 비교하고, 이름·판정·이유·점수가 같은 upsert는 쓰기를 생략한다. 운영 적용 뒤 순위 조회는 **15.292ms**, 그중 새 인덱스 전용 스캔은 **6.165ms**로 확인됐다. 이 수치는 순위 조회 실측이며 56건 전체 처리 완료 시간이나 성공 판정이 아니다.

실제 SQL 회귀는 **56×469=26,264행**과 공고당 469개·한국어 이유 약 1.4MB payload를 사용했다. 동일 선정·동일 payload의 재저장 쓰기 0, 실제 대상 추가·삭제·필드 변경, 기존 순위·8개 상한·과거 날짜 보존, 실패 시 전체 트랜잭션 rollback과 재개 표식 미갱신, 같은 버전·날짜·해시의 원문 확인 시각 갱신 후 재개를 확인했다. 원래 3인자 RPC·잠금·권한·RLS와 모델 시도 기록은 유지한다.

운영 재개는 `2026-10-21T06:42:02.228817Z`~`06:44:06.998040Z`(KST 15:42:02~15:44:06), **124.769초**에 한 실행으로 끝났다. **재사용 56·매칭 저장 56·실패 0·ready 0·예산 보류 0·시간 중단 false**였다. 15:44:22 KST 최종 조회에서 56건 모두 normalization 3, 매칭 완료 버전 3·검토일 2026-10-21·원문 확인 시각 일치를 확인했다. 입력 해시도 56/56 동일하며 원래 시도 56·복구 1을 유지해 추가 모델 호출은 없었다.

확인된 단일 복구는 2026-10-21 **13:59:28.636 KST**(`04:59:28.636Z`)에 HTTP 200·종료 `STOP`·출력 1,111토큰·thoughts 0·`stored`, 원문 전체 확보·입력 미절단·469대상 매칭이었다. 공고 1건의 결과이며 최초 실패의 상세 종료 사유는 저장되지 않아 `MAX_TOKENS` 원인으로 단정하지 않는다.

## 02 운영 완료 기준과 크론 반영 상태

최신 요청의 미마감 공고 최소 50건 기준은 **56건 성공**으로 통과했다. 대상별 매칭은 469개 프로필씩 26,264건이며 후보 0·정보 부족 26,264건이다. 부족한 현재 프로필 정보를 추정해 후보나 불일치를 만들지 않았고 이유를 보존했다. 고유 정독 선정은 하루 8개 상한을 지켰다.

| 범위 | 수집·검증 대상 | 첨부 확보 | 텍스트 추출 공고 | 요건 완료 공고 | 대상별 매칭 |
|---|---:|---:|---:|---:|---|
| 당일 | 수집 19 → 미마감 대상 1 | 별도 운영 보고 참조 | 1 | 1 | 정보 부족 469 |
| 확장 미마감 범위 | 76 | 링크 확보 70 | 56 | 56 | 후보 0·정보 부족 26,264 |

최종 무작위 10건의 물리 페이지는 **10/10건 교차 확인**했다(PDF 9건·공식 HWP 뷰어 1건). K-Startup HWP는 공식 렌더링 9쪽 중 1쪽 자격·업력, 3쪽 접수·서류, 4쪽 가점 총상한을 직접 확인했다. 부산 HWP는 원발행기관의 공식 PDF 5쪽을 확보해 기존 HWP 인용 8개를 대조했다. 대상 관련 4개는 PDF 1쪽, 평가 1개는 2쪽, 서류 3개는 3쪽에서 일치했다. 원래 HWP 문단 인용은 유지하고 공식 PDF 페이지는 별도 교차 근거로 기록하며 문단 번호를 페이지로 바꾸어 쓰지 않는다.

신규 요건 크론은 `/api/cron/program-review`에 UTC `*/2 23 * * 0-4`, `*/2 0 * * 1-5`를 준비했다. KST 평일 08:00~09:58에 2분 간격이며 휴일은 실행 경로에서 건너뛴다. 기존 13개를 보존한 **로컬 15개 설정은 준비**, **실제 운영은 13개·신규 2개 등록 대기**다. PR #158의 CI·병합·운영 배포 뒤 실제 등록과 도메인을 별도로 확인한다. 최종 기관별 표·표본 근거·고객별 결과는 [02 운영 결과 보고서](02-operational-results-2026-10-21.md)를 참조한다.
