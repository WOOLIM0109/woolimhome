[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$RequestPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function Write-ProtocolLine {
  param([Parameter(Mandatory = $true)]$Value)

  $json = $Value | ConvertTo-Json -Compress -Depth 10
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Throw-PreparationError {
  param(
    [Parameter(Mandatory = $true)][string]$Code,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $exception = New-Object System.InvalidOperationException($Message)
  $exception.Data["WoolimPreparationCode"] = $Code
  throw $exception
}

function Get-Sha256FileHash {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = $null
  $algorithm = $null
  try {
    # Do not depend on module autoloading inherited from PowerShell 7 when this
    # adapter launches Windows PowerShell 5.1 with -NoProfile.
    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } catch {
    Throw-PreparationError -Code "SOURCE_HASH_FAILED" -Message ("The source file hash could not be calculated: " + $_.Exception.Message)
  } finally {
    if ($stream) { $stream.Dispose() }
    if ($algorithm) { $algorithm.Dispose() }
  }
}

function Get-Sha256TextHash {
  param([Parameter(Mandatory = $true)][string]$Text)

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $utf8.GetBytes($Text)
    $hash = $sha256.ComputeHash($bytes)
    return ([BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Get-PowerPointRegistration {
  $registered = $null -ne [Type]::GetTypeFromProgID("PowerPoint.Application")
  $registeredClass = $null
  $version = $null

  try {
    $curVerKey = Get-Item -LiteralPath "Registry::HKEY_CLASSES_ROOT\PowerPoint.Application\CurVer" -ErrorAction Stop
    $registeredClass = [string]$curVerKey.GetValue("")
  } catch {}

  foreach ($configurationPath in @(
    "HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Office\ClickToRun\Configuration"
  )) {
    try {
      $configuration = Get-ItemProperty -LiteralPath $configurationPath -ErrorAction Stop
      foreach ($propertyName in @("VersionToReport", "ClientVersionToReport")) {
        $candidate = [string]$configuration.$propertyName
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
          $version = $candidate.Trim()
          break
        }
      }
    } catch {}
    if ($version) { break }
  }

  if (-not $version -and $registeredClass -match '(\d+)$') {
    $version = $Matches[1]
  }

  return [PSCustomObject]@{
    available = $registered
    registeredClass = if ($registeredClass) { $registeredClass } else { $null }
    version = if ($version) { $version } else { $null }
  }
}

function Get-FontInventory {
  Add-Type -AssemblyName System.Drawing
  $installed = New-Object System.Drawing.Text.InstalledFontCollection
  $families = New-Object System.Collections.Generic.List[object]
  try {
    foreach ($family in $installed.Families) {
      $english = $null
      $korean = $null
      try { $english = ([string]$family.GetName(1033)).Trim() } catch {}
      try { $korean = ([string]$family.GetName(1042)).Trim() } catch {}
      if (-not $english) {
        try { $english = ([string]$family.Name).Trim() } catch {}
      }
      if (-not $korean) { $korean = $english }
      if ($english -or $korean) {
        $families.Add([PSCustomObject]@{
          english = if ($english) { $english } else { $null }
          korean = if ($korean) { $korean } else { $null }
        })
      }
    }
  } finally {
    $installed.Dispose()
  }

  $fontRoots = New-Object System.Collections.Generic.List[object]
  if ($env:WINDIR) {
    $fontRoots.Add([PSCustomObject]@{ label = "system"; path = (Join-Path $env:WINDIR "Fonts") })
  }
  if ($env:LOCALAPPDATA) {
    $fontRoots.Add([PSCustomObject]@{ label = "user"; path = (Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Fonts") })
  }

  $fontFileEntries = New-Object System.Collections.Generic.List[string]
  foreach ($root in $fontRoots) {
    if (-not (Test-Path -LiteralPath $root.path -PathType Container)) { continue }
    foreach ($file in @(Get-ChildItem -LiteralPath $root.path -File -Recurse -ErrorAction SilentlyContinue)) {
      if ($file.Extension.ToLowerInvariant() -notin @(".ttf", ".otf", ".ttc", ".otc", ".fon")) { continue }
      $fontFileEntries.Add((
        "{0}|{1}|{2}|{3}" -f
          $root.label,
          $file.Name.ToLowerInvariant(),
          $file.Length,
          $file.LastWriteTimeUtc.Ticks
      ))
    }
  }

  $sortedFamilies = @($families | Sort-Object english, korean)
  $sortedFiles = @($fontFileEntries | Sort-Object -Unique)
  $fileListHash = Get-Sha256TextHash -Text ($sortedFiles -join "`n")
  $familyFingerprintLines = @($sortedFamilies | ForEach-Object {
    "{0}|{1}" -f ([string]$_.english).ToLowerInvariant(), ([string]$_.korean).ToLowerInvariant()
  })

  return [PSCustomObject]@{
    familyCount = $sortedFamilies.Count
    families = $sortedFamilies
    fileCount = $sortedFiles.Count
    fileListHash = $fileListHash
    familyListHash = Get-Sha256TextHash -Text ($familyFingerprintLines -join "`n")
  }
}

function Resolve-ExistingDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Code
  )

  try {
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
    if (-not $item.PSIsContainer) {
      Throw-PreparationError -Code $Code -Message "The requested output path is not a directory."
    }
    return [System.IO.Path]::GetFullPath($item.FullName)
  } catch {
    if ($_.Exception.Data["WoolimPreparationCode"]) { throw }
    Throw-PreparationError -Code $Code -Message "The requested output directory does not exist."
  }
}

function Resolve-ExportOutputDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$OutputRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
  )

  $root = Resolve-ExistingDirectory -Path $OutputRoot -Code "INVALID_OUTPUT_ROOT"
  $output = Resolve-ExistingDirectory -Path $OutputDirectory -Code "INVALID_OUTPUT_DIRECTORY"
  $rootPrefix = $root.TrimEnd([char[]]@(92, 47)) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $output.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Throw-PreparationError -Code "INVALID_OUTPUT_DIRECTORY" -Message "The export attempt directory must stay inside its declared output root."
  }
  $leaf = [System.IO.Path]::GetFileName($output.TrimEnd([char[]]@(92, 47)))
  if ($leaf -notmatch '^attempt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
    Throw-PreparationError -Code "INVALID_OUTPUT_DIRECTORY" -Message "The export directory is not a unique adapter attempt directory."
  }
  $outputItem = Get-Item -LiteralPath $output -Force
  if (($outputItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    Throw-PreparationError -Code "INVALID_OUTPUT_DIRECTORY" -Message "A reparse point cannot be used as an export attempt directory."
  }
  if (@(Get-ChildItem -LiteralPath $output -Force).Count -ne 0) {
    Throw-PreparationError -Code "OUTPUT_DIRECTORY_NOT_EMPTY" -Message "The export attempt directory must be empty."
  }
  return $output
}

function Get-ImageDimensions {
  param([Parameter(Mandatory = $true)][string]$Path)

  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($Path)
  try {
    return [PSCustomObject]@{ width = [int]$image.Width; height = [int]$image.Height }
  } finally {
    $image.Dispose()
  }
}

function Remove-ReadOnlyFile {
  param([string]$Path)

  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  try { (Get-Item -LiteralPath $Path -Force).IsReadOnly = $false } catch {}
  try { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue } catch {}
}

function Invoke-InventoryOperation {
  $registration = Get-PowerPointRegistration
  $fontInventory = Get-FontInventory
  $fingerprintMaterial = @(
    "registered=$($registration.available)",
    "class=$($registration.registeredClass)",
    "version=$($registration.version)",
    "families=$($fontInventory.familyListHash)",
    "files=$($fontInventory.fileListHash)"
  ) -join "`n"

  Write-ProtocolLine ([PSCustomObject]@{
    type = "complete"
    operation = "inventory"
    available = [bool]$registration.available
    powerPointVersion = $registration.version
    registeredClass = $registration.registeredClass
    fontInventory = [PSCustomObject]@{
      familyCount = [int]$fontInventory.familyCount
      families = @($fontInventory.families)
      fileCount = [int]$fontInventory.fileCount
      fileListHash = [string]$fontInventory.fileListHash
      fingerprint = Get-Sha256TextHash -Text $fingerprintMaterial
    }
  })
}

function Invoke-ExportOperation {
  param([Parameter(Mandatory = $true)]$Request)

  $sourcePath = [string]$Request.sourcePath
  $expectedSourceHash = ([string]$Request.sourceHash).Trim().ToLowerInvariant()
  $outputRoot = [string]$Request.outputRoot
  $requestedOutputDirectory = [string]$Request.outputDirectory
  $longEdge = 0
  if (-not [int]::TryParse([string]$Request.longEdge, [ref]$longEdge) -or $longEdge -notin @(800, 2400)) {
    Throw-PreparationError -Code "INVALID_LONG_EDGE" -Message "The export long edge must be 800 or 2400 pixels."
  }
  if ($expectedSourceHash -notmatch '^[0-9a-f]{64}$') {
    Throw-PreparationError -Code "INVALID_SOURCE_HASH" -Message "A SHA-256 source hash is required."
  }
  if ([string]::IsNullOrWhiteSpace($sourcePath) -or -not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    Throw-PreparationError -Code "SOURCE_NOT_FOUND" -Message "The PowerPoint source file does not exist."
  }
  $sourceItem = Get-Item -LiteralPath $sourcePath -Force
  $sourcePath = [System.IO.Path]::GetFullPath($sourceItem.FullName)
  $extension = $sourceItem.Extension.ToLowerInvariant()
  if ($extension -notin @(".ppt", ".pptx", ".pptm")) {
    Throw-PreparationError -Code "UNSUPPORTED_SOURCE" -Message "Only PPT, PPTX, and PPTM files can be exported."
  }
  $outputDirectory = Resolve-ExportOutputDirectory `
    -OutputRoot $outputRoot `
    -OutputDirectory $requestedOutputDirectory

  $slideNumbers = New-Object System.Collections.Generic.List[int]
  $seenSlideNumbers = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($rawSlideNumber in @($Request.slideNumbers)) {
    $slideNumber = 0
    if (-not [int]::TryParse([string]$rawSlideNumber, [ref]$slideNumber) -or $slideNumber -lt 1) {
      Throw-PreparationError -Code "INVALID_SLIDE_NUMBERS" -Message "Every requested slide number must be a positive one-based integer."
    }
    if (-not $seenSlideNumbers.Add($slideNumber)) {
      Throw-PreparationError -Code "INVALID_SLIDE_NUMBERS" -Message "Requested slide numbers must not contain duplicates."
    }
    $slideNumbers.Add($slideNumber)
  }
  if ($slideNumbers.Count -lt 1 -or $slideNumbers.Count -gt 10000) {
    Throw-PreparationError -Code "INVALID_SLIDE_NUMBERS" -Message "Between 1 and 10000 unique slide numbers are required."
  }

  $beforeHash = Get-Sha256FileHash -Path $sourcePath
  if ($beforeHash -ne $expectedSourceHash) {
    Throw-PreparationError -Code "SOURCE_HASH_MISMATCH" -Message "The source file no longer matches the prepared source hash."
  }
  if (@(Get-Process -Name "POWERPNT" -ErrorAction SilentlyContinue).Count -gt 0) {
    Throw-PreparationError -Code "POWERPOINT_BUSY" -Message "PowerPoint is already running. Close it before preparing slides."
  }

  $mutex = New-Object System.Threading.Mutex($false, "Local\WoolimPowerPointPreparation")
  $ownsMutex = $false
  $copyPath = $null
  $powerPoint = $null
  $presentation = $null
  $ownedPresentationOpened = $false
  $presentationClosed = $false
  $previousAutomationSecurity = $null
  $ownedProcessIds = @()
  $quitRequested = $false
  $shutdownIncomplete = $false
  $exportWidth = 0
  $exportHeight = 0
  $slideWidth = 0.0
  $slideHeight = 0.0
  $completedSlideNumbers = New-Object System.Collections.Generic.List[int]
  try {
    try {
      $ownsMutex = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $ownsMutex = $true
    }
    if (-not $ownsMutex) {
      Throw-PreparationError -Code "POWERPOINT_BUSY" -Message "Another local slide preparation is already using PowerPoint."
    }
    # Close the race between the first process check and the adapter mutex.
    # Never attach to, close, or kill a user-owned PowerPoint process.
    if (@(Get-Process -Name "POWERPNT" -ErrorAction SilentlyContinue).Count -gt 0) {
      Throw-PreparationError -Code "POWERPOINT_BUSY" -Message "PowerPoint is already running. Close it before preparing slides."
    }

    # The source itself is never opened. PowerPoint receives only this local,
    # read-only attempt copy, and that copy is deleted in the finalizer.
    $copyPath = Join-Path $outputDirectory (".source-copy-{0}{1}" -f ([Guid]::NewGuid().ToString("N")), $extension)
    Copy-Item -LiteralPath $sourcePath -Destination $copyPath -Force
    (Get-Item -LiteralPath $copyPath -Force).IsReadOnly = $true
    if ((Get-Sha256FileHash -Path $copyPath) -ne $expectedSourceHash) {
      Throw-PreparationError -Code "SOURCE_COPY_HASH_MISMATCH" -Message "The local read-only source copy failed integrity verification."
    }

    $powerPointType = [Type]::GetTypeFromProgID("PowerPoint.Application")
    if ($null -eq $powerPointType) {
      Throw-PreparationError -Code "POWERPOINT_NOT_AVAILABLE" -Message "Microsoft PowerPoint is not registered on this PC."
    }
    try {
      $powerPoint = [Activator]::CreateInstance($powerPointType)
      $ownedProcessIds = @(Get-Process -Name "POWERPNT" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    } catch {
      Throw-PreparationError -Code "POWERPOINT_START_FAILED" -Message "Microsoft PowerPoint could not be started for local export."
    }
    try {
      $previousAutomationSecurity = $powerPoint.AutomationSecurity
      # msoAutomationSecurityForceDisable. This is process-local and is restored
      # before releasing the application; it does not change a system policy.
      $powerPoint.AutomationSecurity = 3
    } catch {
      Throw-PreparationError -Code "MACRO_SECURITY_FAILED" -Message "PowerPoint macro execution could not be disabled."
    }
    try {
      # ReadOnly=true, Untitled=false, WithWindow=false.
      $presentation = $powerPoint.Presentations.Open($copyPath, -1, 0, 0)
      $ownedPresentationOpened = $true
    } catch {
      Throw-PreparationError -Code "POWERPOINT_OPEN_FAILED" -Message "PowerPoint could not open the local read-only source copy."
    }
    if ($null -eq $presentation -or [int]$presentation.ReadOnly -eq 0) {
      Throw-PreparationError -Code "READ_ONLY_OPEN_FAILED" -Message "PowerPoint did not open the preparation copy as read-only."
    }

    $slideCount = [int]$presentation.Slides.Count
    foreach ($slideNumber in $slideNumbers) {
      if ($slideNumber -gt $slideCount) {
        Throw-PreparationError -Code "SLIDE_NUMBER_OUT_OF_RANGE" -Message "A requested slide number is outside the source presentation."
      }
    }

    $slideWidth = [double]$presentation.PageSetup.SlideWidth
    $slideHeight = [double]$presentation.PageSetup.SlideHeight
    if ($slideWidth -le 0 -or $slideHeight -le 0 `
      -or [double]::IsNaN($slideWidth) -or [double]::IsNaN($slideHeight) `
      -or [double]::IsInfinity($slideWidth) -or [double]::IsInfinity($slideHeight)) {
      Throw-PreparationError -Code "INVALID_PAGE_SETUP" -Message "PowerPoint returned invalid slide dimensions."
    }
    if ($null -ne $Request.expectedSlideWidth -or $null -ne $Request.expectedSlideHeight) {
      $expectedWidth = [double]$Request.expectedSlideWidth
      $expectedHeight = [double]$Request.expectedSlideHeight
      if ($expectedWidth -le 0 -or $expectedHeight -le 0 -or
        [Math]::Abs($slideWidth / $expectedWidth - 1) -gt 0.001 -or
        [Math]::Abs($slideHeight / $expectedHeight - 1) -gt 0.001) {
        Throw-PreparationError -Code "POWERPOINT_PAGE_SETUP_MISMATCH" -Message "PowerPoint page size does not match the inspected OOXML source."
      }
    }
    if ($slideWidth -ge $slideHeight) {
      $exportWidth = $longEdge
      $exportHeight = [Math]::Max(1, [int][Math]::Round($longEdge * $slideHeight / $slideWidth))
    } else {
      $exportHeight = $longEdge
      $exportWidth = [Math]::Max(1, [int][Math]::Round($longEdge * $slideWidth / $slideHeight))
    }

    foreach ($slideNumber in $slideNumbers) {
      $slide = $null
      try {
        $slide = $presentation.Slides.Item($slideNumber)
        if ($null -eq $slide) {
          Throw-PreparationError -Code "SLIDE_NOT_FOUND" -Message "PowerPoint returned no slide for a requested source number."
        }
        $baseName = "slide-{0:D4}.png" -f $slideNumber
        $finalPath = Join-Path $outputDirectory $baseName
        $temporaryPath = Join-Path $outputDirectory (
          "slide-{0:D4}.{1}.tmp.png" -f $slideNumber, ([Guid]::NewGuid().ToString("N"))
        )
        if (Test-Path -LiteralPath $finalPath) {
          Throw-PreparationError -Code "OUTPUT_COLLISION" -Message "A final slide output already exists in the unique attempt directory."
        }

        try {
          # One COM export call only. A missing file is polled for a bounded five
          # seconds and reported; it is not retried in the background.
          $slide.Export($temporaryPath, "PNG", $exportWidth, $exportHeight)
        } catch {
          Throw-PreparationError -Code "SLIDE_EXPORT_FAILED" -Message "PowerPoint failed to export a requested slide."
        }
        $ready = $false
        for ($poll = 0; $poll -lt 40; $poll++) {
          if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            $temporaryItem = Get-Item -LiteralPath $temporaryPath -ErrorAction SilentlyContinue
            if ($temporaryItem -and $temporaryItem.Length -gt 1024) {
              $ready = $true
              break
            }
          }
          Start-Sleep -Milliseconds 125
        }
        if (-not $ready) {
          Throw-PreparationError -Code "SLIDE_EXPORT_TIMEOUT" -Message "PowerPoint did not create a usable slide PNG within five seconds."
        }

        $dimensions = Get-ImageDimensions -Path $temporaryPath
        if ($dimensions.width -ne $exportWidth -or $dimensions.height -ne $exportHeight) {
          Throw-PreparationError -Code "PAGE_SETUP_MISMATCH" -Message "The exported PNG dimensions do not match the PowerPoint PageSetup ratio."
        }
        Move-Item -LiteralPath $temporaryPath -Destination $finalPath
        $finalPath = [System.IO.Path]::GetFullPath($finalPath)
        $completedSlideNumbers.Add($slideNumber)
        Write-ProtocolLine ([PSCustomObject]@{
          type = "slide"
          sourceSlideNumber = $slideNumber
          path = $finalPath
          width = $dimensions.width
          height = $dimensions.height
        })
      } finally {
        if ($slide) {
          try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($slide) | Out-Null } catch {}
        }
      }
    }
  } finally {
    if ($presentation) {
      try {
        $presentation.Close()
        $presentationClosed = $true
      } catch {}
      try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) | Out-Null } catch {}
      $presentation = $null
    }
    if ($powerPoint) {
      if ($null -ne $previousAutomationSecurity) {
        try { $powerPoint.AutomationSecurity = $previousAutomationSecurity } catch {}
      }
      # Close only the document opened above. Quit the application only when no
      # other document appeared in that instance while the export was running.
      $remainingPresentations = -1
      try { $remainingPresentations = [int]$powerPoint.Presentations.Count } catch {}
      $ownedDocumentClosed = (-not $ownedPresentationOpened) -or $presentationClosed
      if ($ownedDocumentClosed -and $remainingPresentations -eq 0) {
        try { $powerPoint.Quit(); $quitRequested = $true } catch {}
      }
      try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null } catch {}
      $powerPoint = $null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    if ($copyPath -and (Test-Path -LiteralPath $copyPath -PathType Leaf)) {
      $copyHash = Get-Sha256FileHash -Path $copyPath
      if ($copyHash -ne $expectedSourceHash) {
        Remove-ReadOnlyFile -Path $copyPath
        Throw-PreparationError -Code "SOURCE_COPY_CHANGED" -Message "PowerPoint changed the local read-only source copy."
      }
    }
    Remove-ReadOnlyFile -Path $copyPath
    if ($quitRequested) {
      # Quit can return before POWERPNT exits. Wait only for this attempt's
      # process, without killing it or restarting another conversion.
      foreach ($ownedProcessId in $ownedProcessIds) {
        $closingProcess = Get-Process -Id $ownedProcessId -ErrorAction SilentlyContinue
        if ($closingProcess) {
          try { if (-not $closingProcess.WaitForExit(20000)) { $shutdownIncomplete = $true } } catch {}
          finally { $closingProcess.Dispose() }
        }
      }
    }
    if ($ownsMutex) {
      try { $mutex.ReleaseMutex() } catch {}
    }
    if ($mutex) { $mutex.Dispose() }
  }
  if ($shutdownIncomplete) {
    Throw-PreparationError -Code "POWERPOINT_SHUTDOWN_PENDING" -Message "PowerPoint is still closing. Completed pages are saved; no conversion was restarted."
  }
  $afterHash = Get-Sha256FileHash -Path $sourcePath
  if ($afterHash -ne $expectedSourceHash) {
    Throw-PreparationError -Code "SOURCE_CHANGED" -Message "The original source file changed during slide preparation."
  }
  Write-ProtocolLine ([PSCustomObject]@{
    type = "complete"
    operation = "export"
    sourceHash = $expectedSourceHash
    outputDirectory = $outputDirectory
    slideCount = $completedSlideNumbers.Count
    sourceSlideNumbers = $completedSlideNumbers.ToArray()
    slideWidth = $slideWidth
    slideHeight = $slideHeight
    exportWidth = $exportWidth
    exportHeight = $exportHeight
  })
}

try {
  if (-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)) {
    Throw-PreparationError -Code "REQUEST_NOT_FOUND" -Message "The preparation request file does not exist."
  }
  try {
    $requestJson = [System.IO.File]::ReadAllText(
      (Resolve-Path -LiteralPath $RequestPath).Path,
      [System.Text.Encoding]::UTF8
    )
    $request = $requestJson | ConvertFrom-Json
  } catch {
    Throw-PreparationError -Code "INVALID_REQUEST" -Message "The preparation request is not valid UTF-8 JSON."
  }
  $operation = ([string]$request.operation).Trim().ToLowerInvariant()
  switch ($operation) {
    "inventory" { Invoke-InventoryOperation; break }
    "export" { Invoke-ExportOperation -Request $request; break }
    default {
      Throw-PreparationError -Code "INVALID_OPERATION" -Message "The preparation operation must be inventory or export."
    }
  }
} catch {
  $code = [string]$_.Exception.Data["WoolimPreparationCode"]
  if ([string]::IsNullOrWhiteSpace($code)) { $code = "POWERPOINT_PREPARATION_FAILED" }
  $message = ([string]$_.Exception.Message -replace '[\r\n]+', ' ').Trim()
  if ([string]::IsNullOrWhiteSpace($message)) { $message = "Local PowerPoint preparation failed." }
  Write-ProtocolLine ([PSCustomObject]@{
    type = "error"
    code = $code
    message = $message
  })
  exit 1
}
