param(
  [switch]$Once,
  [switch]$Check,
  [switch]$HeartbeatOnly,
  [switch]$LibraryOnly
)

$ErrorActionPreference = "Stop"
$WorkerVersion = "2.8.0"

function Get-WorkerSetting {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$DefaultValue = ""
  )

  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return $processValue.Trim()
  }
  $userValue = [Environment]::GetEnvironmentVariable($Name, "User")
  if (-not [string]::IsNullOrWhiteSpace($userValue)) {
    return $userValue.Trim()
  }
  return $DefaultValue
}

$ConfiguredServerUrl = Get-WorkerSetting -Name "WOOLIM_WORKER_SERVER_URL"
$ServerUrl = if ($ConfiguredServerUrl) {
  $ConfiguredServerUrl.TrimEnd("/")
} else {
  "https://woolim-site.vercel.app"
}
$WorkerSecret = Get-WorkerSetting -Name "WOOLIM_PC_WORKER_SECRET"
$WorkerId = Get-WorkerSetting -Name "WOOLIM_WORKER_ID" -DefaultValue "becky-office-pc"
$WorkerName = Get-WorkerSetting -Name "WOOLIM_WORKER_NAME" -DefaultValue "울림 집 PC (기존)"
$ConfiguredPdfRenderer = Get-WorkerSetting -Name "WOOLIM_PDFTOPPM_PATH"

# '작은 글씨'로 볼 최대 글자 크기 (pt).
#
# 예전 기준은 18pt 였습니다. 한국어 제안서 본문은 대부분 11~16pt 라서
# 본문 전체가 작은 글씨로 분류됐고, 장표 하나에서 가림 영역이 수십 개씩 나왔습니다.
# 각주와 출처 표기만 잡도록 11pt 로 낮춥니다.
# 환경변수 WOOLIM_SMALL_TEXT_MAX_PT 로 조정할 수 있습니다.
# 장표에서 읽은 공개용 큰 제목을 모읍니다.
# 이 글자가 없으면 서버가 문서 주제를 몰라 일반론만 쓴 글이 나옵니다.
# 식별자로 분류된 줄은 절대 담지 않습니다.
$script:CurrentSlidePublicTitles = New-Object System.Collections.Generic.List[string]
# 지금 검사 중인 장표의 원본 번호. 표지(1장)만 다르게 다루기 위해 씁니다.
$script:CurrentSourceSlideNumber = 0
$PublicTitleMaxPerSlide = 6
$PublicTitleMaxLength = 120

$SmallTextMaxPt = 11.0
$ConfiguredSmallTextMaxPt = Get-WorkerSetting -Name "WOOLIM_SMALL_TEXT_MAX_PT"
if ($ConfiguredSmallTextMaxPt) {
  $parsedSmallTextMaxPt = 0.0
  if ([double]::TryParse($ConfiguredSmallTextMaxPt, [ref]$parsedSmallTextMaxPt) `
    -and $parsedSmallTextMaxPt -gt 0 -and $parsedSmallTextMaxPt -le 72) {
    $SmallTextMaxPt = $parsedSmallTextMaxPt
  }
}
$WorkerRoot = Join-Path $env:LOCALAPPDATA "WoolimWorker"
$JobsRoot = Join-Path $WorkerRoot "jobs"
$LogPath = Join-Path $WorkerRoot "worker.log"

New-Item -ItemType Directory -Force -Path $WorkerRoot | Out-Null
New-Item -ItemType Directory -Force -Path $JobsRoot | Out-Null

function Write-WorkerLog {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$WorkerId] $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function New-WorkerHeaders {
  $headers = @{
    Authorization = "Bearer $WorkerSecret"
    "X-Woolim-Worker-Id" = $WorkerId
  }
  # Windows PowerShell 5 can reject non-ASCII HTTP header values. The full
  # Unicode display name is always present in the JSON body.
  if ($WorkerName -cmatch '^[\x20-\x7E]+$') {
    $headers["X-Woolim-Worker-Name"] = $WorkerName
  }
  return $headers
}

function Invoke-WorkerApi {
  param(
    [string]$Path,
    [hashtable]$Body
  )

  $payload = @{}
  if ($Body) {
    foreach ($key in $Body.Keys) {
      $payload[$key] = $Body[$key]
    }
  }
  # The headers are authoritative on multi-worker servers. Body fields let a
  # rolling deployment continue to identify the worker on older route shapes.
  $payload.workerId = $WorkerId
  $payload.workerName = $WorkerName

  Invoke-RestMethod `
    -Uri "$ServerUrl$Path" `
    -Method Post `
    -Headers (New-WorkerHeaders) `
    -ContentType "application/json; charset=utf-8" `
    -Body ($payload | ConvertTo-Json -Depth 10 -Compress)
}

function Get-FontInventoryFingerprint {
  $fontNames = New-Object System.Collections.Generic.List[string]
  foreach ($registryPath in @(
    "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
    "Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
  )) {
    if (-not (Test-Path -LiteralPath $registryPath)) { continue }
    $properties = Get-ItemProperty -LiteralPath $registryPath -ErrorAction SilentlyContinue
    if (-not $properties) { continue }
    foreach ($property in $properties.PSObject.Properties) {
      if ($property.Name.StartsWith("PS")) { continue }
      $fontNames.Add("$($property.Name)=$($property.Value)".ToLowerInvariant())
    }
  }
  $inventory = (($fontNames | Sort-Object -Unique) -join "`n")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($inventory)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

$FontInventoryFingerprint = Get-FontInventoryFingerprint

function Send-Heartbeat {
  param(
    [string]$Status = "online",
    [string]$CurrentJobId = $null,
    [string]$Message = $null,
    [string]$PowerPointVersion = $null
  )
  $script:FontInventoryFingerprint = Get-FontInventoryFingerprint
  $payload = @{
    status = $Status
    currentJobId = $CurrentJobId
    error = $Message
    computerName = $env:COMPUTERNAME
    powerPointVersion = $PowerPointVersion
    workerVersion = $WorkerVersion
    workerId = $WorkerId
    workerName = $WorkerName
    fontInventoryFingerprint = $script:FontInventoryFingerprint
  }
  Invoke-WorkerApi -Path "/api/worker/heartbeat" -Body $payload | Out-Null
}

function Start-JobHeartbeat {
  param(
    [Parameter(Mandatory = $true)][string]$JobId,
    [string]$PowerPointVersion = $null
  )

  $heartbeatScript = {
    param(
      [string]$HeartbeatServerUrl,
      [string]$HeartbeatSecret,
      [string]$HeartbeatWorkerId,
      [string]$HeartbeatWorkerName,
      [string]$HeartbeatJobId,
      [string]$HeartbeatComputerName,
      [string]$HeartbeatWorkerVersion,
      [string]$HeartbeatPowerPointVersion,
      [string]$HeartbeatFontInventoryFingerprint
    )

    while ($true) {
      Start-Sleep -Seconds 45
      try {
        $payload = @{
          status = "busy"
          currentJobId = $HeartbeatJobId
          error = $null
          computerName = $HeartbeatComputerName
          powerPointVersion = $HeartbeatPowerPointVersion
          workerVersion = $HeartbeatWorkerVersion
          workerId = $HeartbeatWorkerId
          workerName = $HeartbeatWorkerName
          fontInventoryFingerprint = $HeartbeatFontInventoryFingerprint
        }
        $headers = @{
          Authorization = "Bearer $HeartbeatSecret"
          "X-Woolim-Worker-Id" = $HeartbeatWorkerId
        }
        if ($HeartbeatWorkerName -cmatch '^[\x20-\x7E]+$') {
          $headers["X-Woolim-Worker-Name"] = $HeartbeatWorkerName
        }
        Invoke-RestMethod `
          -Uri "$HeartbeatServerUrl/api/worker/heartbeat" `
          -Method Post `
          -Headers $headers `
          -ContentType "application/json; charset=utf-8" `
          -Body ($payload | ConvertTo-Json -Depth 5 -Compress) | Out-Null
      } catch {
        # The main loop owns error reporting. A transient heartbeat error must
        # never interrupt an in-progress PowerPoint or PDF conversion.
      }
    }
  }

  return Start-Job `
    -ScriptBlock $heartbeatScript `
    -ArgumentList @(
      $ServerUrl,
      $WorkerSecret,
      $WorkerId,
      $WorkerName,
      $JobId,
      $env:COMPUTERNAME,
      $WorkerVersion,
      $PowerPointVersion,
      $FontInventoryFingerprint
    )
}

function Stop-JobHeartbeat {
  param([System.Management.Automation.Job]$HeartbeatJob)

  if (-not $HeartbeatJob) { return }
  try { Stop-Job -Job $HeartbeatJob -ErrorAction SilentlyContinue } catch {}
  try { Remove-Job -Job $HeartbeatJob -Force -ErrorAction SilentlyContinue } catch {}
}

function Remove-LocalJobDirectory {
  param([Parameter(Mandatory = $true)][string]$JobId)

  $parsedJobId = [Guid]::Empty
  if (-not [Guid]::TryParse($JobId, [ref]$parsedJobId)) {
    throw "INVALID_JOB_ID: The server returned an invalid job identifier."
  }
  $jobPath = Join-Path $JobsRoot $parsedJobId.ToString()
  $jobsRootFull = [System.IO.Path]::GetFullPath($JobsRoot).TrimEnd("\") + "\"
  $jobPathFull = [System.IO.Path]::GetFullPath($jobPath)
  if (-not $jobPathFull.StartsWith($jobsRootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "INVALID_JOB_PATH: Refusing to remove a path outside the worker job directory."
  }
  if (Test-Path -LiteralPath $jobPathFull) {
    Remove-Item -LiteralPath $jobPathFull -Recurse -Force -ErrorAction Stop
    Write-WorkerLog "Removed local files for job $JobId."
  }
}

function Remove-StaleJobDirectories {
  param([int]$OlderThanHours = 24)

  $cutoff = (Get-Date).AddHours(-1 * [Math]::Max(1, $OlderThanHours))
  foreach ($directory in (Get-ChildItem -LiteralPath $JobsRoot -Directory -ErrorAction SilentlyContinue)) {
    if ($directory.LastWriteTime -ge $cutoff) { continue }
    try {
      Remove-LocalJobDirectory -JobId $directory.Name
    } catch {
      Write-WorkerLog "Could not remove stale job directory $($directory.Name): $($_.Exception.Message)"
    }
  }
}

function Upload-SignedFile {
  param(
    [string]$SignedUrl,
    [string]$FilePath,
    [string]$ContentType,
    [string]$Authorization
  )
  $apiKey = $Authorization -replace "^Bearer\s+", ""
  Invoke-WebRequest `
    -Uri $SignedUrl `
    -Method Put `
    -Headers @{
      "Authorization" = $Authorization
      "apikey" = $apiKey
      "x-upsert" = "true"
      "cache-control" = "max-age=3600"
    } `
    -ContentType $ContentType `
    -InFile $FilePath `
    -UseBasicParsing | Out-Null
}

function Get-SourceFile {
  param(
    [string]$SourceUrl,
    [string]$SourcePath,
    [string]$AuthorizationHeader
  )
  if (Test-Path -LiteralPath $SourcePath) {
    try {
      if ((Get-Item -LiteralPath $SourcePath).Length -lt 1024) {
        throw "Cached source file is unexpectedly small."
      }
      $cachedExtension = [System.IO.Path]::GetExtension($SourcePath).ToLowerInvariant()
      if ($cachedExtension -in @(".pptx", ".pptm")) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $cachedArchive = [System.IO.Compression.ZipFile]::OpenRead($SourcePath)
        try {
          if ($cachedArchive.Entries.Count -eq 0) {
            throw "Cached presentation archive is empty."
          }
        } finally {
          $cachedArchive.Dispose()
        }
      }
      Unblock-File -LiteralPath $SourcePath
      Write-WorkerLog "Using verified cached source file."
      return
    } catch {
      Write-WorkerLog "Cached source file is invalid and will be downloaded again."
    }
  }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Write-WorkerLog "Downloading source file (attempt $attempt/3)."
      if (Test-Path -LiteralPath $SourcePath) {
        Remove-Item -LiteralPath $SourcePath -Force
      }
      $curlArguments = @(
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry", "2",
        "--retry-delay", "2",
        "--connect-timeout", "30",
        "--max-time", "600",
        "--output", $SourcePath
      )
      if ($AuthorizationHeader) {
        $curlArguments += @("--header", $AuthorizationHeader)
      }
      $curlArguments += $SourceUrl
      & curl.exe @curlArguments
      if ($LASTEXITCODE -ne 0) {
        throw "curl exited with code $LASTEXITCODE."
      }
      if ((Get-Item -LiteralPath $SourcePath).Length -lt 1024) {
        throw "Downloaded source file is unexpectedly small."
      }

      $extension = [System.IO.Path]::GetExtension($SourcePath).ToLowerInvariant()
      if ($extension -in @(".pptx", ".pptm")) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [System.IO.Compression.ZipFile]::OpenRead($SourcePath)
        try {
          if ($archive.Entries.Count -eq 0) {
            throw "Downloaded presentation archive is empty."
          }
        } finally {
          $archive.Dispose()
        }
      }
      Unblock-File -LiteralPath $SourcePath
      Write-WorkerLog "Source download verified."
      return
    } catch {
      Write-WorkerLog "Source download attempt $attempt failed: $($_.Exception.Message)"
      if ($attempt -eq 3) {
        throw
      }
      Start-Sleep -Seconds (2 * $attempt)
    }
  }
}

function Test-PdfRendererCandidate {
  param([string]$Path)

  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "SilentlyContinue"
    & $Path -v *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Find-PdfRenderer {
  if ($ConfiguredPdfRenderer) {
    $configuredPath = $ConfiguredPdfRenderer
    if (Test-Path -LiteralPath $configuredPath -PathType Container) {
      $configuredPath = Join-Path $configuredPath "pdftoppm.exe"
    }
    if (Test-PdfRendererCandidate -Path $configuredPath) {
      return (Resolve-Path -LiteralPath $configuredPath).Path
    }
    throw "MISSING_PDF_RENDERER: WOOLIM_PDFTOPPM_PATH does not point to a working pdftoppm executable."
  }

  foreach ($commandName in @("pdftoppm.exe", "pdftoppm")) {
    $command = Get-Command $commandName -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($command -and $command.Source -and (Test-PdfRendererCandidate -Path $command.Source)) {
      return $command.Source
    }
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  $candidates.Add((Join-Path $WorkerRoot "bin\pdftoppm.exe"))
  if ($env:USERPROFILE) {
    $candidates.Add((Join-Path $env:USERPROFILE "scoop\apps\poppler\current\Library\bin\pdftoppm.exe"))
    $candidates.Add((Join-Path $env:USERPROFILE "scoop\apps\poppler\current\bin\pdftoppm.exe"))
    $candidates.Add((Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe"))
  }
  if ($env:ProgramData) {
    $candidates.Add((Join-Path $env:ProgramData "chocolatey\bin\pdftoppm.exe"))
  }
  if ($env:ProgramFiles) {
    $candidates.Add((Join-Path $env:ProgramFiles "poppler\Library\bin\pdftoppm.exe"))
    $candidates.Add((Join-Path $env:ProgramFiles "poppler\bin\pdftoppm.exe"))
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "poppler\Library\bin\pdftoppm.exe"))
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "poppler\bin\pdftoppm.exe"))
  }
  foreach ($candidate in $candidates) {
    if (Test-PdfRendererCandidate -Path $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $searchRoots = New-Object System.Collections.Generic.List[string]
  if ($env:LOCALAPPDATA) {
    $searchRoots.Add((Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"))
  }
  if ($env:USERPROFILE) {
    $searchRoots.Add((Join-Path $env:USERPROFILE ".cache\codex-runtimes"))
  }
  foreach ($searchRoot in $searchRoots) {
    if (-not (Test-Path -LiteralPath $searchRoot -PathType Container)) { continue }
    foreach ($fileName in @("pdftoppm.exe")) {
      $discovered = Get-ChildItem `
        -LiteralPath $searchRoot `
        -Filter $fileName `
        -File `
        -Recurse `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($discovered -and (Test-PdfRendererCandidate -Path $discovered.FullName)) {
        return $discovered.FullName
      }
    }
  }

  throw "MISSING_PDF_RENDERER: pdftoppm.exe를 찾을 수 없습니다. Poppler를 설치하거나 WOOLIM_PDFTOPPM_PATH를 설정하세요."
}

function Test-SupportedPageRatio {
  param([double]$AspectRatio)

  # Parenthesize each quotient. In Windows PowerShell 5.1, an ungrouped
  # comma-separated expression can bind as an Object[] operand to `/`.
  $targets = @(
    (16.0 / 9.0),
    (4.0 / 3.0),
    (297.0 / 210.0),
    (210.0 / 297.0)
  )
  foreach ($target in $targets) {
    if ([Math]::Abs($AspectRatio - $target) / $target -le 0.025) {
      return $true
    }
  }
  return $false
}

function Assert-SupportedPageImage {
  param([string]$ImagePath)

  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($ImagePath)
  try {
    $aspectRatio = [double]$image.Width / [double]$image.Height
    if (-not (Test-SupportedPageRatio -AspectRatio $aspectRatio)) {
      throw "NON_PRESENTATION_LAYOUT: Page ratio $([Math]::Round($aspectRatio, 3)) is not 16:9, 4:3, A4 landscape, or A4 portrait."
    }
  } finally {
    $image.Dispose()
  }
}

function Get-RepresentativeIndexes {
  param(
    [int]$Count,
    [int]$Maximum = 100
  )

  if ($Count -le $Maximum) {
    return @(0..($Count - 1))
  }
  $indexes = New-Object 'System.Collections.Generic.HashSet[int]'
  for ($position = 0; $position -lt $Maximum; $position++) {
    $index = [int][Math]::Round($position * ($Count - 1) / ($Maximum - 1))
    [void]$indexes.Add($index)
  }
  return @($indexes | Sort-Object)
}

function Assert-ShapeGeometryWithinSlide {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight
  )

  try {
    $rawLeft = $Shape.Left
    $rawTop = $Shape.Top
    $rawWidth = $Shape.Width
    $rawHeight = $Shape.Height
    if ($null -eq $rawLeft -or $null -eq $rawTop -or $null -eq $rawWidth -or $null -eq $rawHeight) {
      throw "PowerPoint returned incomplete shape geometry."
    }
    $left = [double]$rawLeft
    $top = [double]$rawTop
    $width = [double]$rawWidth
    $height = [double]$rawHeight
    if ([double]::IsNaN($left) -or [double]::IsInfinity($left) -or
        [double]::IsNaN($top) -or [double]::IsInfinity($top) -or
        [double]::IsNaN($width) -or [double]::IsInfinity($width) -or
        [double]::IsNaN($height) -or [double]::IsInfinity($height)) {
      throw "PowerPoint returned non-finite shape geometry."
    }
    if ($width -lt 0 -or $height -lt 0) {
      throw "PowerPoint returned a negative shape boundary."
    }
    # Straight connectors legitimately report zero width or height, and some
    # grouped templates retain text boxes wholly outside the slide canvas.
    # Neither occupies a redaction-sized visible pixel region. Partially
    # visible shapes remain inspectable because region creation clips them to
    # the slide boundary.
    if ($width -eq 0 -or $height -eq 0) { return $false }
    $right = $left + $width
    $bottom = $top + $height
    if ($right -le 0 -or $bottom -le 0 -or $left -ge $SlideWidth -or $top -ge $SlideHeight) {
      return $false
    }
    return $true
  } catch {
    throw "SHAPE_GEOMETRY_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function New-LocalRedactionRegion {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight,
    [Parameter(Mandatory = $true)][string]$Type,
    [Parameter(Mandatory = $true)][string]$Label
  )

  try {
    $rawLeft = $Shape.Left
    $rawTop = $Shape.Top
    $rawWidth = $Shape.Width
    $rawHeight = $Shape.Height
    if ($null -eq $rawLeft -or $null -eq $rawTop -or $null -eq $rawWidth -or $null -eq $rawHeight) {
      throw "PowerPoint returned an empty shape boundary."
    }
    return New-LocalRedactionRegionFromBounds `
      -Left ([double]$rawLeft) `
      -Top ([double]$rawTop) `
      -Width ([double]$rawWidth) `
      -Height ([double]$rawHeight) `
      -SlideIndex $SlideIndex `
      -SlideWidth $SlideWidth `
      -SlideHeight $SlideHeight `
      -Type $Type `
      -Label $Label
  } catch {
    # A partial manifest is unsafe when a sensitive shape cannot be mapped to
    # pixels. The caller excludes this slide instead of blurring the full page.
    throw "SHAPE_GEOMETRY_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function New-LocalRedactionRegionFromBounds {
  param(
    [Parameter(Mandatory = $true)][double]$Left,
    [Parameter(Mandatory = $true)][double]$Top,
    [Parameter(Mandatory = $true)][double]$Width,
    [Parameter(Mandatory = $true)][double]$Height,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight,
    [Parameter(Mandatory = $true)][string]$Type,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ([double]::IsNaN($Left) -or [double]::IsInfinity($Left) -or
      [double]::IsNaN($Top) -or [double]::IsInfinity($Top) -or
      [double]::IsNaN($Width) -or [double]::IsInfinity($Width) -or
      [double]::IsNaN($Height) -or [double]::IsInfinity($Height) -or
      $Width -le 0 -or $Height -le 0) {
    throw "PowerPoint returned invalid redaction bounds."
  }

  # TextRange2 bounds already fit the rendered glyph line. Keep padding tight
  # so a small confidential label does not wash out its entire card or diagram.
  $paddingX = [Math]::Max(0.9, $SlideWidth * 0.0015)
  $paddingY = [Math]::Max(0.7, $SlideHeight * 0.0015)
  $clippedLeft = [Math]::Max(0.0, $Left - $paddingX)
  $clippedTop = [Math]::Max(0.0, $Top - $paddingY)
  $right = [Math]::Min($SlideWidth, $Left + $Width + $paddingX)
  $bottom = [Math]::Min($SlideHeight, $Top + $Height + $paddingY)
  if ($right -le $clippedLeft -or $bottom -le $clippedTop) { return $null }

  return [PSCustomObject]@{
    slideIndex = $SlideIndex
    type = $Type
    label = $Label
    x = [double]($clippedLeft / $SlideWidth)
    y = [double]($clippedTop / $SlideHeight)
    width = [double](($right - $clippedLeft) / $SlideWidth)
    height = [double](($bottom - $clippedTop) / $SlideHeight)
  }
}

function Test-ShapeHasText {
  param([Parameter(Mandatory = $true)]$Shape)

  try {
    $hasTextFrame = $Shape.HasTextFrame
    if ($null -eq $hasTextFrame) {
      throw "PowerPoint returned no HasTextFrame value."
    }
    if ([int]$hasTextFrame -eq 0) { return $false }
    $textFrame = $Shape.TextFrame
    if ($null -eq $textFrame) {
      throw "PowerPoint returned no TextFrame object."
    }
    $hasText = $textFrame.HasText
    if ($null -eq $hasText) {
      throw "PowerPoint returned no HasText value."
    }
    return [int]$hasText -ne 0
  } catch {
    # `false` means that PowerPoint positively reported no text. A COM read
    # failure is different: treating it as no text could expose a text box,
    # placeholder, or autoshape. Propagate uncertainty so the caller excludes
    # this slide instead of guessing.
    throw "SHAPE_TEXT_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function Get-SensitiveSourceTokens {
  param([Parameter(Mandatory = $true)][string]$FileName)

  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
  if ([string]::IsNullOrWhiteSpace($baseName)) { return @() }
  $generalTerms = @(
    "최종", "최종본", "완료", "완료본", "제안서", "발표본", "발표자료",
    "연구개발", "보고서", "결과보고서", "수정", "수정본", "초안", "사본",
    "공유용", "외부공유", "포트폴리오", "회사소개", "회사소개서", "소개서",
    "기획서", "계획서", "템플릿", "디자인", "자료", "ppt", "pptx", "pptm",
    "presentation", "proposal", "final", "draft", "copy", "template", "version"
  )
  $affixPattern = ($generalTerms | Sort-Object Length -Descending | ForEach-Object { [regex]::Escape($_) }) -join '|'
  $tokens = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($rawToken in @($baseName -split '[^\p{L}\p{N}]+')) {
    $candidate = ([string]$rawToken).Trim()
    if (-not $candidate) { continue }
    do {
      $previous = $candidate
      $candidate = ($candidate -replace "(?i)^(?:$affixPattern)", "")
      $candidate = ($candidate -replace "(?i)(?:$affixPattern)$", "")
    } while ($candidate -and $candidate -ne $previous)
    if ($candidate.Length -lt 2) { continue }
    if ($candidate -match '^\d+$' -or $candidate -match '(?i)^v(?:er(?:sion)?)?\d+$') { continue }
    if ($generalTerms -contains $candidate) { continue }
    [void]$tokens.Add($candidate)
  }
  return @($tokens)
}

function Test-TextContainsSensitiveSourceToken {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [string[]]$SensitiveSourceTokens = @()
  )

  $canonicalText = ([regex]::Replace(
    $Text.Normalize([System.Text.NormalizationForm]::FormKC),
    '[^\p{L}\p{N}]',
    ''
  )).ToLowerInvariant()
  foreach ($token in $SensitiveSourceTokens) {
    if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 2) { continue }
    $canonicalToken = ([regex]::Replace(
      $token.Normalize([System.Text.NormalizationForm]::FormKC),
      '[^\p{L}\p{N}]',
      ''
    )).ToLowerInvariant()
    if ($canonicalToken.Length -lt 2) { continue }

    if ($canonicalToken -match '^[a-z0-9]+$') {
      # English abbreviations such as CJ or HPC may contain visual separators
      # in a title. Permit those separators between characters, while keeping
      # ASCII word boundaries so a short token never matches inside a longer
      # English word (for example, AI inside DETAIL).
      $characterPattern = (($canonicalToken.ToCharArray() | ForEach-Object {
        [regex]::Escape([string]$_)
      }) -join '[^\p{L}\p{N}]*')
      $pattern = "(?i)(?<![A-Za-z0-9])$characterPattern(?![A-Za-z0-9])"
      if ([regex]::IsMatch($Text, $pattern)) { return $true }
      continue
    }

    # Korean and mixed Korean/English client names are commonly written with
    # inconsistent spaces or punctuation. Compare only their canonical local
    # letter/number forms. Neither the source token nor this text leaves the PC.
    if ($canonicalText.Contains($canonicalToken)) { return $true }
  }
  return $false
}

function Test-TextContainsIdentifierSignal {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [string]$ShapeName = "",
    [string[]]$SensitiveSourceTokens = @()
  )

  $identifierSignal = '(?i)(@|https?://|www\.|\b(?:client|customer|company\s*name|project\s*(?:name|id|code|no\.?|number)|corporation|corp\.?|inc\.?|ltd\.?)\b|고객사|발주처|수행사|제안사|프로젝트\s*명|과제\s*명|사업\s*명|주식회사|\(주\)|㈜|기관\s*명|회사\s*명|업체\s*명|담당자|연락처|연락\s*처|전화|휴대폰|팩스|주소|대표자|사업자\s*등록|(?:경기도|강원(?:특별자치)?도|충청(?:남|북)도|전라(?:남|북)도|경상(?:남|북)도|제주특별자치도)|[가-힣]{2,12}(?:특별자치도|특별자치시|광역시|특별시|도청|시청|군청|구청))'
  $numberSignal = '(?i)(\b\d{2,3}[- .)]?\d{3,4}[- .]?\d{4}\b|\b\d{3}[- ]?\d{2}[- ]?\d{5}\b)'
  if ($ShapeName -match '(?i)(logo|client\s*name|customer\s*name|company\s*name|project\s*(?:name|id|code)|identifier|footer|contact|로고|고객사|회사\s*명|기관\s*명|과제\s*명|연락처)') {
    return $true
  }
  if ($Text -match $identifierSignal -or $Text -match $numberSignal) { return $true }
  return Test-TextContainsSensitiveSourceToken `
    -Text $Text `
    -SensitiveSourceTokens $SensitiveSourceTokens
}

function Get-ShapeTextClassification {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [string[]]$SensitiveSourceTokens = @()
  )

  if (-not (Test-ShapeHasText -Shape $Shape)) { return "none" }
  try {
    # Text is inspected only inside this process. It is never logged or placed
    # in the manifest sent to the server.
    $rawText = $Shape.TextFrame.TextRange.Text
    if ($null -eq $rawText) {
      throw "PowerPoint returned no text value for a shape that reports text."
    }
    $text = ([string]$rawText).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return "none" }
    $shapeName = ""
    try {
      $rawShapeName = $Shape.Name
      if ($null -eq $rawShapeName) {
        throw "PowerPoint returned no shape name."
      }
      $shapeName = [string]$rawShapeName
    } catch {
      throw "SHAPE_NAME_INSPECTION_FAILED: $($_.Exception.Message)"
    }
    $containsIdentifier = Test-TextContainsIdentifierSignal `
      -Text $text `
      -ShapeName $shapeName `
      -SensitiveSourceTokens $SensitiveSourceTokens
    if ($containsIdentifier) {
      return "identifier"
    }

    $placeholderType = 0
    try {
      if ([int]$Shape.Type -eq 14) {
        $rawPlaceholderType = $Shape.PlaceholderFormat.Type
        if ($null -eq $rawPlaceholderType) {
          throw "PowerPoint returned no placeholder type."
        }
        $placeholderType = [int]$rawPlaceholderType
      }
    } catch {
      throw "SHAPE_PLACEHOLDER_INSPECTION_FAILED: $($_.Exception.Message)"
    }
    if ($placeholderType -in @(13, 14, 15, 16)) { return "footer" }

    $fontSize = -1.0
    try {
      $rawFontSize = $Shape.TextFrame.TextRange.Font.Size
      if ($null -eq $rawFontSize) {
        throw "PowerPoint returned no font size."
      }
      $fontSize = [double]$rawFontSize
    } catch {
      throw "SHAPE_FONT_INSPECTION_FAILED: $($_.Exception.Message)"
    }
    $isTitlePlaceholder = $placeholderType -in @(1, 3, 5)
    $largeEnough = ($isTitlePlaceholder -and $fontSize -ge 22.0) -or $fontSize -ge 24.0
    if ($largeEnough) { return "public_large_title" }
    if ($fontSize -gt 0 -and $fontSize -lt $SmallTextMaxPt) { return "small_text" }
    return "body_text"
  } catch {
    # A text run that cannot be classified must not be reduced to a guessed
    # shape boundary. Bubble the error so the slide is excluded.
    throw "SHAPE_TEXT_CLASSIFICATION_FAILED: $($_.Exception.Message)"
  }
}

function Get-ShapeTextRedactionRegions {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight,
    [string[]]$SensitiveSourceTokens = @(),
    [switch]$ForceIdentifier,
    [switch]$BoundsRelativeToShape
  )

  $regions = New-Object System.Collections.Generic.List[object]
  if (-not (Test-ShapeHasText -Shape $Shape)) { return $regions.ToArray() }
  try {
    $rawShapeName = $Shape.Name
    # Table cell shapes can legitimately expose no Name through COM.
    $shapeName = if ($null -eq $rawShapeName) { "" } else { [string]$rawShapeName }

    $placeholderType = 0
    if ([int]$Shape.Type -eq 14) {
      $rawPlaceholderType = $Shape.PlaceholderFormat.Type
      if ($null -eq $rawPlaceholderType) { throw "PowerPoint returned no placeholder type." }
      $placeholderType = [int]$rawPlaceholderType
    }
    $isFooter = $placeholderType -in @(13, 14, 15, 16)

    $textRange = $Shape.TextFrame2.TextRange
    if ($null -eq $textRange) { throw "PowerPoint returned no TextFrame2 range." }
    $allLines = $textRange.Lines()
    if ($null -eq $allLines) { throw "PowerPoint returned no text line collection." }
    $lineCount = [int]$allLines.Count
    if ($lineCount -lt 1 -or $lineCount -gt 400) {
      throw "PowerPoint returned an invalid text line count."
    }

    $fullText = ([string]$textRange.Text).Trim()
    for ($lineIndex = 1; $lineIndex -le $lineCount; $lineIndex++) {
      $line = $null
      try {
        $line = $textRange.Lines($lineIndex, 1)
        if ($null -eq $line) { throw "PowerPoint returned no text line at index $lineIndex." }
        $lineText = ([string]$line.Text).Trim()
        if ([string]::IsNullOrWhiteSpace($lineText)) { continue }

        $rawFontSize = $line.Font.Size
        if ($null -eq $rawFontSize) { throw "PowerPoint returned no line font size." }
        $fontSize = [double]$rawFontSize
        if ($fontSize -le 0) {
          # Mixed formatting reports -2. Use the rendered line height only to
          # avoid guessing that a mixed confidential line is a public heading.
          $fontSize = 0
        }

        $containsIdentifier = $ForceIdentifier.IsPresent -or (Test-TextContainsIdentifierSignal `
          -Text $lineText `
          -ShapeName $shapeName `
          -SensitiveSourceTokens $SensitiveSourceTokens)
        $looksLikeShortHeading = (
          $fontSize -ge 16.0 -and
          $fullText.Length -le 96 -and
          $lineCount -le 3 -and
          $lineText.Length -le 52 -and
          $lineText -notmatch '[.!?。？！]\s*$'
        )
        $isPublicHeading = -not $containsIdentifier -and (
          $fontSize -ge 18.0 -or
          $looksLikeShortHeading -or
          (($placeholderType -in @(1, 3, 5)) -and $fontSize -ge 16.0)
        )
        if ($isPublicHeading) {
          # 식별자가 없는 큰 제목만 담습니다. 문서 주제를 알려 주는 문장입니다.
          if (-not $containsIdentifier `
            -and $script:CurrentSlidePublicTitles.Count -lt $PublicTitleMaxPerSlide `
            -and $lineText.Length -le $PublicTitleMaxLength `
            -and $lineText.Length -ge 2) {
            if (-not $script:CurrentSlidePublicTitles.Contains($lineText)) {
              $script:CurrentSlidePublicTitles.Add($lineText)
            }
          }
          continue
        }

        $regionType = if ($containsIdentifier) {
          "client_identifier"
        } elseif ($isFooter) {
          "footer"
        } elseif ($fontSize -gt 0 -and $fontSize -lt $SmallTextMaxPt) {
          "small_text"
        } else {
          "body_text"
        }
        $regionLabel = switch ($regionType) {
          "client_identifier" { "local_identifier" }
          "footer" { "local_footer" }
          "small_text" { "local_small_text" }
          default { "local_body_text" }
        }

        $rawLeft = $line.BoundLeft
        $rawTop = $line.BoundTop
        $rawWidth = $line.BoundWidth
        $rawHeight = $line.BoundHeight
        if ($null -eq $rawLeft -or $null -eq $rawTop -or $null -eq $rawWidth -or $null -eq $rawHeight) {
          throw "PowerPoint returned incomplete text line bounds."
        }
        $redactionLeft = [double]$rawLeft
        $redactionTop = [double]$rawTop
        if ($BoundsRelativeToShape.IsPresent) {
          # TextRange2 bounds for table-cell shapes use the cell as their
          # horizontal origin and the cell's vertical center as their vertical
          # origin. Convert them back to slide coordinates before masking.
          $redactionLeft = [double]$Shape.Left + $redactionLeft
          $redactionTop = [double]$Shape.Top + ([double]$Shape.Height / 2.0) + $redactionTop
        }
        $region = New-LocalRedactionRegionFromBounds `
          -Left $redactionLeft `
          -Top $redactionTop `
          -Width ([double]$rawWidth) `
          -Height ([double]$rawHeight) `
          -SlideIndex $SlideIndex `
          -SlideWidth $SlideWidth `
          -SlideHeight $SlideHeight `
          -Type $regionType `
          -Label $regionLabel
        if (-not $region) {
          # Some PowerPoint files report rendered TextRange2 bounds outside the
          # owning shape even though the shape geometry itself is valid. Fall
          # back to that one text box, never to the slide, so confidential text
          # stays hidden without discarding an otherwise usable design page.
          if (Test-ShapeCoversSlide -Shape $Shape -SlideWidth $SlideWidth -SlideHeight $SlideHeight) {
            throw "A confidential text line could not be mapped and its text box covers the slide."
          }
          $fallbackRegion = New-LocalRedactionRegion `
            -Shape $Shape `
            -SlideIndex $SlideIndex `
            -SlideWidth $SlideWidth `
            -SlideHeight $SlideHeight `
            -Type $regionType `
            -Label $regionLabel
          if (-not $fallbackRegion) {
            throw "A confidential text line and its text box could not be mapped to visible pixels."
          }
          $regions.Clear()
          $regions.Add($fallbackRegion)
          return $regions.ToArray()
        }
        $regions.Add($region)
      } finally {
        if ($line) {
          try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($line) | Out-Null } catch {}
        }
      }
    }
    return $regions.ToArray()
  } catch {
    throw "SHAPE_TEXT_LINE_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function Get-TableRedactionRegions {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight,
    [string[]]$SensitiveSourceTokens = @(),
    [switch]$ForceIdentifier
  )

  $regions = New-Object System.Collections.Generic.List[object]
  try {
    $table = $Shape.Table
    if ($null -eq $table) { throw "PowerPoint returned no table object." }
    $rowCount = [int]$table.Rows.Count
    $columnCount = [int]$table.Columns.Count
    if ($rowCount -lt 1 -or $columnCount -lt 1 -or ($rowCount * $columnCount) -gt 5000) {
      throw "PowerPoint returned invalid table dimensions."
    }
    for ($row = 1; $row -le $rowCount; $row++) {
      for ($column = 1; $column -le $columnCount; $column++) {
        $cell = $null
        $cellShape = $null
        try {
          $cell = $table.Cell($row, $column)
          if ($null -eq $cell) { throw "PowerPoint returned no table cell at $row,$column." }
          $cellShape = $cell.Shape
          if ($null -eq $cellShape) { throw "PowerPoint returned no shape for table cell $row,$column." }
          foreach ($region in @(Get-ShapeTextRedactionRegions `
            -Shape $cellShape `
            -SlideIndex $SlideIndex `
            -SlideWidth $SlideWidth `
            -SlideHeight $SlideHeight `
            -SensitiveSourceTokens $SensitiveSourceTokens `
            -ForceIdentifier:$ForceIdentifier.IsPresent `
            -BoundsRelativeToShape)) {
            if ($region) { $regions.Add($region) }
          }
        } finally {
          if ($cellShape) {
            try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($cellShape) | Out-Null } catch {}
          }
          if ($cell) {
            try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell) | Out-Null } catch {}
          }
        }
      }
    }
    return $regions.ToArray()
  } catch {
    throw "TABLE_CELL_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function Test-ShapeHasPictureFill {
  param([Parameter(Mandatory = $true)]$Shape)

  try {
    # msoFillTextured=4 and msoFillPicture=6.
    $fill = $Shape.Fill
    if ($null -eq $fill) {
      throw "PowerPoint returned no Fill object."
    }
    $fillVisible = $fill.Visible
    if ($null -eq $fillVisible) {
      throw "PowerPoint returned no Fill.Visible value."
    }
    if ([int]$fillVisible -eq 0) { return $false }
    $fillType = $fill.Type
    if ($null -eq $fillType) {
      throw "PowerPoint returned no Fill.Type value."
    }
    return [int]$fillType -in @(4, 6)
  } catch {
    # A picture-fill read failure must not make the shape look like a safe
    # vector primitive. Let slide-level handling exclude this slide.
    throw "SHAPE_PICTURE_FILL_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function Get-ShapeTextEffectClassification {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [string[]]$SensitiveSourceTokens = @()
  )

  try {
    $textEffect = $Shape.TextEffect
    if ($null -eq $textEffect) { throw "PowerPoint returned no TextEffect object." }
    $rawText = $textEffect.Text
    if ($null -eq $rawText) { throw "PowerPoint returned no TextEffect.Text value." }
    $text = ([string]$rawText).Trim()
    $rawShapeName = $Shape.Name
    if ($null -eq $rawShapeName) { throw "PowerPoint returned no WordArt shape name." }
    if (Test-TextContainsIdentifierSignal `
      -Text $text `
      -ShapeName ([string]$rawShapeName) `
      -SensitiveSourceTokens $SensitiveSourceTokens) {
      return "identifier"
    }
    $rawFontSize = $textEffect.FontSize
    if ($null -eq $rawFontSize) { throw "PowerPoint returned no TextEffect.FontSize value." }
    if ([double]$rawFontSize -ge 24.0) { return "public_large_title" }
    return "body_text"
  } catch {
    throw "SHAPE_TEXT_EFFECT_CLASSIFICATION_FAILED: $($_.Exception.Message)"
  }
}

function Test-ShapeCoversSlide {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight
  )

  try {
    $hasVisibleGeometry = Assert-ShapeGeometryWithinSlide `
      -Shape $Shape `
      -SlideWidth $SlideWidth `
      -SlideHeight $SlideHeight
    if (-not $hasVisibleGeometry) { return $false }
    $rawLeft = $Shape.Left
    $rawTop = $Shape.Top
    $rawWidth = $Shape.Width
    $rawHeight = $Shape.Height
    if ($null -eq $rawLeft -or $null -eq $rawTop -or $null -eq $rawWidth -or $null -eq $rawHeight) {
      throw "PowerPoint returned incomplete shape geometry."
    }
    $edgeToleranceX = [Math]::Max(2.0, $SlideWidth * 0.02)
    $edgeToleranceY = [Math]::Max(2.0, $SlideHeight * 0.02)
    $left = [double]$rawLeft
    $top = [double]$rawTop
    $right = $left + [double]$rawWidth
    $bottom = $top + [double]$rawHeight
    return (
      $left -le $edgeToleranceX -and
      $top -le $edgeToleranceY -and
      $right -ge ($SlideWidth - $edgeToleranceX) -and
      $bottom -ge ($SlideHeight - $edgeToleranceY)
    )
  } catch {
    throw "SHAPE_GEOMETRY_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function Test-ShapeGeometryMatches {
  param(
    [Parameter(Mandatory = $true)]$First,
    [Parameter(Mandatory = $true)]$Second
  )

  try {
    $tolerance = 2.0
    return (
      [Math]::Abs([double]$First.Left - [double]$Second.Left) -le $tolerance -and
      [Math]::Abs([double]$First.Top - [double]$Second.Top) -le $tolerance -and
      [Math]::Abs([double]$First.Width - [double]$Second.Width) -le $tolerance -and
      [Math]::Abs([double]$First.Height - [double]$Second.Height) -le $tolerance
    )
  } catch {
    throw "SHAPE_GEOMETRY_COMPARISON_FAILED: $($_.Exception.Message)"
  }
}

function Test-CanKeepCoverFullSlidePicture {
  # 표지는 장표 전체를 덮는 배경 그림으로 만드는 경우가 대부분입니다.
  # 그런 장표를 통째로 버리면 대표 썸네일에 쓸 표지가 사라집니다.
  # 담당자 판단으로, 표지에 한해 전체 배경 그림을 가리지 않고 그대로 씁니다.
  # 되돌리려면 환경변수 WOOLIM_COVER_FULL_PICTURE 를 block 으로 두면 됩니다.
  if ($script:CurrentSourceSlideNumber -ne 1) { return $false }
  $setting = Get-WorkerSetting -Name "WOOLIM_COVER_FULL_PICTURE" -DefaultValue "keep"
  return $setting -ne "block"
}

function Test-CanKeepFullSlideTemplatePicture {
  param(
    [ValidateSet("slide", "layout", "master")][string]$Scope,
    [bool]$ShapeIdentityIsSensitive,
    [bool]$ForceIdentifier
  )

  # A full-canvas picture placed in a layout or master is a reusable template
  # background, not slide-authored customer content. Preserve it only when its
  # own identity metadata has no customer/logo signal. Full-slide pictures on
  # the slide itself remain unsupported and are never silently exposed.
  return (
    $Scope -in @("layout", "master") -and
    -not $ShapeIdentityIsSensitive -and
    -not $ForceIdentifier
  )
}

function Get-ShapeRedactionRegions {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight,
    [string[]]$SensitiveSourceTokens = @(),
    [int[]]$PublicVisualShapeIds = @(),
    [ValidateSet("slide", "layout", "master")][string]$Scope = "slide",
    [switch]$ForceIdentifier,
    [switch]$AllowDecorativePictureFill
  )

  $regions = New-Object System.Collections.Generic.List[object]
  $shapeType = -1
  try {
    $rawShapeType = $Shape.Type
    if ($null -eq $rawShapeType) {
      throw "PowerPoint returned no shape type."
    }
    $shapeType = [int]$rawShapeType
  } catch {
    throw "SHAPE_TYPE_INSPECTION_FAILED: $($_.Exception.Message)"
  }

  # Top-level slide, layout, and master collections can all retain zero-sized
  # connectors or text boxes wholly outside the canvas. They occupy no visible
  # pixel and therefore need neither classification nor a redaction region.
  $hasVisibleShapeGeometry = Assert-ShapeGeometryWithinSlide `
    -Shape $Shape `
    -SlideWidth $SlideWidth `
    -SlideHeight $SlideHeight
  if (-not $hasVisibleShapeGeometry) { return $regions.ToArray() }

  $shapeIdentity = ""
  try {
    $rawShapeName = $Shape.Name
    $rawAlternativeText = $Shape.AlternativeText
    $rawShapeTitle = $Shape.Title
    if ($null -eq $rawShapeName -or $null -eq $rawAlternativeText -or $null -eq $rawShapeTitle) {
      throw "PowerPoint returned incomplete shape identity metadata."
    }
    $shapeIdentity += " " + [string]$rawShapeName
    $shapeIdentity += " " + [string]$rawAlternativeText
    $shapeIdentity += " " + [string]$rawShapeTitle
  } catch {
    throw "SHAPE_IDENTITY_INSPECTION_FAILED: $($_.Exception.Message)"
  }
  $shapeIdentityIsSensitive = Test-TextContainsIdentifierSignal `
    -Text $shapeIdentity `
    -ShapeName $shapeIdentity `
    -SensitiveSourceTokens $SensitiveSourceTokens
  $shapeId = -1
  try { $shapeId = [int]$Shape.Id } catch {}
  $isApprovedPublicVisual = (
    $Scope -eq "slide" -and
    -not $ForceIdentifier.IsPresent -and
    -not $shapeIdentityIsSensitive -and
    $PublicVisualShapeIds -contains $shapeId
  )

  if ($shapeType -eq 6) {
    # Inspect every child recursively and keep the child-level regions. A
    # group-wide fallback would hide unrelated public content. Unverifiable
    # child geometry or inspection failures exclude the source slide instead.
    $forceChildIdentifier = $ForceIdentifier.IsPresent -or $shapeIdentityIsSensitive
    try {
      $groupItems = $Shape.GroupItems
      if ($null -eq $groupItems) {
        throw "PowerPoint returned no GroupItems collection."
      }
      $rawGroupCount = $groupItems.Count
      if ($null -eq $rawGroupCount) {
        throw "PowerPoint returned no grouped-shape count."
      }
      for ($childIndex = 1; $childIndex -le [int]$rawGroupCount; $childIndex++) {
        $child = $null
        try {
          $child = $groupItems.Item($childIndex)
          if ($null -eq $child) {
            throw "PowerPoint returned no grouped child at index $childIndex."
          }
          $hasVisibleGeometry = Assert-ShapeGeometryWithinSlide `
            -Shape $child `
            -SlideWidth $SlideWidth `
            -SlideHeight $SlideHeight
          if (-not $hasVisibleGeometry) { continue }
          $allowChildPictureFill = $false
          if ([int]$child.Type -in @(1, 5, 14, 17) -and (Test-ShapeHasPictureFill -Shape $child)) {
            # A photo used as a clipped content asset remains confidential. A
            # picture fill paired with a same-size solid/gradient overlay is a
            # decorative background treatment; its public headings are layered
            # separately and must not be destroyed by a group-wide blur.
            for ($siblingIndex = 1; $siblingIndex -le [int]$rawGroupCount; $siblingIndex++) {
              if ($siblingIndex -eq $childIndex) { continue }
              $sibling = $null
              try {
                $sibling = $groupItems.Item($siblingIndex)
                if ($null -eq $sibling) { continue }
                $siblingType = [int]$sibling.Type
                if ($siblingType -notin @(1, 5, 14, 17)) { continue }
                if (Test-ShapeHasPictureFill -Shape $sibling) { continue }
                if ([int]$sibling.Fill.Visible -eq 0) { continue }
                if (Test-ShapeGeometryMatches -First $child -Second $sibling) {
                  $allowChildPictureFill = $true
                  break
                }
              } finally {
                if ($sibling) {
                  try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($sibling) | Out-Null } catch {}
                }
              }
            }
          }
          $childRegions = @(Get-ShapeRedactionRegions `
            -Shape $child `
            -SlideIndex $SlideIndex `
            -SlideWidth $SlideWidth `
            -SlideHeight $SlideHeight `
            -SensitiveSourceTokens $SensitiveSourceTokens `
            -PublicVisualShapeIds $PublicVisualShapeIds `
            -Scope $Scope `
            -ForceIdentifier:$forceChildIdentifier `
            -AllowDecorativePictureFill:$allowChildPictureFill)
          foreach ($childRegion in $childRegions) {
            if ($childRegion) { $regions.Add($childRegion) }
          }
        } catch {
          throw "Child $childIndex could not be inspected: $($_.Exception.Message)"
        } finally {
          if ($child) {
            try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($child) | Out-Null } catch {}
          }
        }
      }
    } catch {
      throw "GROUP_SHAPE_INSPECTION_FAILED: $($_.Exception.Message)"
    }
    return $regions.ToArray()
  }

  $hasPictureFill = Test-ShapeHasPictureFill -Shape $Shape
  if ($hasPictureFill -and $isApprovedPublicVisual) {
    return $regions.ToArray()
  }
  if ($hasPictureFill -and -not $AllowDecorativePictureFill.IsPresent) {
    if (Test-ShapeCoversSlide -Shape $Shape -SlideWidth $SlideWidth -SlideHeight $SlideHeight) {
      if (Test-CanKeepFullSlideTemplatePicture `
        -Scope $Scope `
        -ShapeIdentityIsSensitive $shapeIdentityIsSensitive `
        -ForceIdentifier $ForceIdentifier.IsPresent) {
        return $regions.ToArray()
      }
      if (Test-CanKeepCoverFullSlidePicture) { return $regions.ToArray() }
      throw "SLIDE_FULL_BACKGROUND_PICTURE_UNSUPPORTED: A picture or texture shape in the $Scope scope covers the full slide."
    }
    $pictureFillType = if ($ForceIdentifier.IsPresent) {
      "client_identifier"
    } elseif ($shapeIdentityIsSensitive) {
      "logo"
    } else {
      "embedded_photo"
    }
    $pictureFillLabel = switch ($pictureFillType) {
      "client_identifier" { "local_identifier" }
      "logo" { "local_logo" }
      default { "local_picture_fill" }
    }
    $pictureFillRegion = New-LocalRedactionRegion -Shape $Shape -SlideIndex $SlideIndex `
      -SlideWidth $SlideWidth -SlideHeight $SlideHeight `
      -Type $pictureFillType -Label $pictureFillLabel
    if ($pictureFillRegion) { $regions.Add($pictureFillRegion) }
    return $regions.ToArray()
  }

  # Text is redacted by rendered line bounds, never by the outer text-box
  # rectangle. This preserves the card, diagram, and spacing around the line.
  if (Test-ShapeHasText -Shape $Shape) {
    foreach ($textRegion in @(Get-ShapeTextRedactionRegions `
      -Shape $Shape `
      -SlideIndex $SlideIndex `
      -SlideWidth $SlideWidth `
      -SlideHeight $SlideHeight `
      -SensitiveSourceTokens $SensitiveSourceTokens `
      -ForceIdentifier:($ForceIdentifier.IsPresent -or $shapeIdentityIsSensitive))) {
      if ($textRegion) { $regions.Add($textRegion) }
    }
    return $regions.ToArray()
  }

  $regionType = $null
  $regionLabel = $null
  if ($ForceIdentifier.IsPresent) {
    $regionType = "client_identifier"
    $regionLabel = "local_identifier"
  } elseif ($shapeIdentityIsSensitive) {
    $regionType = "logo"
    $regionLabel = "local_logo"
  }

  if (-not $regionType -and $shapeType -eq 19) {
    foreach ($tableRegion in @(Get-TableRedactionRegions `
      -Shape $Shape `
      -SlideIndex $SlideIndex `
      -SlideWidth $SlideWidth `
      -SlideHeight $SlideHeight `
      -SensitiveSourceTokens $SensitiveSourceTokens)) {
      if ($tableRegion) { $regions.Add($tableRegion) }
    }
    return $regions.ToArray()
  }

  $placeholderContainedType = $null
  if ($shapeType -eq 14) {
    try {
      $placeholderFormat = $Shape.PlaceholderFormat
      if ($null -eq $placeholderFormat) {
        throw "PowerPoint returned no PlaceholderFormat object."
      }
      $rawPlaceholderContainedType = $placeholderFormat.ContainedType
      if ($null -eq $rawPlaceholderContainedType) {
        throw "PowerPoint returned no PlaceholderFormat.ContainedType value."
      }
      $placeholderContainedType = [int]$rawPlaceholderContainedType
    } catch {
      throw "SHAPE_PLACEHOLDER_CONTENT_INSPECTION_FAILED: $($_.Exception.Message)"
    }
  }

  $pictureContentTypes = @(11, 13, 16, 26, 29)
  $isPictureContent = (
    $shapeType -in $pictureContentTypes -or
    ($shapeType -eq 14 -and $placeholderContainedType -in $pictureContentTypes)
  )
  if ($isPictureContent -and $isApprovedPublicVisual) {
    return $regions.ToArray()
  }
  if ($isPictureContent -and (Test-ShapeCoversSlide `
    -Shape $Shape `
    -SlideWidth $SlideWidth `
    -SlideHeight $SlideHeight)) {
    if (Test-CanKeepFullSlideTemplatePicture `
      -Scope $Scope `
      -ShapeIdentityIsSensitive $shapeIdentityIsSensitive `
      -ForceIdentifier $ForceIdentifier.IsPresent) {
      return $regions.ToArray()
    }
    if (Test-CanKeepCoverFullSlidePicture) { return $regions.ToArray() }
    throw "SLIDE_FULL_BACKGROUND_PICTURE_UNSUPPORTED: A picture or texture shape in the $Scope scope covers the full slide."
  }

  if (-not $regionType -and $shapeType -eq 14) {
    # A placeholder can contain a picture, chart, table, media, OLE object, or
    # another non-text object while Shape.Type still reports msoPlaceholder.
    # Classify the contained object explicitly; otherwise a no-text placeholder
    # could be mistaken for a harmless empty vector and expose its contents.
    switch ($placeholderContainedType) {
      3 { $regionType = "chart_label"; $regionLabel = "local_chart" }
      7 { $regionType = "screenshot"; $regionLabel = "local_embedded_object" }
      8 { $regionType = "screenshot"; $regionLabel = "local_control" }
      10 { $regionType = "screenshot"; $regionLabel = "local_linked_object" }
      11 { $regionType = "embedded_photo"; $regionLabel = "local_linked_picture" }
      12 { $regionType = "screenshot"; $regionLabel = "local_control" }
      13 { $regionType = "embedded_photo"; $regionLabel = "local_picture" }
      15 { $regionType = "body_text"; $regionLabel = "local_body_text" }
      16 { $regionType = "embedded_photo"; $regionLabel = "local_media" }
      19 { $regionType = "table_content"; $regionLabel = "local_table" }
      20 { $regionType = "screenshot"; $regionLabel = "local_canvas" }
      21 { $regionType = "screenshot"; $regionLabel = "local_diagram" }
      22 { $regionType = "screenshot"; $regionLabel = "local_ink" }
      23 { $regionType = "screenshot"; $regionLabel = "local_ink_comment" }
      24 { $regionType = "screenshot"; $regionLabel = "local_smartart" }
      25 { $regionType = "screenshot"; $regionLabel = "local_slicer" }
      26 { $regionType = "embedded_photo"; $regionLabel = "local_web_media" }
      29 { $regionType = "embedded_photo"; $regionLabel = "local_linked_picture" }
      { $_ -in @(1, 2, 5, 9, 14, 17, 28) } {
        # Ordinary/text placeholders continue through the existing text and
        # font-size classification below. An empty one needs no blur.
      }
      default {
        # Unknown, grouped, app, script, and 3D placeholder contents cannot be
        # inspected child-by-child through PlaceholderFormat. Blur the verified
        # placeholder boundary; geometry failure excludes the source slide.
        $regionType = "screenshot"
        $regionLabel = "local_ambiguous"
      }
    }
  }

  switch ($shapeType) {
    3 { if (-not $regionType) { $regionType = "chart_label"; $regionLabel = "local_chart" } }
    7 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_embedded_object" } }
    10 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_linked_object" } }
    11 { if (-not $regionType) { $regionType = "embedded_photo"; $regionLabel = "local_linked_picture" } }
    12 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_control" } }
    13 { if (-not $regionType) { $regionType = "embedded_photo"; $regionLabel = "local_picture" } }
    16 { if (-not $regionType) { $regionType = "embedded_photo"; $regionLabel = "local_media" } }
    19 { if (-not $regionType) { $regionType = "table_content"; $regionLabel = "local_table" } }
    20 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_canvas" } }
    21 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_diagram" } }
    22 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_ink" } }
    23 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_ink_comment" } }
    24 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_smartart" } }
    25 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_slicer" } }
    26 { if (-not $regionType) { $regionType = "embedded_photo"; $regionLabel = "local_web_media" } }
  }

  # A picture fill reaches this point only when its group contains a same-size
  # vector overlay proving that it is decorative. Standalone picture/media and
  # unpaired picture-fill shapes are redacted above.
  if (-not $regionType -and $shapeType -eq 15) {
    $classification = Get-ShapeTextEffectClassification `
      -Shape $Shape `
      -SensitiveSourceTokens $SensitiveSourceTokens
    switch ($classification) {
      "public_large_title" { return $regions.ToArray() }
      "identifier" { $regionType = "client_identifier"; $regionLabel = "local_identifier" }
      default { $regionType = "body_text"; $regionLabel = "local_body_text" }
    }
  }
  # Known vector-only primitives are safe when they contain no text or image
  # fill. Every other unreadable shape is ambiguous and is redacted.
  $knownVectorOnlyType = $shapeType -in @(1, 2, 5, 9, 14, 17, 28)
  if (-not $regionType -and -not $knownVectorOnlyType) {
    $regionType = "screenshot"
    $regionLabel = "local_ambiguous"
  }
  if ($regionType) {
    $region = New-LocalRedactionRegion -Shape $Shape -SlideIndex $SlideIndex `
      -SlideWidth $SlideWidth -SlideHeight $SlideHeight `
      -Type $regionType -Label $regionLabel
    if (-not $region -and $ForceIdentifier.IsPresent) {
      throw "SHAPE_GEOMETRY_INSPECTION_FAILED: A forced child identifier could not be mapped to a visible region."
    }
    if ($region) { $regions.Add($region) }
  }
  return $regions.ToArray()
}

function Get-SlideRedactionRegions {
  param(
    [Parameter(Mandatory = $true)]$Slide,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight,
    [string[]]$SensitiveSourceTokens = @(),
    [int[]]$PublicVisualShapeIds = @()
  )

  $regions = New-Object System.Collections.Generic.List[object]
  try {
    $rawFollowMasterBackground = $Slide.FollowMasterBackground
    if ($null -eq $rawFollowMasterBackground) {
      throw "PowerPoint returned no slide FollowMasterBackground value."
    }
    if ([int]$rawFollowMasterBackground -eq 0) {
      $slideBackground = $Slide.Background
      $slideBackgroundFill = if ($null -ne $slideBackground) { $slideBackground.Fill } else { $null }
      $slideBackgroundType = if ($null -ne $slideBackgroundFill) { $slideBackgroundFill.Type } else { $null }
      if ($null -eq $slideBackgroundType) {
        throw "PowerPoint returned no slide background fill type."
      }
      if ([int]$slideBackgroundType -in @(4, 6)) {
        throw "SLIDE_PICTURE_BACKGROUND_UNSUPPORTED: The slide-specific background uses a picture or texture fill."
      }
    }
  } catch {
    if ($_.Exception.Message.StartsWith("SLIDE_PICTURE_BACKGROUND_UNSUPPORTED:")) { throw }
    throw "SLIDE_BACKGROUND_INSPECTION_FAILED: slide background: $($_.Exception.Message)"
  }
  try {
    $customLayout = $Slide.CustomLayout
    if ($null -eq $customLayout) {
      throw "PowerPoint returned no CustomLayout object."
    }
    $rawLayoutFollowMasterBackground = $customLayout.FollowMasterBackground
    if ($null -eq $rawLayoutFollowMasterBackground) {
      throw "PowerPoint returned no custom-layout FollowMasterBackground value."
    }
    if ([int]$rawLayoutFollowMasterBackground -eq 0) {
      $customBackground = $customLayout.Background
      $customBackgroundFill = if ($null -ne $customBackground) { $customBackground.Fill } else { $null }
      $customBackgroundType = if ($null -ne $customBackgroundFill) { $customBackgroundFill.Type } else { $null }
      if ($null -eq $customBackgroundType) {
        throw "PowerPoint returned no custom-layout background fill type."
      }
      if ([int]$customBackgroundType -in @(4, 6)) {
        throw "SLIDE_PICTURE_BACKGROUND_UNSUPPORTED: The custom-layout background uses a picture or texture fill."
      }
    }
  } catch {
    if ($_.Exception.Message.StartsWith("SLIDE_PICTURE_BACKGROUND_UNSUPPORTED:")) { throw }
    throw "SLIDE_BACKGROUND_INSPECTION_FAILED: custom-layout background: $($_.Exception.Message)"
  }
  try {
    $master = $Slide.Master
    $masterBackground = if ($null -ne $master) { $master.Background } else { $null }
    $masterBackgroundFill = if ($null -ne $masterBackground) { $masterBackground.Fill } else { $null }
    $masterBackgroundType = if ($null -ne $masterBackgroundFill) { $masterBackgroundFill.Type } else { $null }
    if ($null -eq $masterBackgroundType) {
      throw "PowerPoint returned no master background fill type."
    }
    if ([int]$masterBackgroundType -in @(4, 6)) {
      throw "SLIDE_PICTURE_BACKGROUND_UNSUPPORTED: The master background uses a picture or texture fill."
    }
  } catch {
    if ($_.Exception.Message.StartsWith("SLIDE_PICTURE_BACKGROUND_UNSUPPORTED:")) { throw }
    throw "SLIDE_BACKGROUND_INSPECTION_FAILED: master background: $($_.Exception.Message)"
  }

  $shapeCollections = New-Object System.Collections.Generic.List[object]
  try {
    $slideShapes = $Slide.Shapes
    if ($null -eq $slideShapes) { throw "PowerPoint returned no slide Shapes collection." }
    $shapeCollections.Add([PSCustomObject]@{ name = "slide"; scope = "slide"; shapes = $slideShapes })
  } catch {
    throw "SLIDE_SHAPE_COLLECTION_INSPECTION_FAILED: slide shapes: $($_.Exception.Message)"
  }
  try {
    $layoutShapes = $Slide.CustomLayout.Shapes
    if ($null -eq $layoutShapes) { throw "PowerPoint returned no layout Shapes collection." }
    $shapeCollections.Add([PSCustomObject]@{ name = "custom-layout"; scope = "layout"; shapes = $layoutShapes })
  } catch {
    throw "SLIDE_SHAPE_COLLECTION_INSPECTION_FAILED: custom-layout shapes: $($_.Exception.Message)"
  }
  try {
    $masterShapes = $Slide.Master.Shapes
    if ($null -eq $masterShapes) { throw "PowerPoint returned no master Shapes collection." }
    $shapeCollections.Add([PSCustomObject]@{ name = "master"; scope = "master"; shapes = $masterShapes })
  } catch {
    throw "SLIDE_SHAPE_COLLECTION_INSPECTION_FAILED: master shapes: $($_.Exception.Message)"
  }
  foreach ($shapeSource in $shapeCollections) {
    $shapeCollection = $shapeSource.shapes
    try {
      $rawShapeCount = $shapeCollection.Count
      if ($null -eq $rawShapeCount) {
        throw "PowerPoint returned no shape collection count."
      }
      for ($shapeIndex = 1; $shapeIndex -le [int]$rawShapeCount; $shapeIndex++) {
        $shape = $null
        try {
          $shape = $shapeCollection.Item($shapeIndex)
          if ($null -eq $shape) {
            throw "PowerPoint returned no shape at index $shapeIndex."
          }
          foreach ($region in @(Get-ShapeRedactionRegions `
            -Shape $shape `
            -SlideIndex $SlideIndex `
            -SlideWidth $SlideWidth `
            -SlideHeight $SlideHeight `
            -SensitiveSourceTokens $SensitiveSourceTokens `
            -PublicVisualShapeIds $PublicVisualShapeIds `
            -Scope $shapeSource.scope)) {
            if ($region) { $regions.Add($region) }
          }
        } catch {
          throw "SLIDE_SHAPE_INSPECTION_FAILED: $($shapeSource.name) shape ${shapeIndex}: $($_.Exception.Message)"
        } finally {
          if ($shape) {
            try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shape) | Out-Null } catch {}
          }
        }
      }
    } catch {
      if ($_.Exception.Message.StartsWith("SLIDE_SHAPE_INSPECTION_FAILED:")) { throw }
      throw "SLIDE_SHAPE_COLLECTION_INSPECTION_FAILED: $($shapeSource.name) shapes: $($_.Exception.Message)"
    } finally {
      if ($shapeCollection) {
        try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shapeCollection) | Out-Null } catch {}
      }
    }
  }
  return $regions.ToArray()
}

function Convert-Document {
  param(
    [string]$JobId,
    [string]$SourceUrl,
    [string]$FileName,
    [string]$SourceAuthorization,
    [object[]]$PublicVisualOverrides = @()
  )

  $parsedJobId = [Guid]::Empty
  if (-not [Guid]::TryParse($JobId, [ref]$parsedJobId)) {
    throw "INVALID_JOB_ID: The server returned an invalid job identifier."
  }
  $JobId = $parsedJobId.ToString()
  $JobRoot = Join-Path $JobsRoot $JobId
  $SlidesRoot = Join-Path $JobRoot "slides"
  New-Item -ItemType Directory -Force -Path $SlidesRoot | Out-Null
  Get-ChildItem -LiteralPath $SlidesRoot -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
  $extension = [System.IO.Path]::GetExtension($FileName).ToLowerInvariant()
  $sensitiveSourceTokens = @(Get-SensitiveSourceTokens -FileName $FileName)
  $SourcePath = Join-Path $JobRoot ("source" + $extension)

  $powerPoint = $null
  $presentation = $null
  $powerPointVersion = $null
  $heartbeatJob = $null
  $slidePaths = New-Object System.Collections.Generic.List[string]
  $localRedactionSlides = New-Object System.Collections.Generic.List[object]
  $localRedactionManifest = $null
  try {
    Send-Heartbeat -Status "busy" -CurrentJobId $JobId
    $heartbeatJob = Start-JobHeartbeat -JobId $JobId
    Get-SourceFile `
      -SourceUrl $SourceUrl `
      -SourcePath $SourcePath `
      -AuthorizationHeader $SourceAuthorization

    if ($extension -eq ".pdf") {
      Write-WorkerLog "Starting local PDF page rendering."
      $renderer = Find-PdfRenderer
      $outputPrefix = Join-Path $SlidesRoot "page"
      & $renderer -png -r 144 -f 1 -l 100 $SourcePath $outputPrefix
      if ($LASTEXITCODE -ne 0) {
        throw "PDF_RENDER_FAILED: pdftoppm exited with code $LASTEXITCODE."
      }
      $renderedPages = Get-ChildItem -LiteralPath $SlidesRoot -Filter "page-*.png" -File |
        Sort-Object Name
      if ($renderedPages.Count -lt 5) {
        throw "NON_PRESENTATION_LAYOUT: A portfolio PDF must contain at least 5 pages."
      }
      Assert-SupportedPageImage -ImagePath $renderedPages[0].FullName
      foreach ($pageIndex in (Get-RepresentativeIndexes -Count $renderedPages.Count)) {
        $slidePaths.Add($renderedPages[$pageIndex].FullName)
      }
      Write-WorkerLog "Rendered $($renderedPages.Count) PDF pages and selected $($slidePaths.Count) representative pages."
    } elseif ($extension -in @(".ppt", ".pptx", ".pptm")) {
      Write-WorkerLog "Starting local PowerPoint rendering."
      Add-Type -AssemblyName Microsoft.Office.Interop.PowerPoint
      $powerPoint = New-Object Microsoft.Office.Interop.PowerPoint.ApplicationClass
      $powerPointVersion = [string]$powerPoint.Version
      Send-Heartbeat -Status "busy" -CurrentJobId $JobId -PowerPointVersion $powerPointVersion
      Stop-JobHeartbeat -HeartbeatJob $heartbeatJob
      $heartbeatJob = Start-JobHeartbeat -JobId $JobId -PowerPointVersion $powerPointVersion
      $presentation = $powerPoint.Presentations.Open($SourcePath, 0, 0, 0)
      Write-WorkerLog "PowerPoint opened local copy (readOnly=$($presentation.ReadOnly))."
      $slideWidth = [double]$presentation.PageSetup.SlideWidth
      $slideHeight = [double]$presentation.PageSetup.SlideHeight
      $aspectRatio = $slideWidth / $slideHeight
      if (-not (Test-SupportedPageRatio -AspectRatio $aspectRatio)) {
        throw "NON_PRESENTATION_LAYOUT: Slide ratio $([Math]::Round($aspectRatio, 3)) is not 16:9, 4:3, A4 landscape, or A4 portrait."
      }
      if ([int]$presentation.Slides.Count -lt 5) {
        throw "NON_PRESENTATION_LAYOUT: A portfolio presentation must contain at least 5 slides."
      }

      Add-Type -AssemblyName System.Drawing
      $installedFonts = [System.Drawing.Text.InstalledFontCollection]::new().Families.Name
      $installedNormalized = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
      foreach ($installedFont in $installedFonts) {
        $normalizedInstalled = ([string]$installedFont -replace '\s+(Thin|ExtraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|Black|Italic)$', '').Trim()
        [void]$installedNormalized.Add($normalizedInstalled)
      }
      $declaredFonts = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
      foreach ($slide in $presentation.Slides) {
        foreach ($shape in $slide.Shapes) {
          try {
            if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
              $fontName = [string]$shape.TextFrame.TextRange.Font.Name
              if ($fontName) { [void]$declaredFonts.Add($fontName) }
            }
            if ([int]$shape.Type -eq 6) {
              foreach ($child in $shape.GroupItems) {
                try {
                  if ($child.HasTextFrame -and $child.TextFrame.HasText) {
                    $childFontName = [string]$child.TextFrame.TextRange.Font.Name
                    if ($childFontName) { [void]$declaredFonts.Add($childFontName) }
                  }
                } catch {}
              }
            }
          } catch {}
        }
      }
      $missingFonts = New-Object System.Collections.Generic.List[string]
      foreach ($declaredFont in $declaredFonts) {
        $normalizedDeclared = ([string]$declaredFont -replace '\s+(Thin|ExtraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|Black|Italic)$', '').Trim()
        if (-not $installedNormalized.Contains($normalizedDeclared)) {
          $missingFonts.Add([string]$declaredFont)
        }
      }
      if ($missingFonts.Count -gt 0) {
        throw "MISSING_FONTS: PowerPoint cannot find these source fonts: $($missingFonts -join ', ')."
      }
      Write-WorkerLog "Presentation layout and $($declaredFonts.Count) declared fonts verified."
      $exportWidth = 2000
      $exportHeight = [Math]::Max(1, [int][Math]::Round($exportWidth * $slideHeight / $slideWidth))
      $representativeIndexes = Get-RepresentativeIndexes -Count ([int]$presentation.Slides.Count)
      $excludedSlideDetails = New-Object System.Collections.Generic.List[string]
      foreach ($zeroBasedIndex in $representativeIndexes) {
        $slideNumber = $zeroBasedIndex + 1
        $publicVisualShapeIds = @($PublicVisualOverrides | Where-Object {
          [int]$_.sourceSlideNumber -eq $slideNumber
        } | ForEach-Object { [int]$_.shapeId })
        $slide = $null
        try {
          $slide = $presentation.Slides.Item($slideNumber)
          $exportedSlideIndex = $slidePaths.Count
          try {
            # A successful inspection may legitimately return no sensitive
            # regions. Such a slide is exported unchanged and marked verified.
            $script:CurrentSlidePublicTitles = New-Object System.Collections.Generic.List[string]
            $script:CurrentSourceSlideNumber = $slideNumber
            $redactionRegions = @(Get-SlideRedactionRegions `
              -Slide $slide `
              -SlideIndex $exportedSlideIndex `
              -SlideWidth $slideWidth `
              -SlideHeight $slideHeight `
              -SensitiveSourceTokens $sensitiveSourceTokens `
              -PublicVisualShapeIds $publicVisualShapeIds)
          } catch {
            $inspectionReason = ($_.Exception.Message -replace '[\r\n]+', ' ').Trim()
            $excludedSlideDetails.Add("$slideNumber ($inspectionReason)")
            Write-WorkerLog "Excluding source slide $slideNumber from conversion because selective redaction inspection failed: $inspectionReason"
            continue
          }

          $path = Join-Path $SlidesRoot ("slide-{0:D3}.png" -f $slideNumber)
          $exported = $false

          # PowerPoint can occasionally return from Slide.Export before a file
          # appears (or without creating one at all). Never enqueue a path that
          # has not been verified on disk. Retry briefly, then skip only that
          # slide so one flaky page does not discard an otherwise valid deck.
          for ($exportAttempt = 1; $exportAttempt -le 3 -and -not $exported; $exportAttempt++) {
            if (Test-Path -LiteralPath $path) {
              Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
            try {
              $slide.Export($path, "PNG", $exportWidth, $exportHeight)
            } catch {
              Write-WorkerLog "Slide $slideNumber export attempt $exportAttempt failed: $($_.Exception.Message)"
            }

            for ($poll = 0; $poll -lt 10 -and -not $exported; $poll++) {
              if (Test-Path -LiteralPath $path) {
                $exportedFile = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
                if ($exportedFile -and $exportedFile.Length -gt 1024) {
                  $exported = $true
                  break
                }
              }
              Start-Sleep -Milliseconds 200
            }
          }

          if ($exported) {
            $localRedactionSlides.Add([PSCustomObject]@{
              slideIndex = $exportedSlideIndex
              sourceSlideNumber = $slideNumber
              inspectionStatus = "verified"
              publicTitles = @($script:CurrentSlidePublicTitles)
              regions = @($redactionRegions)
            })
            $slidePaths.Add($path)
          } else {
            $exportReason = "PowerPoint did not create a usable PNG after 3 attempts"
            $excludedSlideDetails.Add("$slideNumber ($exportReason)")
            Write-WorkerLog "Excluding source slide $slideNumber from conversion: $exportReason."
          }
        } finally {
          if ($slide) {
            [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($slide) | Out-Null
          }
        }
      }
      if ($excludedSlideDetails.Count -gt 0) {
        Write-WorkerLog "Excluded $($excludedSlideDetails.Count) source slide(s): $($excludedSlideDetails -join '; ')."
      }
      Write-WorkerLog "Selected $($slidePaths.Count) representative slides from $($presentation.Slides.Count) total slides."
      if ($slidePaths.Count -lt 5) {
        $excludedSummary = if ($excludedSlideDetails.Count -gt 0) {
          $excludedSlideDetails -join '; '
        } else {
          "none recorded"
        }
        throw "INSUFFICIENT_USABLE_SLIDES: Selective redaction left $($slidePaths.Count) fully inspected usable slide(s); at least 5 are required. Excluded source slides: $excludedSummary."
      }
      $localRedactionManifest = [PSCustomObject]@{
        version = 2
        method = "powerpoint_com_shapes_v2"
        sourceSlideCount = [int]$presentation.Slides.Count
        slideCount = $slidePaths.Count
        slides = $localRedactionSlides.ToArray()
      }
    } else {
      throw "UNSUPPORTED_DOCUMENT: Only PPT, PPTX, PPTM, and PDF sources are supported."
    }

    if ($slidePaths.Count -lt 5) {
      throw "NON_PRESENTATION_LAYOUT: A portfolio document must contain at least 5 pages."
    }

    if ($presentation) {
      $presentation.Close()
      [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) | Out-Null
      $presentation = $null
    }
    if ($powerPoint) {
      $powerPoint.Quit()
      [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null
      $powerPoint = $null
    }

    Write-WorkerLog "Requesting slide upload destinations."
    $uploadPlan = Invoke-WorkerApi -Path "/api/worker/jobs/uploads" -Body @{
      jobId = $JobId
      slideCount = $slidePaths.Count
    }
    Write-WorkerLog "Uploading $($slidePaths.Count) slide images."
    $uploadedSlides = New-Object System.Collections.Generic.List[string]
    foreach ($upload in ($uploadPlan.uploads | Sort-Object index)) {
      $localSlide = $slidePaths[[int]$upload.index - 1]
      Upload-SignedFile `
        -SignedUrl $upload.signedUrl `
        -FilePath $localSlide `
        -ContentType "image/png" `
        -Authorization ([string]$uploadPlan.uploadAuthorization)
      $uploadedSlides.Add([string]$upload.path)
    }
    Invoke-WorkerApi -Path "/api/worker/jobs/complete" -Body @{
      jobId = $JobId
      bucket = [string]$uploadPlan.bucket
      slidePaths = $uploadedSlides.ToArray()
      powerPointVersion = $powerPointVersion
      workerVersion = $WorkerVersion
      localRedactionManifest = $localRedactionManifest
    } | Out-Null
    Write-WorkerLog "Completed job $JobId with $($slidePaths.Count) pages."
  } finally {
    Stop-JobHeartbeat -HeartbeatJob $heartbeatJob
    if ($presentation) {
      try { $presentation.Close() } catch {}
      try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) | Out-Null } catch {}
    }
    if ($powerPoint) {
      try { $powerPoint.Quit() } catch {}
      try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    try {
      Remove-LocalJobDirectory -JobId $JobId
    } catch {
      Write-WorkerLog "Could not remove local files for job ${JobId}: $($_.Exception.Message)"
    }
  }
}

if ($WorkerId -notmatch '^[a-z0-9][a-z0-9._-]{1,63}$') {
  Write-WorkerLog "WOOLIM_WORKER_ID is invalid. Use 2-64 lowercase letters, numbers, dots, underscores, or hyphens."
  Write-Error "Invalid WOOLIM_WORKER_ID: $WorkerId" -ErrorAction Continue
  exit 2
}
if ([string]::IsNullOrWhiteSpace($WorkerName) -or $WorkerName.Length -gt 80 -or $WorkerName -match '[\r\n]') {
  Write-WorkerLog "WOOLIM_WORKER_NAME is invalid."
  Write-Error "WOOLIM_WORKER_NAME must be 1-80 characters on one line." -ErrorAction Continue
  exit 2
}
$parsedServerUrl = $null
$validServerUrl = [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$parsedServerUrl)
$isLocalDevelopment = $validServerUrl -and $parsedServerUrl.IsLoopback -and $parsedServerUrl.Scheme -eq "http"
if (-not $validServerUrl -or ($parsedServerUrl.Scheme -ne "https" -and -not $isLocalDevelopment)) {
  Write-WorkerLog "WOOLIM_WORKER_SERVER_URL is invalid."
  Write-Error "WOOLIM_WORKER_SERVER_URL must use HTTPS (plain HTTP is allowed only for localhost development)." -ErrorAction Continue
  exit 2
}

if (-not $WorkerSecret) {
  Write-WorkerLog "WOOLIM_PC_WORKER_SECRET is not configured."
  Write-Error "WOOLIM_PC_WORKER_SECRET is not configured. Run setup.ps1 first." -ErrorAction Continue
  exit 2
}

$powerPointType = [Type]::GetTypeFromProgID("PowerPoint.Application")
if ($Check) {
  $checkFailed = $false
  Write-Host "Worker ID: $WorkerId"
  Write-Host "Worker name: $WorkerName"
  Write-Host "Server: $ServerUrl"
  Write-Host "Secret: configured (value hidden)"
  if ($powerPointType) {
    Write-Host "PowerPoint: detected"
  } else {
    Write-Warning "PowerPoint: not detected; PPT/PPTX/PPTM jobs cannot run."
    $checkFailed = $true
  }
  try {
    $rendererPath = Find-PdfRenderer
    Write-Host "PDF renderer: $rendererPath"
  } catch {
    Write-Warning $_.Exception.Message
    $checkFailed = $true
  }
  Write-Host "Local data: $WorkerRoot"
  if ($checkFailed) { exit 3 }
  exit 0
}

if ($LibraryOnly) { return }

$mutex = New-Object System.Threading.Mutex($false, "Local\WoolimWorker-$WorkerId")
$ownsMutex = $false
try {
  try {
    $ownsMutex = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) {
    if ($HeartbeatOnly) {
      Write-Error "Cannot run the heartbeat diagnostic while worker '$WorkerId' is already running. Stop it first or verify its live status in the admin page." -ErrorAction Continue
      exit 4
    }
    Write-WorkerLog "Another process is already running with this worker ID."
    Write-Error "Worker '$WorkerId' is already running." -ErrorAction Continue
    exit 4
  }

  if ($HeartbeatOnly) {
    Send-Heartbeat
    Write-Host "Heartbeat accepted for '$WorkerId' ($WorkerName)."
    exit 0
  }

  Remove-StaleJobDirectories
  Write-WorkerLog "Starting worker $WorkerVersion as '$WorkerName' for $ServerUrl."

do {
  try {
    Send-Heartbeat
    $claim = Invoke-WorkerApi -Path "/api/worker/jobs/claim" -Body @{
      workerVersion = $WorkerVersion
      capabilities = @("powerpoint_selective_redaction_manifest_v2")
    }
    if ($claim.job) {
      try {
        Write-WorkerLog "Claimed job $($claim.job.id): $($claim.job.fileName)"
        $sourceAuthorizationHeader = if ($claim.job.sourceAuthorization) {
          "Authorization: $([string]$claim.job.sourceAuthorization)"
        } else {
          ""
        }
        Convert-Document `
          -JobId ([string]$claim.job.id) `
          -SourceUrl ([string]$claim.job.sourceUrl) `
          -FileName ([string]$claim.job.fileName) `
          -SourceAuthorization $sourceAuthorizationHeader `
          -PublicVisualOverrides @($claim.job.publicVisualOverrides)
      } catch {
        $message = $_.Exception.Message
        Write-WorkerLog "Failed job $($claim.job.id): $message"
        $retryable = -not (
          $message.StartsWith("NON_PRESENTATION_LAYOUT:") -or
          $message.StartsWith("MISSING_FONTS:") -or
          $message.StartsWith("MISSING_PDF_RENDERER:") -or
          $message.StartsWith("INSUFFICIENT_USABLE_SLIDES:") -or
          $message.StartsWith("UNSUPPORTED_DOCUMENT:")
        )
        try {
          Invoke-WorkerApi -Path "/api/worker/jobs/fail" -Body @{
            jobId = [string]$claim.job.id
            error = $message
            retryable = $retryable
            fontInventoryFingerprint = $FontInventoryFingerprint
          } | Out-Null
        } catch {
          Write-WorkerLog "Could not report failure: $($_.Exception.Message)"
        }
      }
    }
  } catch {
    Write-WorkerLog "Worker cycle failed: $($_.Exception.Message)"
  }
  if (-not $Once) { Start-Sleep -Seconds 60 }
} while (-not $Once)
} finally {
  if ($ownsMutex) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  $mutex.Dispose()
}
