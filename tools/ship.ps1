<#
  검사하고 올리기 — 한 번에

  지금까지는 코드가 바뀔 때마다 Codex 를 불러 검사와 푸시를 시켰습니다.
  그런데 그 일은 매번 같은 명령을 같은 순서로 치는 일이라
  사람도 인공지능도 필요하지 않습니다. 부를 때마다 사용량만 줄었습니다.

  그래서 그 순서를 이 파일에 적어 둡니다.
  대표님은 한 줄만 실행하면 됩니다.

      tools\ship

  검사에서 막히면 그 자리에서 멈추고 오류를 그대로 보여 줍니다.
  그 화면만 복사해 주시면 됩니다.

  안전 규칙
  - 환경변수 값을 화면에 찍지 않습니다.
  - .env 계열은 .gitignore 에 걸려 있어 커밋에 담기지 않습니다.
  - 시스템 실행 정책은 건드리지 않습니다. 이 실행에만 우회를 씁니다.
#>
[CmdletBinding()]
param(
  # 커밋 메시지. 없으면 tools\ship-message.txt 를 읽습니다.
  [string]$Message,
  # 검사를 건너뜁니다. 급할 때만 쓰세요.
  [switch]$SkipVerify,
  # 커밋만 하고 올리지 않습니다.
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$root = & git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $root) { throw "여기는 git 저장소가 아닙니다." }
Set-Location -LiteralPath $root

Write-Host ""
Write-Host "== 바뀐 파일 ==" -ForegroundColor Cyan
& git status --short
if (-not (& git status --porcelain)) {
  Write-Host "바뀐 것이 없습니다. 올릴 것도 없습니다." -ForegroundColor Yellow
  exit 0
}

if (-not $Message) {
  $messagePath = Join-Path $root "tools\ship-message.txt"
  if (Test-Path -LiteralPath $messagePath) {
    $Message = (Get-Content -LiteralPath $messagePath -Raw -Encoding UTF8).Trim()
  }
}
if (-not $Message) {
  throw "커밋 메시지가 없습니다. -Message ""내용"" 으로 주시거나 tools\ship-message.txt 에 적어 주세요."
}

Write-Host ""
Write-Host "커밋 메시지: $($Message.Split("`n")[0])" -ForegroundColor Cyan

if (-not $SkipVerify) {
  Write-Host ""
  Write-Host "== 검사 (타입 · 문법 · 테스트) ==" -ForegroundColor Cyan
  Write-Host "몇 분 걸립니다." -ForegroundColor DarkGray
  & npm.cmd run verify
  if ($LASTEXITCODE -ne 0) {
    throw "검사에서 막혔습니다. 올리지 않았습니다. 위 오류를 그대로 대화창에 붙여넣어 주세요."
  }
  Write-Host "검사 통과" -ForegroundColor Green
}

Write-Host ""
Write-Host "== 커밋 ==" -ForegroundColor Cyan
& git add -A
if ($LASTEXITCODE -ne 0) { throw "파일을 담지 못했습니다." }
& git commit -m $Message
if ($LASTEXITCODE -ne 0) { throw "커밋하지 못했습니다." }

if ($NoPush) {
  Write-Host ""
  Write-Host "커밋까지만 했습니다: $(& git log --oneline -1)" -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "== 올리기 ==" -ForegroundColor Cyan
& git push origin HEAD
if ($LASTEXITCODE -ne 0) { throw "올리지 못했습니다. 위 오류를 그대로 대화창에 붙여넣어 주세요." }

Write-Host ""
Write-Host "완료: $(& git log --oneline -1)" -ForegroundColor Green
Write-Host "Vercel 배포는 1~2분 걸립니다." -ForegroundColor DarkGray
