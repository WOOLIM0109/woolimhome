# 가림 이어받기 검증 기록 — 2026-11-02

브랜치: `fix/redaction-carry-over-20261102`

**최종 `npm run verify`: 종료 코드 0.** 타입 검사·린트 통과. 총 1,675개 중 통과 1,670, 실패 0, 건너뜀 5. 병렬 1,618개(통과 1,613·건너뜀 5), PowerPoint 순차 57개(전부 통과). [최종 출력 요약 원문](verification-redaction-carry-over-2026-11-02-final-summary.txt).

최종 실행은 권한을 확장해 수행했다. 남은 실패는 없다. 건너뛴 5개는 포장 시험의 Windows 조건이며, 외부 PowerPoint 점유로 건너뛴 시험은 없다. 첫 실행의 모든 실패와 해결·재실행 근거는 아래에 보관했다.

원본 지문(SHA256·바이트 수)과 장표 PNG 해시가 같은 경우 저장한 가림을 새 작업·빌드로 이어받는다. 창고는 `%LOCALAPPDATA%\WoolimWorker\redaction-carry`에 두며, 작업별 폴더와 분리한다. 저장·승인 시 갱신하고 같은 열쇠에는 더 나중 기록을 남긴다.

사각형·공개 예외·검토 기록을 복원하고 PNG를 다시 만든다. 예전 승인자·시각은 `carryOver` 이력으로 보존하며, 새 출력은 사용자 승인 전까지 사용할 수 없다. 기존 검토 화면을 다시 열 때에도 저장된 기록을 창고에 보관한다. 후보 ID가 달라졌으면 종류·필수 여부·좌표가 같은 후보에만 연결하고, 연결이 불명확하면 중단한다.

화면에는 이어받은 장표와 새로 가릴 장표를 구별하고, 잠긴 버튼 옆에 켜지는 조건을 표시한다. 같은 빌드에서 이미 저장·승인한 장표를 다시 열면 저장한 가림이라는 안내를 표시한다.

## 시험

- `redaction-carry-over.test.mjs`: 13 통과. 다른 작업·빌드 간 복원, 원본·그림 해시 불일치, 기존 작업 폴더 삭제 후 PNG 재생성 및 동일 해시, 최신 기록, 경로 이탈·정션 거부, 기존 저장 기록 적재, 후보 ID 재연결 및 불명확한 연결 거부.
- 최종 가림 서비스·파이프라인·이어받기 묶음: 36 통과, 실패·건너뜀 0.
- 최종 편집기·서버 묶음: 61 통과, 실패·건너뜀 0. 기존 저장본 다시 열기와 서버 시작 시 기록 보관도 포함한다.
- `runtime-package.test.mjs`: 작업 폴더에 의존성을 준비한 뒤 11 통과, Windows 조건 5 건너뜀.
- `production-bridge.test.mjs`: 권한 확장 실행에서 20 통과. 기본 실행에서 실패했던 동일 9개도 모두 통과.
- `mockup-request-preparation.test.mjs`: 6 통과.
- 최종 변경의 `npm run typecheck`, `npm run lint`, 소스·시험 파일의 `git diff --check -- lib scripts`: 통과. 시험 출력 원문에 있던 줄끝 공백은 로그 파일에도 그대로 보존했다.

## 전체 검증 첫 실행

`npm run verify` 종료 코드 1. 타입 검사·린트 통과. 전체 1,664개: 통과 1,638, 실패 21, 건너뜀 5. 병렬 묶음 1,607개 중 실패 20, PowerPoint 순차 묶음 57개 중 실패 1.

21개 실패의 이름·오류·스택은 [첫 실행 실패 원문](verification-redaction-carry-over-2026-11-02-first-failures.txt)에 빠짐없이 보관했다. 출력의 깨진 문자도 시험이 출력한 그대로다.

- 브리지 9개: `EPERM: operation not permitted, mkdtemp`로 짧은 시험 폴더를 만들지 못했다. 같은 시험을 같은 코드로 권한 확장 실행했을 때 20개 모두 통과했다. 파일 쓰기 제한이 원인이라고 보는 비교 근거이며, 최종 판단은 이 PC에서 한다.
- 포장 11개: 공통 준비 단계의 `Error: PREPARATION_DEPENDENCY_MISSING`. 작업 폴더에는 `node_modules`가 없었고 상위 저장소 의존성으로 일반 시험이 실행됐다. 상위 저장소에서 잠금 파일과 버전이 같은 필수 6개 패키지만 실제 파일로 복사한 뒤 포장 시험 11개가 통과했다. 링크·네트워크 설치·잠금 파일 변경은 없다.
- PowerPoint 1개: `injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process`. `CreateInstance`의 `COMException`, HRESULT `0x80070520`이 발생했다. 실패는 가림 코드 실행 전 PowerPoint 생성 단계에서 발생했다. 이 사실만으로 제품 코드 문제 여부를 단정하지 않는다.

다음 권한 확장 재실행은 린트 도중 임시 의존성 폴더를 정리한 시점이 폴더 탐색과 겹쳐 중단됐다. 오류는 `Error: ENOENT: no such file or directory, scandir 'C:\dev\woolimhome\.codex-tmp\redaction-carry\.codex-tmp-deps-stage'`이며 시험 실행 전이다. 정리를 마친 뒤 최종 전체 검증이 통과했다. [중단된 린트 출력 원문](verification-redaction-carry-over-2026-11-02-interrupted-lint.txt)을 별도로 보관했다.

첫 실행에서 COM 오류가 난 시험도 최종 권한 확장 실행에서는 통과했다. 같은 변환기 파일을 변경하지 않은 상태에서 결과가 달라졌다는 것이 실행 권한·세션 영향이라고 보는 비교 근거다. 최종 판단은 이 PC에서 한다.

## 포장 대상 변경 파일

런타임 지문이 달라진다. 재포장·설치는 사용자가 한다. 다음 9개는 포장 목록에 포함된 변경 파일 전부다.

- `lib/pc-worker/preparation/redaction-carry-store.ts` (추가)
- `lib/pc-worker/preparation/redaction-service.ts`
- `lib/pc-worker/preparation/redaction-types.ts`
- `lib/pc-worker/preparation/redaction-editor-client.mjs`
- `lib/pc-worker/preparation/local-review-server.ts`
- `lib/pc-worker/preparation/production-bridge.ts`
- `lib/pc-worker/preparation/mockup-request-preparation.ts`
- `scripts/prepare-portfolio-local.mjs`
- `scripts/preparation-runtime-package.mjs`

`slide-preparation.ts`, `pptx-inspection.ts`, `source-format-choice.ts`, `powerpoint-adapter.ts`, `prepare-slides.ps1`은 변경하지 않았다. 기존 지문 검증·같은 출처·보안 토큰·필수 불투명 가림 검사는 유지했다.
