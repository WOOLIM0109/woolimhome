# 01 진행 보고

관측일: 2026-10-20 KST. **01 운영 완료 기준은 아직 미통과이며 02·03·04 기능 작업은 착수하지 않았다.**

## 커밋과 변경 파일

- 최초 구현: `a02eaf5de0f166c3da6b466d37bf66eeadec1b4f`
- 저장 경로·ZIP 메모리 보완: `2171fdcbdca2c48eef161d36ea1c1bf6fdbf7e2a`
- 브랜치: `feat/program-review-attachments`

| 구분 | 바꾼 파일 |
|---|---|
| 첨부 링크·다운로드·저장키 | `lib/program-review/attachments.ts`, `attachments.test.mjs` |
| 수집 실행·잠금·재개 | `lib/program-review/attachment-runner.ts`, `attachment-runner.test.mjs` |
| HWP/HWPX/PDF/ZIP 변환 | `lib/program-review/extract-text.ts`, `extract-text.test.mjs` |
| DB 권한·기존 크론 회귀 | `lib/program-review/attachments-schema.test.mjs` |
| 기존 크론 라우트에 작업 등록 | `app/api/cron/openchat/[task]/route.ts`, `lib/openchat/types.ts`, `operations.ts`, `collectors.ts`, `push.ts` |
| DB·비공개 버킷 | `supabase/migrations/20261020122223_openchat_program_attachments.sql` |
| 의존성·일정·CLI 임시파일 제외 | `package.json`, `package-lock.json`, `vercel.json`, `.gitignore` |
| 실제 회귀 자료 | `test-fixtures/program-review/README.md`, `agro-industrial-2026.hwp`, `social-enterprise-2026.hwpx`, `social-enterprise-2026.pdf`, `invention-procurement-2026.zip` |
| 검증 보고·다음 실행 조회 | `docs/codex-tasks-2026-10-21/01-source-audit.md`, `01-operational-check.sql`, 이 보고서 |

## 마이그레이션

운영 Supabase에 `openchat_program_attachments`를 개별 적용했다. 로컬 파일 번호는 `20261020122223`, 관리 도구가 운영 이력에 기록한 버전은 `20261020123645`다. 기존 이력과 무관한 일괄 `db push`는 사용하지 않았다.

- `openchat_program_attachments`: 첨부 원본·해시·추출 결과·ZIP 부모·재시도/처리 잠금.
- `openchat_program_attachment_discovery`: 상세 본문·첨부 발견 결과·확인 시각. 기존 공고 행을 갱신하지 않는다.
- 두 테이블 RLS 활성화, `PUBLIC`/`anon`/`authenticated` 권한 제거, `service_role` 권한 확인.
- `claim_openchat_attachment(uuid)`: 원자적 잠금, 제외·마감 공고 차단, 3회 재시도, 만료 잠금 재개. 공개 호출 불가 확인.
- `program-attachments`: 비공개, 파일당 31,457,280바이트 제한. `storage.objects`에 공개 접근 정책 없음 확인.
- Security Advisor의 신규 테이블 항목은 정책 없는 RLS의 INFO 안내다. 공개 역할 권한을 제거한 서비스 전용 테이블로 의도한 설정이다.

## 테스트

최종 릴리스 소스 `2171fdc`에 대한 검사 결과다.

- **`npm test`: 총 1,075개 중 1,070개 통과, 실패 0, 기존 건너뜀 5.**
- `npm run typecheck`, `npm run lint`와 변경된 파일의 lint 통과. 로컬 빌드 및 최종 운영용 원격 빌드 통과.
- 첨부 관련 테스트: **32/32 통과**.
- 실제 HWP: 신청 자격·제출서류, 압축/레코드/제어문자/문단 표식 확인.
- 실제 HWPX: 표의 셀·행, 구역 순서·문단 표식 확인.
- 실제 PDF: 11쪽 구분, 50자 경계 확인. 실제 ZIP: 빈 HWP 양식 6개 추출.
- 실제 운영 대상 공고의 공개 PDF를 로컬에서 다운로드해 **4쪽, 2,609자, extracted** 확인. 운영 실행 성공 수에 포함하지 않았다.
- 실제 SDK 전송 URL에서 ASCII 저장 키와 1,024바이트 제한을 확인. 원본 한국어명은 DB `file_name`에 보존한다.
- ZIP 캐시는 최대 100MiB·부모 2개이며 제거된 항목은 비공개 원본에서 복구한다.
- 기존 크론 11개 경로·표현식 유지 테스트 통과. 신규 첨부 작업은 기존 알림·승인·발행 함수에 진입하지 않는다.

## 운영 반영

**2026-10-20 21:50 KST 운영 반영 완료.** 마이그레이션 적용 후 최종 코드 `2171fdc`의 배포 `dpl_2jqBHghzBtKW2TEGPuiqeomm9FAv`를 운영으로 승격했다. READY 상태, `programReviewCommit`, `www.woolimcompany.kr` 연결, 활성화된 프로젝트 크론 13개를 실제 조회로 확인했다. 기존 11개의 경로·표현식은 모두 일치한다.

운영 도메인에서 홈페이지 HTTP 200, 인증 없는 첨부 크론 HTTP 401, 인증 없는 기존 관리자 공고 API HTTP 401을 확인했다. **21:51 KST 운영 DB의 첨부 실행 로그·첨부·상세 탐색 행은 각각 0개**이며, 정상 크론의 실제 수집·저장 성공을 의미하는 검증은 아직 하지 못했다.

첨부 작업은 **평일 08:10·08:40·09:10 KST**, 기존 아침 수집은 **08:00 KST**를 유지한다. UTC 표현식은 `10,40 23 * * 0-4`와 `10 0 * * 1-5`다. 한 회 최대 15개이며 ZIP 부모·자식도 각각 처리 수에 포함한다. 시간 부족 시 pending으로 남겨 다음 회차에 재개한다.

저장 경로는 `YYYY/MM/<program_id>/<ASCII로 인코딩한 원본파일명>`이다. Supabase의 [공식 객체 키 제한](https://github.com/supabase/storage/blob/master/src/storage/limits.ts) 때문에 UTF-8 원본명을 base64url로 가역 인코딩하며, 매우 긴 이름만 이름 해시를 사용한다. 표시·다운로드용 원본명은 DB에 그대로 둔다. 한국어 이름을 URL 퍼센트 인코딩한 키는 사용하지 않는다.

## 완료 기준과 중단 지점

| 문서 | 완료 기준 / 현재 판정 | 커밋·마이그레이션·테스트·운영 반영 |
|---|---|---|
| 01 | **미통과**: 운영 하루치 추출률 80% 실측 필요 | 위 커밋·마이그레이션·검사 결과 참조. 01 첨부 트랙 운영 반영 완료 |
| 02 | 미착수: 01 완료 기준 통과 전 진행 금지 | 커밋 없음 / 마이그레이션 없음 / `npm test` 해당 작업 미실행 / 미반영 |
| 03 | 미착수 | 커밋 없음 / 마이그레이션 없음 / `npm test` 해당 작업 미실행 / 미반영 |
| 04 | 관리자 화면 기능 미착수 | 커밋 없음 / 마이그레이션 없음 / `npm test` 해당 작업 미실행 / 미반영. 01 검증에 필요한 운영 적용만 먼저 수행 |

기관별 실사는 [별도 21행 표](01-source-audit.md)에 기록했다. 실제 공고 표본 확인은 18/21곳이며 소상공인24·스마트공장·혁신바우처는 사유를 적어 미검증으로 남겼다. 쿠키·POST·iframe 전용 경로가 필요한 기관을 모두 자동 처리한다고 주장하지 않는다.

2026-10-20 아침 기존 수집 로그는 171건, 당일 신규 저장 28건, 관측 시점 미마감·비제외 신규 공고 1건이다. 이 숫자는 10월 21일 실제 실행 결과를 대체하지 않는다. 운영 인증 환경변수는 설정되어 있지만 이 세션의 로컬 pull에는 사용할 값이 제공되지 않아 인증 크론의 수동 실행은 하지 못했다. 비밀값을 추측하거나 다른 인증으로 우회하지 않았다.

다음 확인은 **2026-10-21 09:10 KST 회차가 끝난 뒤** [읽기 전용 SQL](01-operational-check.sql)로 한다. 기관별 수집 공고 수·처리 대상·첨부 확보·모든 문서 추출 성공·실패 사유와 실행 로그를 함께 확인한다. ZIP 컨테이너는 문서 분모에서 제외하며 공고의 문서가 모두 `extracted`일 때만 공고 완료로 센다. 발견 실패·미탐색을 첨부 없음으로 간주하지 않는다. 분모가 0이면 80% 통과로 판정하지 않는다.

**다음 날 실제 실행 표, 요건 추출·대상별 후보 수, 공고 5건 근거 대조, API 호출 예시, 관리자 화면은 아직 제공하지 않았다.** 01을 통과한 것처럼 02로 넘어가지 않고 여기서 중단한다.

대표가 할 일: **10월 21일 09:15 KST 이후 이 작업 재개 요청 1회.** 운영 설정·키 복사·DB 수동 작업은 없음. 다음 날 표는 아직 작성하지 않았으며, 실제 조회 후 01 통과 여부를 판정하고 그때 02를 시작해야 한다.
