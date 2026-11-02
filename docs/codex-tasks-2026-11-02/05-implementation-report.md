# 05 원고 수정 뒤 이미지 교체 보고

브랜치: `fix/mockup-swap-rebind-20261102`

## 바뀐 동작

새 요청은 원본 PPT 기록, 장표 선정, 가림 기록, 현재 이미지와 수동 업로드 기록을 따로 묶어 저장한다. 원고나 대기 상태만 바뀌었으면 현재 본문에서 기존 그림 네 자리를 다시 찾아 검토한 네 장의 주소로 바꾼다. 제목·문단·FAQ·그림 설명·관련 없는 이미지는 그대로 둔다. `protectedManuscriptHash`로 교체 전후의 원고 보존도 시험했다.

원본·선정·가림·수동 이미지가 바뀌었거나 다른 이미지 묶음이 먼저 적용됐으면 거절한다. 현재 가림 증명은 기존 `isCurrentPortfolioRedactionProof`에 썸네일과 본문에 쓰인 모든 장표를 전달해 확인한다. 이미 발행한 작업물의 새 제작·교체는 서비스·운영 API·SQL 저장 단계에서 막는다.

## 네 차단 지점

| 지점 | 변경 |
|---|---|
| `lib/portfolio/image-set.ts`의 `preparePortfolioImageSetCommit` | 서버에서 이미지 기준을 다시 확인한 호출만 오래된 원고 시각을 풀고, 현재 본문에 네 그림을 맞춘다. 쓰기용 `expectedUpdatedAt`과 `expectedMetadata`는 방금 읽은 값을 쓴다. 준비본의 기존 가져오기 호출은 예전 버전 검사를 유지한다. |
| `lib/portfolio/production-session-server.ts`의 `authorizeSessionSource` | 과거 원고 시각·전체 원고 해시 대신 원본·장표·가림·수동 이미지·현재 묶음을 확인한다. 운영 교체 API에 있던 전체 원고 해시 비교도 같은 기준으로 바꿨다. |
| `activate_portfolio_mockup_session` SQL | 세션 생성 시각과 교체 시각이 같아야 한다는 요구를 없앴다. 검토한 후보·원본 증거·당시 활성 묶음은 계속 확인한다. |
| `activate_portfolio_image_set` SQL | 행을 잠근 다음 방금 읽은 metadata·시각·활성 묶음을 확인한다. 그 사이 값이 바뀌면 저장하지 않는다. 발행 상태도 잠금 안에서 확인한다. |

SQL 두 함수는 새 `202611020001_portfolio_mockup_manuscript_rebind.sql`에만 넣었다. 기존 마이그레이션은 수정하지 않았다. 실행 권한은 기존처럼 `service_role`에만 둔다. 운영 DB에는 적용하지 않았다.

## 화면

거절 사유와 다음에 누를 버튼을 함께 표시한다. 다시 쓸 수 없는 후보에는 복구 방법이 없다고 적는다. 실패 상태에서는 없는 취소 버튼을 안내하지 않는다. 잠긴 버튼에는 사용 조건을 보이는 글과 `aria-describedby`로 연결했다. 목업 교체 버튼은 현재 확인 개수(예: 2/5), 다섯 장 확인, 확인란 선택 순서로 안내한다. 수동 이미지는 다섯 장의 확대 확인과 명시 확인란 없이 교체하지 않는다.

## 예전에 만든 후보의 제한

이전 세션은 이미지 기준을 별도로 저장하지 않고 전체 metadata 해시만 남겼다. metadata가 그대로이고 상태·시각만 바뀌었다면 현재 묶음 등의 검사도 통과하는 기존 후보를 사용할 수 있다. metadata까지 달라졌고 이미지 기준 기록이 없다면 글만 바뀐 것인지 유효한 가림까지 바뀐 것인지 입증할 수 없다. 이 경우 `MOCKUP_IMAGE_INPUTS_UNVERIFIABLE`로 거절하고 자동 복구 방법이 없다고 안내한다. **이전 후보를 모두 살리는 변경은 아니다.** 새 요청부터 원고만 다시 쓴 경우를 안전하게 구별한다.

## 포장 대상과 변경 금지 파일

`PREPARATION_RUNTIME_SOURCE_FILES`와 변경 파일을 대조했으며, 고친 포장 대상은 **`lib/portfolio/image-set.ts` 한 개**다. 런타임 지문이 달라지므로 준비본 재포장·재설치는 대표가 진행해야 한다. 이번 작업에서는 재포장·설치를 하지 않았다.

`lib/pc-worker/preparation/*`, 기존 가림 검사 함수, 목업 렌더러·템플릿·지문 재료, 패키지·잠금 파일은 수정하지 않았다. `npm install`과 `npm ci`는 실행하지 않았다.

## 시험과 최종 확인

실제 시험 파일에 원고 재작성 후 교체, 새 본문 그림 네 장, 선정 변경 거절, 가림 불일치 거절, 발행 거절, 수동 업로드 변경 거절, 다른 묶음 선점, 쓰기 중 metadata·시각 변경, 사유·다음 행동 표시를 넣었다. PGlite에서 새 마이그레이션의 두 SQL 함수를 실행했다. 관리자 화면 시험도 `lib/portfolio/production-mockup-editor.test.mjs`를 통해 전체 검증에 포함했다.

최종 `npm run verify`는 **종료 코드 1**이다. 타입 검사와 린트는 통과했다. 병렬 시험은 1,658개 중 1,643개 통과·10개 실패·5개 건너뜀이며, PowerPoint 순차 시험은 57개 중 56개 통과·1개 실패다. 합계 **1,715개 중 1,699개 통과·11개 실패·5개 건너뜀**이다. 남은 실패를 통과로 간주하지 않았다.

별도 확인은 다음과 같다.

- 최신 교체·SQL·운영 API·권한·관리자 화면 시험: **56/56 통과**.
- 기존 준비본 가져오기와 이미지 서비스 시험: **22/22 통과**. 첫 전체 실행에서 드러난 공통 함수의 검사 위치와 새 인자 전달 문제를 바로잡고 다시 실행했다. 최종 전체 실행에는 그 실패가 없다.
- 전체 실행에서 실패한 `approved-16x9-templates.test.mjs` 단독 재실행: **6/6 통과**. 전체 실행의 실패 원인은 미확정이다.
- 오류 원문 파일을 제외한 `git diff --cached --check` 통과. 원문 파일에는 오류 출력의 줄 끝 공백도 그대로 보존했다. 변경 포장 대상 대조 결과는 `lib/portfolio/image-set.ts` 한 개이며, 금지 파일 변경과 새 주석·문서의 금지 표현은 발견되지 않았다.

## 남은 실패 11건 — 이름과 오류

전체 오류와 스택을 생략 없이 보존한 파일: [05-verify-failures.txt](./05-verify-failures.txt). 아래 이름은 최종 검증 로그 그대로다.

`lib/pc-worker/preparation/production-bridge.test.mjs`의 다음 **9건**은 각각 같은 오류로 실패했다.

```text
Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
```

1. `explicit preparation review applies into a fresh generation and swaps editor only after verified success`
2. `manual preparation selection reaches only the fresh generation and empty selection keeps automatic defaults`
3. `failed preparation, stale old evidence or failed review URL publication preserves original record/editor/artifacts`
4. `restarted daemon resumes the accepted generation without reconversion and rejects arbitrary work directory`
5. `preparation actions serialize and uploading sessions cannot change selection or source format`
6. `explicit reopen rotates only launch token with no preparation, source download or record mutation`
7. `missing local token-rotation feature fails safely without conversion or requeue`
8. `verified snapshot upload holds exclusive preparation lock through record commit`
9. `failed snapshot upload releases preparation lock and preserves review record`

환경 권한 제약으로 보이는 근거는 모든 스택이 동일한 `preparationBridgeFixture`의 237행 `mkdtemp`에서 시작한다는 점이다. 이 시험은 Windows에서 임시 폴더의 부모인 `C:\Users\becky\AppData\Local` 바로 아래에 폴더를 만든다. 해당 위치는 이번 쓰기 허용 범위 밖이다. 시험 파일이나 허용 범위를 바꾸지 않았다. 정상 PC에서의 판정은 별도로 필요하다.

**10번째 실패 이름:** `lib\portfolio\approved-16x9-templates.test.mjs`

```text
'test failed'
```

최종 전체 실행에서는 위 원문만 남겼으며 원인을 더 알려 주는 오류·스택이 없다. 같은 파일 단독 실행은 여섯 항목 모두 통과했고 파일도 수정하지 않았다. 병렬 부하 때문인지 다른 원인인지는 입증하지 못했으므로 샌드박스 오류로 단정하지 않는다.

**11번째 실패 이름:** `injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process`

파일은 `lib/pc-worker/preparation/powerpoint-cleanup.test.mjs`이다. 오류는 `Error: Command failed: powershell.exe -NoProfile -NonInteractive -Command ...`로 시작하며 전체 명령·출력·스택은 위 원문 파일에 있다. 출력에는 다음 코드가 남았다.

```text
HRESULT: 0x80070520
FullyQualifiedErrorId : COMException
```

PowerPoint를 만드는 `[Activator]::CreateInstance`에서 COM 활성화가 실패해 시험이 요구하는 실패 주입·종료 확인에 도달하지 못했다. 실행 세션 제약 가능성의 근거는 이 발생 위치와 HRESULT이며, 사무실 PC의 정상 로그인 세션에서 같은 결과인지 확인하지 않았다. 로그에 깨져 출력된 한글도 고쳐 쓰지 않고 원문 파일에 보존했다.

## 건너뛴 시험과 남은 확인

`runtime-package.test.mjs`의 다음 다섯 항목은 기존 `skip: process.platform === "win32"` 조건으로 건너뛰었다. 이번에 새로 건너뛰게 만든 항목은 없다.

- `dependency collection excludes npm bin links before recursion but includes locked nested semver`
- `dependency payload rejects internal external and broken symlinks`
- `dependency roots and excluded node_modules must be real directories`
- `dependency payload rejects special files before reading them`
- `finished package inspection rejects unexpected node_modules symlinks`

운영 DB·실제 고객 PPT·브라우저의 운영 인증 세션으로 교체를 수행하지 않았다. 새 SQL 적용, 준비본 재포장·설치, 운영 글의 최종 화면 확인은 아직 하지 않았다. 커밋·push·PR 생성까지만 진행하고 병합하지 않는다.
