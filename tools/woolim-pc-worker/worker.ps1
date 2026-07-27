param(
  [switch]$Once
)

$ErrorActionPreference = "Stop"
$WorkerVersion = "1.0.0"
$ConfiguredServerUrl = if ($env:WOOLIM_WORKER_SERVER_URL) {
  $env:WOOLIM_WORKER_SERVER_URL
} else {
  [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_SERVER_URL", "User")
}
$ServerUrl = if ($ConfiguredServerUrl) {
  $ConfiguredServerUrl.TrimEnd("/")
} else {
  "https://woolim-site.vercel.app"
}
$WorkerSecret = if ($env:WOOLIM_PC_WORKER_SECRET) {
  $env:WOOLIM_PC_WORKER_SECRET
} else {
  [Environment]::GetEnvironmentVariable("WOOLIM_PC_WORKER_SECRET", "User")
}
$WorkerRoot = Join-Path $env:LOCALAPPDATA "WoolimWorker"
$LogPath = Join-Path $WorkerRoot "worker.log"

New-Item -ItemType Directory -Force -Path $WorkerRoot | Out-Null

function Write-WorkerLog {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Invoke-WorkerApi {
  param(
    [string]$Path,
    [hashtable]$Body
  )
  Invoke-RestMethod `
    -Uri "$ServerUrl$Path" `
    -Method Post `
    -Headers @{ Authorization = "Bearer $WorkerSecret" } `
    -ContentType "application/json; charset=utf-8" `
    -Body ($Body | ConvertTo-Json -Depth 10 -Compress)
}

function Send-Heartbeat {
  param(
    [string]$Status = "online",
    [string]$CurrentJobId = $null,
    [string]$Message = $null,
    [string]$PowerPointVersion = $null
  )
  $payload = @{
    status = $Status
    currentJobId = $CurrentJobId
    error = $Message
    computerName = $env:COMPUTERNAME
    powerPointVersion = $PowerPointVersion
    workerVersion = $WorkerVersion
  }
  Invoke-WorkerApi -Path "/api/worker/heartbeat" -Body $payload | Out-Null
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
    [string]$SourcePath
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
      & curl.exe `
        --fail `
        --location `
        --silent `
        --show-error `
        --retry 2 `
        --retry-delay 2 `
        --connect-timeout 30 `
        --max-time 600 `
        --output $SourcePath `
        $SourceUrl
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

function Convert-Presentation {
  param(
    [string]$JobId,
    [string]$SourceUrl,
    [string]$FileName
  )
  $JobRoot = Join-Path $WorkerRoot "jobs\$JobId"
  $SlidesRoot = Join-Path $JobRoot "slides"
  New-Item -ItemType Directory -Force -Path $SlidesRoot | Out-Null
  $extension = [System.IO.Path]::GetExtension($FileName)
  $SourcePath = Join-Path $JobRoot ("source" + $extension)
  $PdfPath = Join-Path $JobRoot "presentation.pdf"
  Get-SourceFile -SourceUrl $SourceUrl -SourcePath $SourcePath

  $powerPoint = $null
  $presentation = $null
  $pdfPresentation = $null
  try {
    Write-WorkerLog "Starting PowerPoint conversion."
    Add-Type -AssemblyName Microsoft.Office.Interop.PowerPoint
    $powerPoint = New-Object Microsoft.Office.Interop.PowerPoint.ApplicationClass
    $powerPointVersion = [string]$powerPoint.Version
    Send-Heartbeat -Status "busy" -CurrentJobId $JobId -PowerPointVersion $powerPointVersion
    # The local copy must be opened writable; PowerPoint blocks PDF export from a read-only deck.
    $presentation = $powerPoint.Presentations.Open($SourcePath, 0, 0, 0)
    Write-WorkerLog "PowerPoint opened local copy (readOnly=$($presentation.ReadOnly))."
    $slideWidth = [double]$presentation.PageSetup.SlideWidth
    $slideHeight = [double]$presentation.PageSetup.SlideHeight
    $aspectRatio = $slideWidth / $slideHeight
    if ($aspectRatio -lt 1.2 -or $aspectRatio -gt 2.2) {
      throw "NON_PRESENTATION_LAYOUT: Slide ratio $([Math]::Round($aspectRatio, 3)) is not a supported landscape presentation."
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
    $slidePaths = New-Object System.Collections.Generic.List[string]
    foreach ($slide in $presentation.Slides) {
      $path = Join-Path $SlidesRoot ("slide-{0:D3}.png" -f [int]$slide.SlideIndex)
      $slide.Export($path, "PNG", $exportWidth, $exportHeight)
      $slidePaths.Add($path)
    }

    if (Test-Path -LiteralPath $PdfPath) {
      Remove-Item -LiteralPath $PdfPath -Force
    }
    try {
      $presentation.SaveAs($PdfPath, 32)
    } catch {
      Write-WorkerLog "Direct PDF export failed; creating a rasterized review PDF."
      $pdfPresentation = $powerPoint.Presentations.Add()
      $pdfPresentation.PageSetup.SlideWidth = $slideWidth
      $pdfPresentation.PageSetup.SlideHeight = $slideHeight
      foreach ($slidePath in $slidePaths) {
        $pdfSlide = $pdfPresentation.Slides.Add($pdfPresentation.Slides.Count + 1, 12)
        $pdfSlide.Shapes.AddPicture(
          $slidePath,
          0,
          -1,
          0,
          0,
          $slideWidth,
          $slideHeight
        ) | Out-Null
      }
      $pdfPresentation.SaveAs($PdfPath, 32)
      $pdfPresentation.Close()
      [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($pdfPresentation) | Out-Null
      $pdfPresentation = $null
    }
    $presentation.Close()
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) | Out-Null
    $presentation = $null
    $powerPoint.Quit()
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null
    $powerPoint = $null

    Write-WorkerLog "Requesting upload destinations."
    $uploadPlan = Invoke-WorkerApi -Path "/api/worker/jobs/uploads" -Body @{
      jobId = $JobId
      slideCount = $slidePaths.Count
    }
    $pdfUpload = $uploadPlan.uploads | Where-Object { $_.kind -eq "pdf" } | Select-Object -First 1
    Write-WorkerLog "Uploading converted PDF and $($slidePaths.Count) slide images."
    Upload-SignedFile `
      -SignedUrl $pdfUpload.signedUrl `
      -FilePath $PdfPath `
      -ContentType "application/pdf" `
      -Authorization ([string]$uploadPlan.uploadAuthorization)
    $uploadedSlides = New-Object System.Collections.Generic.List[string]
    foreach ($upload in ($uploadPlan.uploads | Where-Object { $_.kind -eq "slide" } | Sort-Object index)) {
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
      pdfPath = [string]$pdfUpload.path
      slidePaths = $uploadedSlides.ToArray()
      powerPointVersion = $powerPointVersion
    } | Out-Null
    Write-WorkerLog "Completed job $JobId with $($slidePaths.Count) slides."
  } finally {
    if ($pdfPresentation) {
      try { $pdfPresentation.Close() } catch {}
    }
    if ($presentation) {
      try { $presentation.Close() } catch {}
    }
    if ($powerPoint) {
      try { $powerPoint.Quit() } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

if (-not $WorkerSecret) {
  Write-WorkerLog "WOOLIM_PC_WORKER_SECRET is not configured."
  exit 2
}

do {
  try {
    Send-Heartbeat
    $claim = Invoke-WorkerApi -Path "/api/worker/jobs/claim" -Body @{}
    if ($claim.job) {
      try {
        Write-WorkerLog "Claimed job $($claim.job.id): $($claim.job.fileName)"
        Convert-Presentation `
          -JobId ([string]$claim.job.id) `
          -SourceUrl ([string]$claim.job.sourceUrl) `
          -FileName ([string]$claim.job.fileName)
      } catch {
        $message = $_.Exception.Message
        Write-WorkerLog "Failed job $($claim.job.id): $message"
        $retryable = -not (
          $message.StartsWith("NON_PRESENTATION_LAYOUT:") -or
          $message.StartsWith("MISSING_FONTS:")
        )
        try {
          Invoke-WorkerApi -Path "/api/worker/jobs/fail" -Body @{
            jobId = [string]$claim.job.id
            error = $message
            retryable = $retryable
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
