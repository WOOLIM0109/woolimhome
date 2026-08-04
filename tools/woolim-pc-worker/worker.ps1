param(
  [switch]$Once,
  [switch]$Check,
  [switch]$HeartbeatOnly
)

$ErrorActionPreference = "Stop"
$WorkerVersion = "2.3.0"

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
    $paddingX = [Math]::Max(1.5, $SlideWidth * 0.004)
    $paddingY = [Math]::Max(1.5, $SlideHeight * 0.004)
    $left = [Math]::Max(0.0, [double]$rawLeft - $paddingX)
    $top = [Math]::Max(0.0, [double]$rawTop - $paddingY)
    $right = [Math]::Min($SlideWidth, [double]$rawLeft + [double]$rawWidth + $paddingX)
    $bottom = [Math]::Min($SlideHeight, [double]$rawTop + [double]$rawHeight + $paddingY)
    if ($right -le $left -or $bottom -le $top) { return $null }

    return [PSCustomObject]@{
      slideIndex = $SlideIndex
      type = $Type
      label = $Label
      x = [double]($left / $SlideWidth)
      y = [double]($top / $SlideHeight)
      width = [double](($right - $left) / $SlideWidth)
      height = [double](($bottom - $top) / $SlideHeight)
    }
  } catch {
    # If a sensitive shape cannot be mapped to pixels, a partial manifest is
    # unsafe. Propagate the geometry failure so the slide becomes one
    # full-page fail-closed region.
    throw "SHAPE_GEOMETRY_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function New-FullSlideRedactionRegion {
  param([Parameter(Mandatory = $true)][int]$SlideIndex)

  return [PSCustomObject]@{
    slideIndex = $SlideIndex
    type = "screenshot"
    label = "local_ambiguous"
    x = [double]0
    y = [double]0
    width = [double]1
    height = [double]1
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
    # placeholder, or autoshape. Propagate uncertainty so the caller can blur
    # the whole slide instead of guessing.
    throw "SHAPE_TEXT_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function Get-ShapeTextClassification {
  param([Parameter(Mandatory = $true)]$Shape)

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
    $identifierSignal = '(?i)(@|https?://|www\.|\b(?:client|customer|project|company|corporation|corp\.?|inc\.?|ltd\.?|customer)\b|고객사|발주처|수행사|제안사|프로젝트|과제명|주식회사|\(주\)|㈜|기관명|담당자|연락처|주소|대표자|사업자)'
    $numberSignal = '(?i)(\b\d{2,3}[- .)]?\d{3,4}[- .]?\d{4}\b|\b\d{3}[- ]?\d{2}[- ]?\d{5}\b)'
    $containsIdentifier = $shapeName -match '(?i)(logo|client|customer|project|identifier|footer|header|로고|고객|회사명|기관명|과제)'
    $containsIdentifier = $containsIdentifier -or $text -match $identifierSignal
    $containsIdentifier = $containsIdentifier -or $text -match $numberSignal
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
    $largeEnough = ($isTitlePlaceholder -and $fontSize -ge 26.0) -or $fontSize -ge 32.0
    $normalized = ($text -replace '[\r\n]+', ' ' -replace '\s+', ' ').Trim()
    $genericTitle = '(?i)^\s*(?:\d{1,2}\s*[.\-:]?\s*)?(?:목차|개요|사업\s*개요|제안\s*개요|프로젝트\s*개요|회사\s*소개|배경|목적|목표|현황|문제점|추진\s*전략|전략|방향|프로세스|로드맵|일정|기대\s*효과|결론|부록|감사합니다|contents?|agenda|overview|introduction|background|objectives?|goals?|strategy|process|roadmap|timeline|solution|services?|portfolio|case\s*study|appendix|thank\s*you)\s*[.：:\-–—]?\s*$'
    if ($largeEnough -and $normalized.Length -le 120 -and $normalized -match $genericTitle) {
      return "generic_large_title"
    }
    if ($fontSize -gt 0 -and $fontSize -lt 18.0) { return "small_text" }
    return "body_text"
  } catch {
    # A text run that cannot be classified must not be reduced to a guessed
    # shape boundary. Bubble the error to the slide-level full-page fallback.
    throw "SHAPE_TEXT_CLASSIFICATION_FAILED: $($_.Exception.Message)"
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
    # vector primitive. Let slide-level handling apply a full-page blur.
    throw "SHAPE_PICTURE_FILL_INSPECTION_FAILED: $($_.Exception.Message)"
  }
}

function Get-ShapeRedactionRegions {
  param(
    [Parameter(Mandatory = $true)]$Shape,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight
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

  if ($shapeType -eq 6) {
    # Group-item coordinates and transforms differ between Office versions.
    # Inspect children recursively, then redact the entire group as the
    # conservative geometry boundary. A vector-only group can itself be a
    # client logo, so it cannot be proven public from child types alone.
    $groupContainsSensitiveContent = $true
    $groupInspectionFailed = $false
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
          $childRegions = @(Get-ShapeRedactionRegions `
            -Shape $child `
            -SlideIndex $SlideIndex `
            -SlideWidth $SlideWidth `
            -SlideHeight $SlideHeight)
          if ($childRegions.Count -gt 0) { $groupContainsSensitiveContent = $true }
        } catch {
          $groupContainsSensitiveContent = $true
          $groupInspectionFailed = $true
        } finally {
          if ($child) {
            try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($child) | Out-Null } catch {}
          }
        }
      }
    } catch {
      $groupContainsSensitiveContent = $true
      $groupInspectionFailed = $true
    }
    if ($groupInspectionFailed) {
      throw "GROUP_SHAPE_INSPECTION_FAILED: PowerPoint could not inspect every child in a grouped shape."
    }
    if ($groupContainsSensitiveContent) {
      $region = New-LocalRedactionRegion -Shape $Shape -SlideIndex $SlideIndex `
        -SlideWidth $SlideWidth -SlideHeight $SlideHeight `
        -Type "screenshot" -Label "local_group"
      if ($region) { $regions.Add($region) }
    }
    return $regions.ToArray()
  }

  $regionType = $null
  $regionLabel = $null
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
  if ($shapeIdentity -match '(?i)(logo|client|customer|project|identifier|footer|header|로고|고객|회사명|기관명|과제)') {
    $regionType = "logo"
    $regionLabel = "local_logo"
  }
  switch ($shapeType) {
    3 { if (-not $regionType) { $regionType = "chart_label"; $regionLabel = "local_chart" } }
    7 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_embedded_object" } }
    10 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_linked_object" } }
    11 { if (-not $regionType) { $regionType = "embedded_photo"; $regionLabel = "local_linked_picture" } }
    12 { if (-not $regionType) { $regionType = "screenshot"; $regionLabel = "local_control" } }
    13 { if (-not $regionType) { $regionType = "embedded_photo"; $regionLabel = "local_picture" } }
    # msoTextEffect (WordArt) often exposes text through TextEffect.Text rather
    # than TextFrame. Always redact its complete bounds; never classify it as a
    # decorative vector primitive.
    15 { if (-not $regionType) { $regionType = "body_text"; $regionLabel = "local_body_text" } }
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

  if (-not $regionType -and (Test-ShapeHasPictureFill -Shape $Shape)) {
    $regionType = "embedded_photo"
    $regionLabel = "local_picture_fill"
  }
  if (-not $regionType -and (Test-ShapeHasText -Shape $Shape)) {
    $classification = Get-ShapeTextClassification -Shape $Shape
    switch ($classification) {
      "generic_large_title" { return $regions.ToArray() }
      "identifier" { $regionType = "client_identifier"; $regionLabel = "local_identifier" }
      "footer" { $regionType = "footer"; $regionLabel = "local_footer" }
      "small_text" { $regionType = "small_text"; $regionLabel = "local_small_text" }
      default { $regionType = "body_text"; $regionLabel = "local_body_text" }
    }
  }

  # Known vector-only primitives are safe when they contain no text or image
  # fill. Every other unreadable shape is ambiguous and is redacted.
  $knownVectorOnlyType = $shapeType -in @(1, 2, 5, 9, 14, 17)
  if (-not $regionType -and -not $knownVectorOnlyType) {
    $regionType = "screenshot"
    $regionLabel = "local_ambiguous"
  }
  if ($regionType) {
    $region = New-LocalRedactionRegion -Shape $Shape -SlideIndex $SlideIndex `
      -SlideWidth $SlideWidth -SlideHeight $SlideHeight `
      -Type $regionType -Label $regionLabel
    if ($region) { $regions.Add($region) }
  }
  return $regions.ToArray()
}

function Get-SlideRedactionRegions {
  param(
    [Parameter(Mandatory = $true)]$Slide,
    [Parameter(Mandatory = $true)][int]$SlideIndex,
    [Parameter(Mandatory = $true)][double]$SlideWidth,
    [Parameter(Mandatory = $true)][double]$SlideHeight
  )

  $regions = New-Object System.Collections.Generic.List[object]
  $inspectionFailed = $false
  $hasPictureBackground = $false
  try {
    $slideBackground = $Slide.Background
    $slideBackgroundFill = if ($null -ne $slideBackground) { $slideBackground.Fill } else { $null }
    $slideBackgroundType = if ($null -ne $slideBackgroundFill) { $slideBackgroundFill.Type } else { $null }
    if ($null -eq $slideBackgroundType) {
      throw "PowerPoint returned no slide background fill type."
    }
    $hasPictureBackground = [int]$slideBackgroundType -in @(4, 6)
  } catch {
    $inspectionFailed = $true
  }
  try {
    $customLayout = $Slide.CustomLayout
    $customBackground = if ($null -ne $customLayout) { $customLayout.Background } else { $null }
    $customBackgroundFill = if ($null -ne $customBackground) { $customBackground.Fill } else { $null }
    $customBackgroundType = if ($null -ne $customBackgroundFill) { $customBackgroundFill.Type } else { $null }
    if ($null -eq $customBackgroundType) {
      throw "PowerPoint returned no custom-layout background fill type."
    }
    $hasPictureBackground = $hasPictureBackground -or ([int]$customBackgroundType -in @(4, 6))
  } catch {
    $inspectionFailed = $true
  }
  try {
    $master = $Slide.Master
    $masterBackground = if ($null -ne $master) { $master.Background } else { $null }
    $masterBackgroundFill = if ($null -ne $masterBackground) { $masterBackground.Fill } else { $null }
    $masterBackgroundType = if ($null -ne $masterBackgroundFill) { $masterBackgroundFill.Type } else { $null }
    if ($null -eq $masterBackgroundType) {
      throw "PowerPoint returned no master background fill type."
    }
    $hasPictureBackground = $hasPictureBackground -or ([int]$masterBackgroundType -in @(4, 6))
  } catch {
    $inspectionFailed = $true
  }
  if ($hasPictureBackground) {
    $regions.Add([PSCustomObject]@{
      slideIndex = $SlideIndex
      type = "embedded_photo"
      label = "local_picture_fill"
      x = [double]0
      y = [double]0
      width = [double]1
      height = [double]1
    })
  }
  $shapeCollections = New-Object System.Collections.Generic.List[object]
  try {
    $slideShapes = $Slide.Shapes
    if ($null -eq $slideShapes) { throw "PowerPoint returned no slide Shapes collection." }
    $shapeCollections.Add($slideShapes)
  } catch { $inspectionFailed = $true }
  try {
    $layoutShapes = $Slide.CustomLayout.Shapes
    if ($null -eq $layoutShapes) { throw "PowerPoint returned no layout Shapes collection." }
    $shapeCollections.Add($layoutShapes)
  } catch { $inspectionFailed = $true }
  try {
    $masterShapes = $Slide.Master.Shapes
    if ($null -eq $masterShapes) { throw "PowerPoint returned no master Shapes collection." }
    $shapeCollections.Add($masterShapes)
  } catch { $inspectionFailed = $true }
  foreach ($shapeCollection in $shapeCollections) {
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
            -SlideHeight $SlideHeight)) {
            if ($region) { $regions.Add($region) }
          }
        } catch {
          # One readable shape elsewhere on the slide must not hide this
          # failure. Record it and replace every partial region with a
          # full-slide fail-closed region below.
          $inspectionFailed = $true
        } finally {
          if ($shape) {
            try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shape) | Out-Null } catch {}
          }
        }
      }
    } catch {
      $inspectionFailed = $true
    } finally {
      if ($shapeCollection) {
        try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shapeCollection) | Out-Null } catch {}
      }
    }
  }
  if ($inspectionFailed) {
    return @((New-FullSlideRedactionRegion -SlideIndex $SlideIndex))
  }
  return $regions.ToArray()
}

function Convert-Document {
  param(
    [string]$JobId,
    [string]$SourceUrl,
    [string]$FileName,
    [string]$SourceAuthorization
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
      $skippedSlideNumbers = New-Object System.Collections.Generic.List[int]
      foreach ($zeroBasedIndex in $representativeIndexes) {
        $slideNumber = $zeroBasedIndex + 1
        $slide = $null
        try {
          $slide = $presentation.Slides.Item($slideNumber)
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
            $exportedSlideIndex = $slidePaths.Count
            $redactionRegions = @(Get-SlideRedactionRegions `
              -Slide $slide `
              -SlideIndex $exportedSlideIndex `
              -SlideWidth $slideWidth `
              -SlideHeight $slideHeight)
            if ($redactionRegions.Count -eq 0) {
              # A slide with no readable shape geometry is not treated as
              # public. Blur the entire exported slide instead of guessing.
              $redactionRegions = @(
                New-FullSlideRedactionRegion -SlideIndex $exportedSlideIndex
              )
            }
            $localRedactionSlides.Add([PSCustomObject]@{
              slideIndex = $exportedSlideIndex
              sourceSlideNumber = $slideNumber
              regions = @($redactionRegions)
            })
            $slidePaths.Add($path)
          } else {
            $skippedSlideNumbers.Add($slideNumber)
            Write-WorkerLog "Skipping slide $slideNumber because PowerPoint did not create a usable PNG after 3 attempts."
          }
        } finally {
          if ($slide) {
            [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($slide) | Out-Null
          }
        }
      }
      if ($skippedSlideNumbers.Count -gt 0) {
        Write-WorkerLog "Skipped $($skippedSlideNumbers.Count) unexportable slide(s): $($skippedSlideNumbers -join ', ')."
      }
      Write-WorkerLog "Selected $($slidePaths.Count) representative slides from $($presentation.Slides.Count) total slides."
      $localRedactionManifest = [PSCustomObject]@{
        version = 1
        method = "powerpoint_com_shapes_v1"
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
      capabilities = @("powerpoint_local_redaction_manifest_v1")
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
          -SourceAuthorization $sourceAuthorizationHeader
      } catch {
        $message = $_.Exception.Message
        Write-WorkerLog "Failed job $($claim.job.id): $message"
        $retryable = -not (
          $message.StartsWith("NON_PRESENTATION_LAYOUT:") -or
          $message.StartsWith("MISSING_FONTS:") -or
          $message.StartsWith("MISSING_PDF_RENDERER:") -or
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
