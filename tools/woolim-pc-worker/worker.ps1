param(
  [switch]$Once
)

$ErrorActionPreference = "Stop"
$WorkerVersion = "1.0.0"
$ServerUrl = if ($env:WOOLIM_WORKER_SERVER_URL) {
  $env:WOOLIM_WORKER_SERVER_URL.TrimEnd("/")
} else {
  "https://woolim-site.vercel.app"
}
$WorkerSecret = $env:WOOLIM_PC_WORKER_SECRET
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
    [string]$ContentType
  )
  Invoke-WebRequest `
    -Uri $SignedUrl `
    -Method Post `
    -Headers @{ "x-upsert" = "true"; "cache-control" = "max-age=3600" } `
    -ContentType $ContentType `
    -InFile $FilePath `
    -UseBasicParsing | Out-Null
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
  Invoke-WebRequest -Uri $SourceUrl -OutFile $SourcePath -UseBasicParsing

  $powerPoint = $null
  $presentation = $null
  try {
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $powerPointVersion = [string]$powerPoint.Version
    Send-Heartbeat -Status "busy" -CurrentJobId $JobId -PowerPointVersion $powerPointVersion
    $presentation = $powerPoint.Presentations.Open($SourcePath, $true, $false, $false)
    $presentation.SaveAs($PdfPath, 32)

    $slideWidth = [double]$presentation.PageSetup.SlideWidth
    $slideHeight = [double]$presentation.PageSetup.SlideHeight
    $exportWidth = 2000
    $exportHeight = [Math]::Max(1, [int][Math]::Round($exportWidth * $slideHeight / $slideWidth))
    $slidePaths = New-Object System.Collections.Generic.List[string]
    foreach ($slide in $presentation.Slides) {
      $path = Join-Path $SlidesRoot ("slide-{0:D3}.png" -f [int]$slide.SlideIndex)
      $slide.Export($path, "PNG", $exportWidth, $exportHeight)
      $slidePaths.Add($path)
    }
    $presentation.Close()
    $presentation = $null
    $powerPoint.Quit()
    $powerPoint = $null

    $uploadPlan = Invoke-WorkerApi -Path "/api/worker/jobs/uploads" -Body @{
      jobId = $JobId
      slideCount = $slidePaths.Count
    }
    $pdfUpload = $uploadPlan.uploads | Where-Object { $_.kind -eq "pdf" } | Select-Object -First 1
    Upload-SignedFile -SignedUrl $pdfUpload.signedUrl -FilePath $PdfPath -ContentType "application/pdf"
    $uploadedSlides = New-Object System.Collections.Generic.List[string]
    foreach ($upload in ($uploadPlan.uploads | Where-Object { $_.kind -eq "slide" } | Sort-Object index)) {
      $localSlide = $slidePaths[[int]$upload.index - 1]
      Upload-SignedFile -SignedUrl $upload.signedUrl -FilePath $localSlide -ContentType "image/png"
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
        try {
          Invoke-WorkerApi -Path "/api/worker/jobs/fail" -Body @{
            jobId = [string]$claim.job.id
            error = $message
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
