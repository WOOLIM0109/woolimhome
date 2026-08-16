# 울림 Windows 문서 변환 워커

NAVER WORKS의 PPT·PDF 원본을 신뢰할 수 있는 Windows PC에서 내려받아 페이지 PNG로 변환합니다. 원본과 중간 파일은 서버 저장소에 올리지 않고, 변환이 끝나거나 실패하면 PC의 작업 폴더에서도 삭제합니다. 비정상 종료로 남은 폴더는 다음 실행 때 24시간이 지나면 정리합니다.

한 서버에 집 PC와 사무실 PC를 동시에 연결할 수 있습니다. 각 PC는 서로 다른 `WOOLIM_WORKER_ID`와 비밀키를 사용해야 합니다.

## 권장 식별값

| PC | Worker ID | 표시 이름 예시 |
| --- | --- | --- |
| 기존 집 PC | `becky-office-pc` | `울림 집 PC (기존)` |
| 새 사무실 PC | `woolim-office-pc` | `울림 사무실 PC` |

Worker ID는 한 번 정한 뒤 바꾸지 않는 것이 좋습니다. 영문 소문자, 숫자, `.`, `_`, `-`만 사용할 수 있으며 2~64자입니다.

## 먼저 준비할 것

- Windows 10/11과 Windows PowerShell 5.1
- 데스크톱 Microsoft PowerPoint
- PDF 변환용 Poppler의 `pdftoppm.exe`
- 원본 문서에 사용된 적법한 라이선스의 글꼴
- 서버에 등록한 이 PC 전용 워커 비밀키

PowerPoint가 없는 PC는 PPT/PPTX/PPTM을 처리할 수 없습니다. Poppler가 없으면 PDF만 처리할 수 없습니다. 워커는 PATH, Scoop, Chocolatey, WinGet, Codex 런타임 및 몇 가지 일반 설치 위치에서 `pdftoppm`을 자동 검색합니다. 자동 검색이 안 되면 설정 시 `-PdfToPpmPath`를 지정합니다.

## 안전한 서버 배포 순서

다중 워커는 **DB 마이그레이션을 먼저 적용하고, 그다음 애플리케이션을 배포**해야 합니다. 순서를 바꾸면 새 서버 코드가 아직 없는 DB 함수와 컬럼을 사용해 작업 선점 API가 실패할 수 있습니다.

1. 집 PC와 사무실 PC용 비밀키를 각각 생성합니다.
2. 서버의 `PC_WORKER_SECRETS`에 두 ID와 비밀키를 등록합니다. 전환 중에는 기존 `PC_WORKER_SECRET`을 유지하고 `PC_WORKER_ALLOW_LEGACY=true`로 둡니다.
3. `202608040008_multi_pc_workers.sql` DB 마이그레이션을 먼저 적용하고 성공을 확인합니다.
4. 다중 워커 애플리케이션 코드를 배포하고 작업 선점·상태 API가 정상인지 확인합니다.
5. **3번과 4번이 모두 끝난 뒤에만 새 사무실 PC 워커를 설정하고 시작합니다.** 이전에는 두 번째 워커를 실행하지 마세요.

서버의 `PC_WORKER_SECRETS`에는 Worker ID별로 서로 다른 비밀키를 JSON으로 등록합니다. 실제 값은 저장소나 문서에 넣지 마세요.

```text
{"becky-office-pc":"<HOME_PC_SECRET>","woolim-office-pc":"<OFFICE_PC_SECRET>"}
```

기존 단일 PC용 `PC_WORKER_SECRET`과 식별값 없는 구형 워커는 전환 기간에만 계속 허용합니다. 최종 정리 방법은 아래에 있습니다.

## 새 사무실 PC 설치

위의 DB 마이그레이션과 애플리케이션 배포가 모두 완료된 후, PowerShell을 일반 사용자 권한으로 열고 이 폴더에서 실행합니다. 관리자 권한은 필요하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 `
  -WorkerId woolim-office-pc `
  -WorkerName "울림 사무실 PC"
```

비밀키 입력창이 뜨면 서버의 `woolim-office-pc`에 등록한 값을 입력합니다. 입력 내용은 화면에 표시되지 않습니다. 비밀키는 스크립트, 명령행, 예약 작업 인수에 들어가지 않고 현재 Windows 사용자의 환경변수에 저장됩니다.

Poppler 위치를 직접 지정해야 하는 경우:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 `
  -WorkerId woolim-office-pc `
  -WorkerName "울림 사무실 PC" `
  -PdfToPpmPath "C:\Tools\poppler\Library\bin\pdftoppm.exe"
```

설정 스크립트가 하는 일은 다음과 같습니다.

1. 값을 현재 Windows 사용자 환경변수에 저장합니다.
2. 워커 파일을 `%LOCALAPPDATA%\WoolimWorker\app`에 복사합니다.
3. `Woolim Worker - woolim-office-pc` 예약 작업을 현재 사용자 권한으로 등록합니다.
4. 다음 로그인부터 숨김 창으로 자동 실행합니다.

즉시 실행까지 하려면 `-StartNow`를 추가합니다. 자동 시작 등록 없이 시험 설치하려면 `-NoAutoStart`를 사용합니다.

## 점검

로컬 설정, PowerPoint, Poppler, 예약 작업만 점검하며 기본적으로 서버나 작업 큐에는 접근하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnose.ps1
```

서버에 heartbeat 한 번을 보내 인증과 표시 상태까지 확인하려면 다음을 실행합니다. 이 명령은 작업을 선점하지 않습니다. 같은 Worker ID의 워커가 이미 실행 중이면 상태를 덮어쓰지 않고 오류로 종료하므로, 실행 중인 워커는 먼저 중지하거나 관리자 화면에서 상태를 확인하세요.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnose.ps1 -TestServer
```

관리자 페이지에서 집 PC와 사무실 PC가 각각 별도 행으로 나타나는지 확인합니다.

## 집 PC 전환

서버가 다중 워커 버전으로 배포되고 사무실 PC가 정상 표시된 뒤 집 PC를 전환합니다. **새 스크립트를 설치하기 전에 기존 집 PC 워커를 먼저 완전히 중지해야 합니다.** 그렇지 않으면 구형 프로세스와 새 예약 작업이 같은 작업을 동시에 처리할 수 있습니다.

먼저 작업 스케줄러에서 기존 울림 워커 작업을 중지합니다. 작업 이름을 모르면 아래 명령으로 후보만 확인합니다.

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like "*Woolim*" -or $_.TaskName -like "*울림*" } |
  Select-Object TaskName, State
```

그다음 `worker.ps1`을 실행 중인 프로세스를 확인합니다. 다른 PowerShell 프로세스를 일괄 종료하지 말고, 출력된 명령행이 기존 울림 워커가 맞는 PID만 작업 관리자 또는 `Stop-Process -Id <확인한_PID>`로 종료합니다.

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.CommandLine -match 'WoolimWorker|woolim-pc-worker.+worker\.ps1' } |
  Select-Object ProcessId, CommandLine
```

위 명령 결과에 기존 워커가 더 이상 없을 때, 같은 폴더의 새 스크립트로 아래 명령을 실행합니다. 기존 ID를 유지하고 집 PC 전용 비밀키를 입력합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 `
  -WorkerId becky-office-pc `
  -WorkerName "울림 집 PC (기존)" `
  -ReplaceSecret `
  -StartNow
```

설치 후 위 프로세스 확인 명령을 다시 실행해 집 PC 워커가 정확히 하나인지 확인하고, 관리자 화면에서도 `becky-office-pc`와 `woolim-office-pc` 두 행만 정상적으로 갱신되는지 확인합니다. 구형 워커의 기본 ID는 하위 호환을 위해 `becky-office-pc`로 유지됩니다.

## 전환 완료 후 레거시 인증 제거

집 PC와 사무실 PC가 모두 `PC_WORKER_SECRETS`의 각자 비밀키로 정상 인증되고, 각 PC에서 워커 프로세스가 하나씩만 실행되는 것을 확인한 뒤 서버 설정을 정리합니다.

1. `PC_WORKER_SECRETS`에 `becky-office-pc`와 `woolim-office-pc`가 모두 남아 있는지 확인합니다.
2. 기존 공유 `PC_WORKER_SECRET` 환경변수를 삭제합니다.
3. `PC_WORKER_ALLOW_LEGACY=false`로 설정합니다.
4. 변경된 환경변수가 적용되도록 애플리케이션을 다시 배포합니다.
5. 두 PC의 heartbeat와 작업 선점이 계속 정상인지 관리자 화면에서 확인합니다.

이 정리를 마치면 식별값이 없는 구형 워커와 공유 비밀키 요청은 더 이상 허용되지 않습니다.

## 실행 방식

- 유휴 상태에서는 60초마다 heartbeat를 보내고 작업을 확인합니다.
- 변환 중에는 별도 백그라운드 heartbeat가 45초마다 이어집니다.
- 서버가 한 작업을 한 PC에 선점시킨 뒤 해당 PC만 완료 또는 실패를 보고합니다.
- 워커 `2.5.4`는 `powerpoint_selective_redaction_manifest_v2` 기능을 서버에 알리며, 그룹 안팎의 0폭 연결선과 슬라이드 밖 비표시 도형은 가림 영역이 없는 요소로 안전하게 건너뜁니다.
- PPT는 PowerPoint와 설치 글꼴로 최대 100장의 대표 슬라이드를 PNG로 만듭니다.
- PDF는 `pdftoppm`으로 최대 100페이지를 렌더링하며, 16:9·4:3·A4 가로·A4 세로를 지원합니다.
- 작업이 끝나거나 실패하면 내려받은 원본과 생성 이미지가 로컬에서 삭제됩니다.

### PowerPoint 선택적 블러 v2

- 제목 placeholder의 26pt 이상 텍스트와 일반 32pt 이상 텍스트는 별도의 제목 문구 whitelist 없이 유지합니다.
- WordArt도 `TextEffect.Text`와 `TextEffect.FontSize`를 판독해 일반 32pt 이상 제목은 유지하고, 식별 신호가 있거나 32pt 미만이면 요소 영역을 블러합니다. WordArt 판독 실패 시 해당 슬라이드를 제외합니다.
- 이메일·URL·전화번호·주소·사업자번호·회사명·고객사·프로젝트명·담당자·로고 등 식별 신호가 있으면 글자 크기와 관계없이 블러 대상으로 분류합니다.
- 원본 파일명에서는 확장자와 `최종`, `제안서`, `발표본`, `PPT`, `연구개발` 같은 일반어를 제거해 2자 이상의 고객 식별 토큰을 로컬에서 추출합니다. 파일명 토큰과 문구를 한글·영문·숫자만 남긴 로컬 canonical 형식으로 비교하므로 `HPC컨설팅`/`HPC 컨설팅`, `현대자동차`/`현대 자동차`처럼 공백·구두점이 달라도 식별합니다. 짧은 영문 약어는 더 긴 영단어의 일부와 일치하지 않도록 경계를 확인합니다. 해당 토큰이 제목에 있으면 큰 글자도 블러하며, 토큰 원문과 판독 문구는 manifest에 넣지 않습니다.
- `msoPlaceholder`도 `PlaceholderFormat.ContainedType`을 필수로 판독합니다. picture·table·chart·SmartArt·media·OLE 등 비텍스트 콘텐츠가 들어 있으면 placeholder 영역을 블러하고, 일반 텍스트 placeholder만 기존 글자 크기 규칙으로 판정합니다. 내부 형식 판독 실패 시 해당 슬라이드를 제외하며, 모호한 형식은 검증된 placeholder 경계만 안전하게 블러합니다.
- PowerPoint가 기밀 텍스트 줄의 렌더링 좌표를 잘못 반환하면 해당 줄이 속한 텍스트 상자만 보수적으로 가립니다. 텍스트 상자가 장표 전체를 덮거나 상자 좌표도 검증할 수 없을 때만 그 원본 장표를 제외합니다.
- 그룹은 모든 child와 그 좌표를 재귀적으로 판독하고, 민감한 child의 영역만 요소별로 블러합니다. 부모 그룹의 이름·대체 텍스트·제목에서 고객사·프로젝트·로고 같은 식별 신호가 발견되면 중첩 그룹을 포함한 모든 자식에 그 신호를 전파해 각 자식 영역을 따로 블러합니다. 그룹 전체 경계 fallback은 사용하지 않으며 child 좌표나 내용 판독이 실패하면 해당 슬라이드를 제외합니다.
- 모든 배경과 shape를 완전히 판독했고 민감 영역이 없는 슬라이드는 `regions=[]`로 내보내며 원본 화면을 유지합니다.
- 슬라이드 전용 배경은 `FollowMasterBackground=false`일 때만 별도로 판독합니다. 실제 슬라이드에 놓인 전체 화면 picture/texture와 picture Background는 원본 장표를 제외하지만, CustomLayout·Master의 반복 템플릿 picture shape는 고객사·로고 식별 신호가 없을 때 디자인 배경으로 유지합니다. 판독할 수 없는 그룹·shape·배경은 원본 슬라이드를 제외하며 전체 블러로 대체하지 않습니다. 작은 picture·logo·식별 텍스트는 요소 영역별로 블러하고, 제외한 원본 슬라이드 번호와 사유는 로컬 로그에 기록합니다.
- full-slide fallback region은 만들거나 사용하지 않습니다.
- manifest는 `version=2`, `method=powerpoint_com_shapes_v2`이며 원본 장수 `sourceSlideCount`와 usable 장수 `slideCount`를 따로 기록합니다. 포함된 각 슬라이드는 `inspectionStatus=verified`를 가집니다. 따라서 일부 슬라이드가 제외되어도 원본이 20장 이상이었다면 서버가 6장 구조 규칙을 유지할 수 있습니다.
- 완전 판독·내보내기에 성공한 usable slide가 5개 미만이면 `INSUFFICIENT_USABLE_SLIDES`로 작업을 명확하게 실패 처리합니다.

수동 1회 실행은 실제 대기 작업을 하나 선점할 수 있습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\WoolimWorker\app\worker.ps1" -Once
```

## 환경변수

| 이름 | 설명 | 기본값 |
| --- | --- | --- |
| `WOOLIM_WORKER_ID` | 서버에서 PC를 구분하는 고유 ID | `becky-office-pc` |
| `WOOLIM_WORKER_NAME` | 관리자 화면 표시 이름 | `울림 집 PC (기존)` |
| `WOOLIM_PC_WORKER_SECRET` | 이 PC의 서버 인증 비밀키 | 없음, 필수 |
| `WOOLIM_WORKER_SERVER_URL` | 울림 사이트 주소 | `https://woolim-site.vercel.app` |
| `WOOLIM_PDFTOPPM_PATH` | `pdftoppm.exe` 파일 또는 포함 폴더 | 자동 검색 |

Windows 사용자 환경변수보다 현재 프로세스 환경변수가 우선합니다. 이는 임시 테스트에만 사용하고, 예약 작업에는 `setup.ps1`로 저장한 사용자 설정을 사용하세요.

## 업데이트

워커는 시작할 때마다 스스로 최신인지 확인합니다.

`install.ps1`을 실행한 폴더를 기억해 두었다가, 워커가 뜰 때 그 저장소를 앞으로 감기로 당기고
`worker.ps1`이 더 새 버전이면 설치 폴더에 다시 복사한 뒤 새 파일로 자신을 다시 띄웁니다.
그래서 PC마다 저장소 경로가 달라도, PC를 여러 대 쓰더라도 따로 맞춰 줄 일이 없습니다.

기억해 둔 경로는 사용자 환경변수 `WOOLIM_WORKER_SOURCE`에 있습니다.
저장소를 옮겼다면 새 위치에서 `install.ps1`을 한 번 실행해 경로를 다시 기록해 주세요.
자동 갱신을 멈추려면 `WOOLIM_WORKER_AUTO_UPDATE`를 `off`로 두면 됩니다.

당겨 오기나 복사가 실패해도 워커는 지금 버전으로 계속 일합니다. 멈추는 쪽이 더 나쁩니다.
무슨 일이 있었는지는 `%LOCALAPPDATA%\WoolimWorker\worker.log`에 남습니다.

곧바로 올리고 싶을 때는 새 버전의 이 폴더에서 아래 명령을 실행합니다.
설정과 비밀키는 바뀌지 않고 워커 파일과 예약 작업만 갱신합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

비밀키를 교체할 때만 `setup.ps1`에 `-ReplaceSecret`을 붙입니다. 비밀키를 명령행 인수로 전달하는 옵션은 의도적으로 제공하지 않습니다.

## 제거

예약 작업과 설치 파일만 제거하고 설정·로그는 보존합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

사용자 환경변수까지 제거하려면 `-ClearConfiguration`, 로그와 남은 작업 폴더까지 제거하려면 `-RemoveLocalData`를 추가합니다. 삭제 전에 PowerShell 확인 메시지가 표시되며, 대상은 `%LOCALAPPDATA%\WoolimWorker`로 제한됩니다.

## 로그와 문제 해결

로그 위치:

```text
%LOCALAPPDATA%\WoolimWorker\worker.log
```

- `MISSING_FONTS`: 표시된 글꼴의 정확한 라이선스와 파일을 확인해 현재 Windows 사용자 또는 모든 사용자용으로 설치한 뒤 작업을 재시도해야 합니다.
- `MISSING_PDF_RENDERER`: Poppler 설치를 확인하고 `setup.ps1 -PdfToPpmPath ...`로 정확한 경로를 지정합니다.
- `INSUFFICIENT_USABLE_SLIDES`: 판독 실패 또는 picture/texture 전체 배경 제외 후 usable slide가 5개 미만입니다. 로그에서 제외된 원본 슬라이드 번호와 사유를 확인합니다.
- PowerPoint 미감지: Microsoft 365 웹 앱이 아니라 데스크톱 PowerPoint가 설치되어 있어야 합니다.
- PC가 오프라인으로 표시됨: 해당 Windows 사용자로 로그인되어 있는지, 예약 작업이 실행 중인지, 방화벽에서 HTTPS 연결이 가능한지 확인합니다.
- `Unauthorized worker`: 서버의 Worker ID별 비밀키와 이 PC에 입력한 비밀키가 같은지 확인합니다.

워커 전용 Windows 사용자 계정을 쓰는 것이 가장 안전합니다. 사용자 환경변수의 비밀키는 소스나 예약 작업에 노출되지는 않지만, 같은 Windows 사용자 권한으로 실행되는 다른 프로세스에서는 읽을 수 있습니다.
