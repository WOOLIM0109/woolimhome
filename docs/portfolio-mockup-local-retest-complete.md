# 실제 PPT 3종 — 로컬 수정 및 완성 목업 재검수

날짜: 2026-09-07

판정: 요청한 세 가지 문제의 로컬 수정과 같은 실제 PPT 3종의 준비·가림·고정 슬롯 합성을 완료했다. 썸네일 3장과 내지 12장을 출력하고 시각 검수했다. 운영 투입·사용자 공개 승인을 뜻하지 않는다.

## 수정한 내용

1. **추상 그래픽 표지 제외 오류**: 사진 추정 경고에 원본·장표·미리보기 해시가 일치하는 개별 고해상도 검토 기록을 연결했다. 확인한 추상 그래픽만 `PHOTO_DENSE`에서 재분류하며, 다른 제외 사유는 유지한다. 오래된 기록·중복·손상된 입력은 차단하고 기록은 허용된 필드만 저장한다. 모든 표지나 큰 이미지를 자동 통과시키지는 않는다.
2. **가림 오탐과 불확실성**: 일반 텍스트 자동맞춤 및 숨은 상속 요소가 전체 원고를 불필요하게 보류시키는 문제를 보완했다. `재직인원`을 `직인`으로 오인하는 경우도 수정했다. 위치가 확인되는 애매한 영역은 원본 확대·개별 사유·가림 또는 비민감 확인으로 처리한다. 원본·영역·가림 편집이 바뀌면 확인 기록은 무효가 된다. 좌표 자체를 찾지 못하거나 추출이 손상된 경우는 계속 차단한다. 전체 확인 체크 하나로 우회할 수 없다.
3. **사용자 지정 세로 규격**: 원래의 `custom / unknown` 검사 결과를 보존하면서 작업별 A4 세로 호환 선택 기록을 정상 선별·가림·배치 경로에 연결했다. 허용 오차 안의 세로 입력만 처리한다. 승인된 가림 PNG에 흰 여백만 보충하므로 규격 보정 단계에서 원본 픽셀을 늘이거나 자르지 않는다. 고정 템플릿 좌표·각도는 변경하지 않았다.

추상 그래픽 재분류와 규격 선택은 현재 로컬 준비 입력/CLI로 전달된다. 가림 불확실성의 개별 확인은 로컬 검토 UI에 연결돼 있다. 이번 실물 검수는 서비스 경로와 명시적인 Codex 로컬 기술 검토 기록을 사용했으며 사용자 대신 발행 승인한 것이 아니다.

## 같은 실제 파일의 결과

기존 16:9 추첨 결과를 유지했고, 나머지 일반 PPT 9개를 다시 추첨·변환하지 않았다.

| 입력 | 전체 미리보기 | 최종 선별·가림 검수 | 완성 목업 |
| --- | ---: | ---: | ---: |
| 기존 무작위 16:9 발표자료 | 12장 | 10장, 2400×1350px | 썸네일 1 + 내지 4 |
| PowerPoint A4 가로 제안서 | 30장 | 8장, 2400×1662px | 썸네일 1 + 내지 4 |
| 사용자 지정 세로 건물관리 제안서 | 21장 | 8장, 1711×2400px | 썸네일 1 + 내지 4 |

- 가로 원본 1번은 고해상도 검토 후 추상 리본 표지로 복구했다. 장식 전체를 가리는 처리는 하지 않았다.
- 세로 원본 1번의 사진 위주 표지는 제외 상태를 유지했다. 이번 썸네일은 대표 5번과 보조 목차 2번을 사용했다.
- 실제 인물·연락처·QR·증빙·고객사 식별 등 확인한 민감 영역은 이번 샘플에서 불투명 가림을 사용했다. 완성 이미지의 회색 사각형은 의도한 가림이며 폰트 깨짐이 아니다. 캐릭터·아이콘·일반 도형은 유지했다.
- 각 장표의 원본과 가림 적용본을 확대 대조했다. 인접 줄에 닿는 가림 높이, 차트 점·선까지 덮는 과도한 범위, 부분 글자 잔존을 수정한 뒤 해당 장표를 다시 검수했다.
- 최종 PNG 15장은 썸네일 1080×1080px, 내지 1600×900px이다. 평행·정렬·여백·빈 슬롯·전체 글자 깨짐·로고/제목 겹침을 확인했다. 가장자리 장표가 화면 밖으로 이어지는 것은 확정된 템플릿의 의도된 배치다.

## 검증 증거

- 관련 전체 회귀 테스트: **220개 통과, 실패 0개**, 118835.5886ms.
- 본문·FAQ·제목·발행 정보 보존 및 실패 시 기존 이미지 세트 유지 관련 17개 포함.
- 타입 검사 통과. Lint 오류 0개, 기존 `ClientMarquee` 이미지 경고 1개. `git diff --check` 통과.
- 최종 실제 파일 감사: 3개 원본 해시 불변, 15개 최종 PNG 해시 일치, 빈 슬롯 0개, 목업별 중복 장표 0개, 보류 0개. 서로 다른 목업 사이의 장표 재사용은 허용되는 구성이다.
- 실제 가림 승인본 → A4 여백 보충 → 초안/최종 합성 → `withVerifiedLocalMockupSet`까지 로컬 검증했다. 마지막 전달 콜백은 개수만 확인하는 로컬 대역이며 외부 저장을 수행하지 않았다.

실행한 전체 회귀 명령:

```powershell
node --test --experimental-strip-types "lib/pc-worker/preparation/*.test.mjs" lib/portfolio/image-set.test.mjs lib/portfolio/body-image-swap.test.mjs lib/portfolio/mockup-only-state.test.mjs lib/portfolio/approved-template-lock.test.mjs lib/portfolio/approved-mockup-suites.test.mjs lib/portfolio/approved-mockup-suite-renderer.test.mjs lib/portfolio/approved-assigned-board-renderer.test.mjs lib/portfolio/approved-mockup-runtime.test.mjs lib/portfolio/approved-mockup-title.test.mjs lib/portfolio/approved-mockup-geometry.test.mjs lib/portfolio/approved-a4-portrait-templates.test.mjs lib/portfolio/approved-a4-landscape-templates.test.mjs lib/portfolio/approved-16x9-templates.test.mjs lib/portfolio/a4-source-fit.test.mjs
```

## 보존 범위와 아직 하지 않은 것

운영 본문·FAQ·제목·발행 정보는 읽거나 수정하지 않았다. 보존 검증은 합성 데이터와 메모리/주입 대역 테스트이므로 실제 운영 DB의 전후 대조 결과로 주장하지 않는다. 목업에 표시한 검수용 제목은 별도 로컬 이미지 상태에만 저장했다.

다음은 남아 있다:

- 사용자의 목업 디자인·가림 범위 최종 확인. 이번 세로 썸네일의 대표 장표 선택도 확인 대상이다.
- 새로운 PPT마다 선별과 애매한 가림 영역의 사람 검토. 이번 결과를 완전 자동 익명화나 모든 문서 무오류 보장으로 볼 수 없다.
- 별도 승인 후 실제 운영 연결·배포·워커 배포 검증. 이번에는 범위 밖이므로 하지 않았다.

Gemini/유료 이미지 API 호출, 외부 이미지 업로드, 운영 DB 변경, 환경변수 파일 접근·값 출력, 커밋·푸시·배포, 설치된 PC 워커 업데이트/재시작은 하지 않았다. 원본 PPT와 기존 dirty worktree를 보존했다.

## 결과 위치

고객 이미지는 저장소나 OneDrive가 아닌 로컬 준비 폴더에만 있다. 각 폴더의 `thumbnail.png`, `body-1.png`~`body-4.png`가 개별 완성본이고 `overview.png`가 한눈에 보는 묶음이다.

- 16:9: `C:\Users\becky\AppData\Local\WoolimWorker\preparation\qa5-real-1\final-mockups`
- A4 가로: `C:\Users\becky\AppData\Local\WoolimWorker\preparation\qa5-real-2\final-mockups`
- 사용자 지정 세로: `C:\Users\becky\AppData\Local\WoolimWorker\preparation\qa5-real-3\final-mockups`
- 실행·해시 감사: `.codex-tmp/mockup-stage-5/final-audit.json` 및 각 준비 폴더의 `retest-result.json` / `final-mockups/result.json`.

이번 고정 샘플의 개별 가림 좌표는 일회성 로컬 QA 자료다. 무인 처리 규칙으로 재사용하지 않는다. 가림 기술 검수 기록의 주체는 `Codex local technical QA (not publication approval)`이며 공개 승인 상태는 별도로 미승인이다.
