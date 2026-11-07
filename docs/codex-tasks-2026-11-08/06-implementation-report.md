# 가림 편집기 설치·업데이트 구현 보고

2026-11-08. 범위: 11-08 지시서와 10-28 설계의 작업 B·C. 작업 A·D는 제외했다.

## 결론

**반영 가능.** B·C의 설치·업데이트·되돌리기를 구현했고 전체 검증을 통과했다. 실제 사무실 PC 설치와 재시작은 하지 않았다. 설계가 정한 **병합 후, 대표 편집이 끝나고 열린 요청이 0건인 때**의 운영 확인은 남아 있다.

## 바뀐 파일

모두 새 파일이다. 기존 파일과 사용자가 작업 중이던 변경은 수정하지 않았다.

| 파일 (`tools/woolim-pc-worker/` 기준) | 내용 |
| --- | --- |
| `bridge-launch.ps1` | 설정의 경로·지문 검사, 중복 실행 방지, 숨김 Node 실행, 14일 지난 해당 폴더의 로그만 정리, 반복 재시작 기록 |
| `launch-hidden.vbs` | `worker\|bridge` 인자로 숨김 실행 |
| `bridge-install.ps1` | 기존 파일 보관 후 복사, 현재 사용자·Limited·IgnoreNew 작업 등록, 등록 뒤 PT5M 적용·재조회, 업데이트·되돌리기 바로가기 |
| `bridge-update.ps1` | 준비 확인, 열린 요청 경고(기본 N), 원격 승인 목록 조회, 패키지·설치·시험, 원자적 전환과 시작 확인 |
| `bridge-update.cmd` | 더블클릭 업데이트, ASCII·UTF-8 코드페이지·pause |
| `bridge-rollback.cmd` | `-Rollback`으로 같은 검사를 거쳐 이전 버전 복구 |
| `approved-preparation-runtimes.json` | 기존 9/13 설치본과 지시된 최신 11/08 설치본 승인 기록 |
| `approved-runtime.mjs` | 설계가 요구한 Node 독립 지문 비교 함수와 CLI. 플랫폼별 최신 승인·과거 승인 검사 |
| `bridge-runtime.ps1` | 전환·되돌리기·PID 검사·자식 프로세스 출력 경계를 재사용하고 합성 시험할 함수 |

시험은 `lib/pc-worker/bridge-installation.test.mjs`, 보고는 이 파일에 추가했다. 두 보조 파일은 정확한 지문 비교와 전환·복구의 독립 시험을 위해 분리했다.

기존 `launch-hidden.vbs`, `mockup-bridge-launch.ps1`과 덮어쓰는 app 파일은 설치 시 `%LOCALAPPDATA%\WoolimWorker\_replaced\<날짜시각>\`에 먼저 복사한다. 설치기는 실행 중인 프로세스를 끄지 않는다. `worker-control.ps1`과 기존 켜기·끄기·상태 기능은 작업 D 범위라 수정하지 않았다.

## 승인과 전환

- `git fetch origin main` 성공 후 `git show origin/main:tools/woolim-pc-worker/approved-preparation-runtimes.json`만 읽는다. 작업 폴더의 승인 파일이나 캐시로 대체하지 않는다.
- 업데이트는 `win32/x64` 마지막 승인과 지문이 정확히 같을 때만 설치한다. 되돌리기는 같은 원격 목록에 남아 있는 이전 승인과 정확히 대조한다.
- 설치와 실행에는 기존 `--expected-fingerprint` 검사를 그대로 사용한다. 검증을 끄는 옵션이나 자동 부품 다운로드는 추가하지 않았다.
- `--check` 결과는 허용된 필드·실제 JSON boolean·지문만 검사한다. 자식 프로세스의 원문 출력과 오류는 화면에 전달하지 않는다.
- 설정은 임시 파일에서 이름 교체로 전환한다. 이전 값은 `previous`에 남기고, 30초 안에 새 PID와 새 지문을 확인하지 못하면 이전 설정으로 복구·재시작한다.
- 기존 수동 설치에 설정 JSON이 없으면, 유효한 잠금 PID의 실행 경로·지문에서 이전 런타임을 찾고 승인 및 실행 검사를 거쳐 복구 대상으로 보존한다.
- 종료 대상은 잠금 파일의 PID이고 `node.exe` 및 `run-production-mockup-worker.mjs` 명령줄이 확인된 프로세스로 제한한다. 작업은 Enable 다음 Start 순서로 실행한다.

## 런타임 지문과 계산 출력

전후 모두 **`0dd37af3825d72c564dfe28846a5282cfeba41b15b624fbf43e47d42425020cd`** 이다. 승인 목록의 최신 `win32/x64` 항목도 같은 값이며 버전은 `1.0.0`이다.

실행 명령:

```text
node scripts/package-preparation-runtime.mjs --output C:\dev\woolimhome\.codex-tmp\bridge-before
node scripts/package-preparation-runtime.mjs --output C:\dev\woolimhome\.codex-tmp\bridge-after
```

각 명령의 출력:

```json
{"outputRoot":"C:\\dev\\woolimhome\\.codex-tmp\\bridge-before","version":"1.0.0","fingerprint":"0dd37af3825d72c564dfe28846a5282cfeba41b15b624fbf43e47d42425020cd","fileCount":190,"dependencyCount":6,"installed":false}
{"outputRoot":"C:\\dev\\woolimhome\\.codex-tmp\\bridge-after","version":"1.0.0","fingerprint":"0dd37af3825d72c564dfe28846a5282cfeba41b15b624fbf43e47d42425020cd","fileCount":190,"dependencyCount":6,"installed":false}
```

`node scripts/package-preparation-runtime.mjs`의 지문이 `0dd37af3825d72c564dfe28846a5282cfeba41b15b624fbf43e47d42425020cd` 그대로다.

수정 금지 경로의 `git diff --name-only` 출력은 비어 있다. `PREPARATION_RUNTIME_SOURCE_FILES`에 새 파일을 넣지 않았다.

## 시험 결과

새 시험 `node --test lib/pc-worker/bridge-installation.test.mjs`: **25개 통과, 실패 0, 건너뜀 0**. 새 JS 시험·보조 파일의 ESLint와 구문 검사도 통과했다.

CI에서 실행할 검사:

- 승인 목록 형식·중복, 플랫폼별 최신 선택, 대소문자·공백·누락까지 엄격한 지문 비교, 승인된 과거 버전 검사
- 승인 CLI의 stdin 입력, 잘못된 JSON과 지문 거부, 비밀값을 가장한 합성 문자열의 출력 차단
- 새 파일이 동결된 런타임 목록에 없음, CMD ASCII, PS1 UTF-8 BOM, 비밀키 읽기·검증 우회·범위 밖 삭제 방지
- PowerShell이 있으면 구문 분석, 없으면 생략 대신 금지 문자열 정적 검사

이 Windows PC의 PowerShell 5.1에서 **합성 폴더와 가짜 작업 스케줄러·COM으로** 실행한 검사:

- `-CheckOnly`의 패키지 → 실제 승인 CLI → 합성 설치·실행 시험, 전환·재시작 없음
- 틀린 지문이면 설치 단계 진입 금지, 열린 요청에서 빈 응답이면 취소
- 설정 경로 거부와 원자적 교체, 새 버전 시작 실패 시 기존 설정·프로세스 복구, 수동 이전 승인 버전 복구
- 잠금 PID만 종료하고 다른 Node 명령은 거부, Enable → Start 순서, PID 변경과 정확한 지문 확인
- PT5M 등록 후 재조회, 바로가기 생성과 기존 파일 보관 동작
- 해당 로그 폴더 바로 아래의 14일 지난 `.log`만 삭제, 반복 재시작 기록
- 실제 Node 자식 프로세스의 UTF-8 stdin과 따옴표·공백·역슬래시 인수 전달, 오류 원문 차단

전체 `npm run verify`는 Windows의 `npm.cmd run verify`로 실행해 **종료 코드 0**으로 통과했다. 타입 검사와 ESLint도 통과했다.

| 시험 묶음 | 전체 | 통과 | 실패 | 건너뜀 |
| --- | ---: | ---: | ---: | ---: |
| 일반 시험 (206개 파일) | 1958 | 1953 | 0 | 5 |
| PowerPoint 순차 시험 (3개 파일) | 58 | 58 | 0 | 0 |
| 합계 | 2016 | 2011 | 0 | 5 |

처음 샌드박스 안에서는 기존 시험 9건이 AppData 임시 폴더 쓰기 권한(`EPERM`), 1건이 PowerPoint COM 로그인 세션 제한(`0x80070520`)으로 실패했다. 기존 시험·런타임 파일을 고치지 않고 해당 두 파일을 제한 밖에서 재확인해 **35/35 통과**했으며, 이후 전체 `verify`도 제한 밖에서 다시 실행해 위 결과로 통과했다. 새 시험 25개는 샌드박스 안에서도 모두 통과했다.

실행 로그는 `.codex-tmp/bridge-verify.log`(첫 시도), `.codex-tmp/bridge-environment-recheck.log`(기존 실패 항목 재확인), `.codex-tmp/bridge-verify-unrestricted.log`(전체 최종 통과)에 있다. PowerPoint 합성 오류·종료·시간 초과·체크포인트 시험도 실제로 통과했다.

## 하지 않은 것과 남은 운영 확인

운영 DB·운영 화면·비밀키에 접근하지 않았고, 실제 설치·예약 작업 변경·바탕화면 변경·편집 연결 종료·서버 배포는 하지 않았다. 종료 시각과 당시 열린 요청 수는 해당 없음이다. `--check`의 실제 운영 설정 읽기도 실행하지 않고 합성 출력으로 검사했다. 화면 캡처는 없다(화면 작업 A·D 제외).

실제 Windows Script Host 실행 확인은 환경의 설정 접근 제한으로 수행하지 못했다. VBS의 인자·실행 경로와 숨김 실행은 정적으로 확인했다.

병합 후 열린 요청이 0건인 때 `bridge-install.ps1`로 설치하고, 업데이트의 실제 `-CheckOnly`, 등록된 작업의 PT5M, 실제 바로가기, 재시작 후 잠금 PID·지문 일치를 확인해야 한다. 원격 main에 승인 목록이 병합되기 전에는 업데이트가 중단되는 것이 정상이다.
