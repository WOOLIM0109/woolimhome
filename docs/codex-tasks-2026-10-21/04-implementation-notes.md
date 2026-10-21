# 04 관리자 공고 검토 화면

2026-10-21, 03 운영 검증을 통과한 뒤 구현했다. 운영 화면 검증과 배포 커밋은 해당 PR의 최종 검증 기록으로 보충한다.

## 화면과 처리

- `/admin/program-review`: 오픈채팅 옆의 **공고 검토** 메뉴. 오늘 읽을 공고 최대 8건과 대상별 상위 10건을 구분한다. 울림·셀라벤토와 고객사 검색을 지원한다.
- 공고명·기관·마감·대상·조건부 후보/확인 필요·점수·첨부 상태·대상별 최신 검토를 표시한다. 정보가 없다는 이유로 탈락시키지 않으며 명백한 불일치·마감·기존 제외 공고는 정상 후보 목록에 복원하지 않는다.
- 상세에서 요건 JSON을 표로 펼치고 근거 쪽수/문단, 매칭 이유, 대상별 최신 검토를 표시한다. 본문과 마크다운은 HTML 실행 없이 텍스트로 렌더링한다.
- 원문 첨부는 관리자 쿠키와 공고/첨부 소속을 확인한 뒤 private Storage의 600초 서명 URL로 리다이렉트한다. 서명 URL은 JSON·화면 상태에 넣지 않는다.
- 자사 프로필은 읽기 전용이며 수정 제안을 버전 확인 후 승인/반려한다. 승인은 프로필 버전과 매칭 컨텍스트를 갱신하고 재매칭 전에는 이전 결과로 표시한다. 반려는 원본과 기존 매칭을 바꾸지 않는다.
- 기관별 마지막 성공·최근 오류·첨부 확보/추출 상태를 표시한다. 분모는 최근 60일 중 마감이 확인되고 지나지 않은 공고다. 마감 미확인은 별도 집계하며 공고 0건을 수집 성공으로 간주하지 않는다.

## API와 권한

관리자 API 6개는 `overview`, `programs`, `programs/:id`, `programs/:id/text`, `programs/:id/attachments/:attachmentId/download`, `proposals/:id`다. 쿠키 관리자 인증은 DB·본문·params 접근 전에 수행한다. AI 직원 토큰만으로 관리자 API에 접근할 수 없다. POST는 같은 Origin·64KiB JSON·엄격한 필드/버전을 요구하며 승인자는 서버 세션에서 정한다. 응답은 private/no-store다.

기존 오픈채팅 수집 → 초안 → 승인 → 발행 코드와 기존 관리자 실행 API, `vercel.json`의 15개 경로·시간은 변경하지 않았다. 04의 추가 마이그레이션은 **없음**이며 03에서 적용한 private 테이블/RPC를 사용한다.

## 로컬 검증

- `npm test`: **1,307개 / 통과 1,302 / 실패 0 / 기존 skip 5**.
- `npm run typecheck`, `npm run lint`, `npm run build`: 통과.
- 관리자 API 11개와 스키마 승인/반려/replay 검증을 포함한 집중 테스트 12개 통과.
- 다운로드의 600초·private bucket·소속/경로/Origin 검증, 인증 순서, CSRF, 본문 크기, 최신 검토/동률, 기관 집계, 대상별 후보/확인 필요 대체 목록을 검증했다.

## 변경 파일과 운영 확인 위치

화면: `app/admin/program-review/page.tsx`, `components/admin/AdminPortal.tsx`, `components/admin/ProgramReviewOperations.tsx`.

서버: `lib/program-review/admin-api.ts`, `admin-route.ts`, `app/api/admin/program-review/` 아래 위 6개 신규 route. 테스트: `admin-api.test.mjs`, `agent-schema.test.mjs`.

03 운영 실측은 [03 운영 결과](03-operational-results-2026-10-21.md)에 기록했다. 최종 배포의 main SHA·READY·운영 도메인·15개 크론 동일성, 화면 확인, 프로필 승인 후 재매칭 및 자사별 상위 10건은 PR 최종 기록으로 남긴다. 다음 날 아침 자동 실행은 아직 관측하지 않았으므로 완료했다고 쓰지 않는다.

대표가 할 일: **없음**.
