# 포트폴리오 후보 검사와 지정 제작 구현 결과

2026-10-22 작업. 범위는 **03 전체 구현과 04의 4-1**이다. 4-2, 수동 지문 면제, 마이그레이션은 없다. 운영 배포·제작 버튼 클릭·변환 시작·AI 호출·운영 데이터 변경은 하지 않았다.

## 가장 중요한 판단 3-5

**현시점에 확정할 수 있는 합격 후보는 최소 96개다. 정확한 총수는 아직 확인하지 못했다.** 운영 DB의 후보·검사 캐시·발행 원장·기존 작업을 SELECT로 읽어 저장소의 실제 중복 함수를 적용했다. 대기 189개 중 원본 검사 캐시 178개, 지문 보유 102개, 미리보기 없는 캐시 76개, 100MB 초과 11개다. 유효 캐시는 파일 ID·수정 시각·크기·글꼴 정책 버전을 모두 비교했다.

확보한 비교 증거만 적용하면 합격은 102개다. 다만 기존 변환 작업의 비공개 이미지 3장은 새로 읽지 못해 **102개를 최종 합격 수라고 쓰지 않는다.** 후보 전체에서 동일 정규화 이름 또는 해시 거리 8 이하의 연결 요소를 계산하면 각 요소의 합격 후보는 최대 2개다. 거리 기준 4의 미확인 이미지 1장이 직접 또는 후보 간 중복 판정의 연쇄로 영향을 줄 수 있는 후보는 한 요소 안에 있으므로, 3장에 대해 6개를 모두 빼도 **96개 이상**이다. 이 하한은 미확인 이미지를 빈 이미지로 가정하지 않는다.

따라서 **8개 이상이라는 판단은 확정**할 수 있다. 4-2는 필요하지 않으며, 대표의 명시적 범위 결정대로 구현하지 않았다. 제작 가능은 원본 지문·글꼴 정책·중복 검사 통과를 뜻한다. 실제 장표 적합성·변환·목업·본문 검수의 성공 보장은 아니다.

비공개 이미지 다운로드는 브라우저 승인 게이트에서 거부되어 중단했다. 기존 로컬 워커 자료도 조사했지만 해당 변환 원본은 정리되어 있었고, 남은 자료는 다른 시각의 재가공 결과여서 동일 이미지의 증거로 사용하지 않았다. 현재 연결 도구는 원본 파일 읽기에 필요한 비밀값을 반환하지 않으며 로컬 접속 키도 비어 있다. 읽기 전용 접속 방법에 대한 질문을 전달했다.

## 최신 운영 사실 반영

- 기준 보고서는 2026-10-22 18:40 화면 확인이다. 대기 **189**, 지켜보는 전체 **218**, 제외 **24**, 사용 완료 **5**다. 203은 10/18 자료다.
- 작업 중 별도 SELECT에서는 전체 후보 행 219개(대기 189·제외 25·사용 완료 5)를 읽었다. 화면의 승인 폴더·지원 형식 필터 집계와 전체 테이블 집계를 혼동하지 않는다.
- 10/20 「회사소개서_울림초안」은 후보 없음이 아니라 **선정 후 NON_PRESENTATION_LAYOUT, 5슬라이드 미만으로 실패**했고 `on_hold`로 남아 있다. 화면에 보류 작업 제목과 자동 재처리되지 않는다는 안내를 추가했다. 같은 requestId의 보류/검수 작업은 새 후보를 뽑거나 제작을 다시 시작하지 않는다.
- 크론 매시간 완료, 드라이브 연결 및 확인 파일 1,806개, 사무실 PC 온라인·변환 대기 0건, 노하우형 10/22 정상 발행은 제공된 운영 보고서의 사실로 유지한다. 워커 현재 버전·GEMINI_ENABLED·컨설팅 발행 지연 여부는 추정하지 않았다.

## 03 구현

- 후보 검사 기한: 크론 실행 시작+90초, 관리자 요청 시작+200초. 기한 후 새 다운로드를 시작하지 않고 진행 중 검사만 마친다. 다운로드 동시성 2·100MB 상한·파일 문제의 기존 제외 처리·OAuth/DB 전역 오류 전파를 유지한다.
- 유효 캐시를 먼저 모두 적용한다. 순위순으로 새 파일을 검사하고 중복·글꼴·지문 통과 후보 8개를 확보하면 멈춘다. 다음 요청은 저장한 검사 결과를 재사용한다.
- 합격 후보가 있으면 미완료 검사가 있어도 선정한다. 합격 0이며 남은 검사가 있으면 `inspecting`, 진행 수치, `shouldContinue:true`를 반환한다. 관리자 이어가기 한도 14회를 유지한다.
- 미리보기/상태 GET은 원본 다운로드·토큰 갱신·검사 저장·예약을 하지 않는다. 기존 변환 이미지와 이미지 세트는 중복 비교 증거로 유지한다.
- `pending`/`no_preview`/`too_large`/`failed`를 구분하고, 유효한 지문이 있는 검사 완료 상태는 `passed`다. 이전의 낡은 해시 검수 문구가 새 캐시 결과를 가리지 않도록 했다. 요약은 실제 대기·제작 가능·검사 전·미리보기 없음·큰 파일·실패 수를 표시한다.
- 계측: `total`, `inspected`, `remaining`, `deadlineReached`, `downloaded`, `cached`, `failed`, `skippedLarge`, `durationMs`, `peakRssMb`, `tableReadMs`, `imageHashMs`, `candidateDownloadMs`. 마지막 두 시간은 병렬 실행이 겹칠 수 있는 단계별 합계다. RSS는 테이블·다운로드·ZIP·지문 처리 경계의 관측 최대다.

### 3-3 측정과 읽기 최적화

운영의 기존 10/20 작업에 남은 계측은 전체 **93,127ms, 다운로드 26, 캐시 159, 실패 0**이다. 구버전에는 단계별 시간·최대 RSS·큰 파일 수 필드가 없어 복원할 수 없다. 새로운 운영 요청은 실행하지 않았다.

새 코드의 전체 단계별 시간과 메모리는 계측 필드·stub 테스트로 검증하며, 운영 요청의 실측과 구분한다. 실제 네트워크 기준 테이블 읽기 비중이 20% 이상인지 아직 측정하지 못했으므로 쿼리 필터/컬럼을 임의로 줄이지 않았다. 같은 입력의 원장·기존 작업·이미지 세트·변환 이미지 중복 결과가 유지되는 비교 회귀 테스트를 추가했다. 배포 후 읽기 전용 status/preview의 `inspectionMetrics`로 실제 비중을 얻을 수 있다.

실제 새 inventory 함수를 운영 SELECT 스냅샷으로 로컬 재생한 측정은 다음과 같다. **네트워크 성능 측정이 아니며**, 읽지 못한 기존 변환 이미지 3장의 지문 대신 다른 시각에 만들어져 로컬에 남아 있던 비교 지문을 사용한 계측 시나리오다. 이 재생의 합격 수를 최종 운영 수로 사용하지 않는다.

| 단계/지표 | 로컬 재생 측정 |
|---|---:|
| 테이블 읽기(메모리 stub) | 15ms |
| 기존 이미지 지문(사전 계산값 stub) | 1ms |
| 후보 다운로드 | 0ms / 0건 |
| 전체 시간 | 392ms |
| 관측 최대 RSS | 136.37MiB |
| 캐시 / 실패 / 큰 파일 | 178 / 0 / 11건 |
| 검사 완료 / 남은 검사 | 189 / 0건 |
| 실제 네트워크 / OAuth / DB 쓰기 / 작업 생성 | 전부 0회 |

이 재생의 테이블 비중은 3.83%지만 운영 네트워크 비중의 근거로 쓰지 않는다. 운영 단계별 시간·RSS는 새 읽기 전용 조회가 가능한 환경에서 별도 확인해야 한다.

### 3-4 큰 파일 조사

현재 대기 후보의 100MB 초과 파일은 **11개**다. **실제 Range 지원 여부는 미확인**이다. 토큰을 읽을 수 없어 302 이후 주소에 `Range: bytes=0-1023` 실측 요청을 보내지 못했다. 대용량 파일 전체 다운로드는 하지 않았다.

[NAVER WORKS 공식 다운로드 문서](https://developers.worksmobile.com/kr/docs/file-upload)는 302 Location 조회 후 Bearer 인증으로 파일을 받는 절차와 200 예제를 설명한다. 이 문서만으로 Range의 지원/미지원을 단정할 수 없다.

206 및 올바른 Content-Range가 확인되면 ZIP 끝의 EOCD/ZIP64와 중앙 디렉터리에서 오프셋을 얻고 `docProps/thumbnail.*`, `ppt/**/*.xml` 엔트리만 범위로 읽어 미디어를 건너뛰는 방식은 가능하다. 엔트리 압축 해제·ZIP64·범위 응답 검증·원본 수정 여부 고정이 필요하다. 이는 형식에 대한 가능성 분석이며 **이번 구현에는 넣지 않았다.** 큰 파일은 `too_large`이며 이번 4-1 버튼도 비활성화한다. 지문/원본 글꼴 보호를 풀지 않는다.

## 04 4-1 구현

- 관리자 인증 POST `candidates/[id]/produce`: 대기 상태·유료 글꼴·진행 중 후기형·첫 제작 승인 검사를 거치고 지정한 원본 한 건만 검사한다. 전체 발행 원장·발행 작업·기존 이미지 세트·진행 후보는 비교 증거로 유지한다.
- 중복은 한국어 사유와 기존 글 링크를 반환한다. 미리보기 없는 후보는 `confirmNotPublished`/`note`를 보내도 거부한다. 수동 면제 metadata를 기록하지 않는다.
- 기존 `reserve_deduplicated_portfolio_candidate`로 작업과 6개 큐를 만들고 기존 `processNextPortfolioDownload(candidateId)`로 PC 대기열을 처리한다. 일정 키는 `manual-portfolio-${requestId}`다. 동일 요청은 기존 작업을 재개한다.
- 자동·수동 예약은 기존 `claim_content_automation_run`을 포트폴리오 전용 이름으로 사용해 동시 요청을 직렬화한다. 기존 중복 예약 RPC의 advisory lock은 그대로다. 예약 임계 구역에서 진행 작업을 다시 검사한다. 프로세스가 예약 도중 종료되면 최대 1시간 신규 예약이 차단되는 보수적 제한이 있다.
- 확인창에 파일명·정규화 이름·PC 변환과 AI 본문 비용을 표시한다. 연결·진행 작업·큰 파일·글꼴·지문 없음에 따른 비활성 이유를 표시한다. 이후 같은 requestId로 기존 prepare를 호출하고 기존 WorkQueue에 나타나도록 한다.
- 새 작업의 `mockup:on_hold`는 변환 선행 단계 대기와 실제 실패를 구분한다. 예약 직후 PC 등록만 실패하면 같은 요청으로 재개할 수 있다. 10/20처럼 다운로드가 완료된 뒤 검증 실패한 보류 작업은 자동 재개하지 않는다.

## 검증

- 순서대로 `npm run typecheck` → `npm run lint` → `npm run verify` 실행.
- 최초 전체 verify: **1,327개, 통과 1,322, 실패 0, 생략 5**. 기존 환경 조건부 생략은 유지했다. 뒤이어 수정한 검사·지정 제작·화면/이어가기 테스트는 별도로 통과했다.
- 추가 수정 후 전체 verify: **1,335개, 통과 1,330, 실패 0, 생략 5**. 최종 검토에서는 목표 8개에 승인 폴더 밖 캐시가 포함되어 정상 검사를 막는 경우를 발견해, 목표 개수 계산에만 실제 선정 대상 조건을 추가했다. 중복 판정 결과는 유지한다. 해당 회귀를 포함한 원본 검사 테스트 **20/20**을 통과했다.
- 그 회귀를 넣은 전체 검증에서는 **1,336개 중 통과 1,329·실패 2·생략 5**였다. 토큰 테스트의 명시적 의존성 stub에 새 `metadataEligible` 함수가 누락된 것이 원인이었으며 stub을 보완했다. 지정된 4개 기존 회귀 파일을 다시 실행해 **38/38** 통과했다. 보완한 최신 커밋의 전체 verify·원격 CI 최종 수치는 PR 본문에 기록한다.
- 지정 제작 PGlite 6개: 실제 기존 SQL 예약·6단계 큐·PC 대기열, 원장 링크, 지문 면제 거부, 재전송, PC 등록 실패 복구, 자동/수동 동시 실행, 부분 검사 후 선정 검증.
- 화면/prepare/status stub 13개: 검사 이어가기 14회, 4종 문구, 비활성 조건, 확인창, 같은 requestId, 기존 검수 작업 정지, 변환 대기 이어가기, 초기 미승인 설정, 읽기 오류 처리.
- 지정한 기존 source-inspection/portfolio-selection/project-dedupe/token-refresh 회귀 테스트 통과. 새 크론 상수 관계 테스트는 90초 검사 기한 뒤 기존 `topicPlan` 70초가 240초 예산에 들어가는 관계를 고정한다.
- 테스트는 외부 Gemini·NAVER WORKS·Supabase 요청 없이 실행한다. 운영 SELECT와 구분한다.
- 최종 CI·Vercel 결과와 커밋은 PR에서 확인하며 병합/운영 배포는 하지 않는다.

최초 코드 커밋: `831937df9e2692a3abe8ebfb815ec23bdc75bc85` (선정 대상 8개 계산 회귀 수정은 PR의 후속 커밋). [PR 161](https://github.com/WOOLIM0109/woolimhome/pull/161)은 정확한 운영 집계·Range 실측 보완 전까지 Draft다. 최초 코드의 Vercel 미리보기 `dpl_5E5qxNRDNzxtrVBs3uCMQMwGXf8Y`는 **READY**를 확인했다. 미리보기 화면 접속은 별도의 브라우저 승인 게이트에서 거부되어 실행 결과를 확인하지 못했다.

## 변경 경계

`lib/content-ops/*` **0개**, `lib/gemini/*` **0개**, `WorkQueue.tsx` **0개**, 마이그레이션 **0개**, 컨설팅·노하우형 라우트 **0개** 변경.

공유 파일 전체가 0개라고 보고할 수는 없다. 명시적으로 허용된 **크론 1개**에 포트폴리오 분기 `deadlineAt` 전달과 `localProgress.inspection` 기록만 변경했다(추가 2줄·삭제 1줄). 자동 생성 대상·순서·RUN_BUDGET_MS·GENERATION_BUDGET_MS는 그대로다. prepare 변경은 03의 요청 기한·검사 이어가기와 기존 포트폴리오 선행 단계 상태 구분을 위해 필요하다. status는 정확한 요약, 새 컴포넌트 보조 파일은 두 포트폴리오 버튼의 이어가기 재사용을 위해 추가했다.

코드 diff 확인 명령: `git diff main...831937d --stat -- app components lib` (보고서 자체는 제외).

```text
 .../naver-works/candidates/[id]/produce/route.ts   |  57 ++++++
 .../admin/naver-works/candidates/preview/route.ts  |  10 +-
 app/api/admin/naver-works/prepare/route.ts         |  64 ++++--
 app/api/admin/naver-works/status/route.ts          |  61 +++++-
 app/api/cron/content-operations/route.ts           |   3 +-
 components/admin/NaverWorksDrivePanel.tsx          |  93 +++++++--
 components/admin/PortfolioGenerateButton.tsx       |  37 +---
 components/admin/portfolio-candidate-state.ts      |  33 ++++
 components/admin/portfolio-progress.ts             |  59 ++++++
 lib/naver-works/portfolio-pipeline.ts              | 214 ++++++++++++++-------
 lib/naver-works/portfolio-produce.test.mjs          | 168 ++++++++++++++++
 lib/naver-works/portfolio-selection.ts             |   5 +
 lib/naver-works/source-inspection.test.mjs          | 107 ++++++++++-
 lib/naver-works/token-refresh.test.mjs              |   6 +-
 lib/portfolio/dedupe-inventory.ts                  | 159 ++++++++++-----
 lib/portfolio/inspection-cron-budget.test.mjs       |  19 ++
 lib/portfolio/manual-controls.test.mjs             | 175 +++++++++++++++++
 lib/portfolio/source-inspection.ts                 |  20 +-
 18 files changed, 1079 insertions(+), 211 deletions(-)
```

`git diff main...831937d --numstat -- lib/content-ops lib/gemini components/admin/WorkQueue.tsx supabase/migrations` 출력은 **없음(0개)**이다.

## 운영 반영과 대표 확인

운영 반영 **안 함**. PR에서 멈춘다. 배포 후 버전 API 커밋 대조, 실제 지정 제작 버튼 클릭, PC 변환 결과, 다음 화요일 크론 완료 및 컨설팅 자동 생성 대조는 대표가 한다. 읽기 접근이 제공되면 정확한 최종 합격 수·실제 단계별 시간/RSS·Range 1회 실측을 보완할 수 있다.
