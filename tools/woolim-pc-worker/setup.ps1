[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9._-]{1,63}$')]
  [string]$WorkerId,

  [Parameter(Mandatory = $true)]
  [ValidateLength(1, 80)]
  [string]$WorkerName,

  [ValidateNotNullOrEmpty()]
  [string]$ServerUrl = "https://woolim-site.vercel.app",

  [string]$PdfToPpmPath,
  [switch]$ReplaceSecret,
  [switch]$NoAutoStart,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$PreviousWorkerId = [Environment]::GetEnvironmentVariable("WOOLIM_WORKER_ID", "User")

if ($WorkerName -match '[\r\n]') {
  throw "WorkerName must be a single line."
}
$parsedServerUrl = $null
if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$parsedServerUrl)) {
  throw "ServerUrl must be an absolute URL."
}
$isLocalDevelopment = $parsedServerUrl.IsLoopback -and $parsedServerUrl.Scheme -eq "http"
if ($parsedServerUrl.Scheme -ne "https" -and -not $isLocalDevelopment) {
  throw "ServerUrl must use HTTPS (plain HTTP is allowed only for localhost development)."
}
if ($PdfToPpmPath) {
  $resolvedRenderer = $PdfToPpmPath
  if (Test-Path -LiteralPath $resolvedRenderer -PathType Container) {
    $resolvedRenderer = Join-Path $resolvedRenderer "pdftoppm.exe"
  }
  if (-not (Test-Path -LiteralPath $resolvedRenderer -PathType Leaf)) {
    throw "PdfToPpmPath does not contain pdftoppm.exe."
  }
  $PdfToPpmPath = (Resolve-Path -LiteralPath $resolvedRenderer).Path
}

$ExistingSecret = [Environment]::GetEnvironmentVariable("WOOLIM_PC_WORKER_SECRET", "User")
$NeedSecret = [string]::IsNullOrWhiteSpace($ExistingSecret) -or $ReplaceSecret
$PlainSecret = $null
if ($NeedSecret) {
  if ($WhatIfPreference) {
    Write-Host "What if: prompt for a hidden worker secret and store it for the current Windows user."
  } else {
    $SecureSecret = Read-Host "PC worker secret (input is hidden)" -AsSecureString
    $SecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureSecret)
    try {
      $PlainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($SecretPointer)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($SecretPointer)
    }
    if ([string]::IsNullOrWhiteSpace($PlainSecret)) {
      throw "The worker secret cannot be empty."
    }
  }
}

$settings = @{
  WOOLIM_WORKER_ID = $WorkerId
  WOOLIM_WORKER_NAME = $WorkerName
  WOOLIM_WORKER_SERVER_URL = $parsedServerUrl.AbsoluteUri.TrimEnd("/")
}
if ($PdfToPpmPath) {
  $settings.WOOLIM_PDFTOPPM_PATH = $PdfToPpmPath
}
if ($NeedSecret) {
  $settings.WOOLIM_PC_WORKER_SECRET = $PlainSecret
}

if ($WhatIfPreference) {
  foreach ($settingName in $settings.Keys) {
    Write-Host "What if: set $settingName for the current Windows user."
  }
  Write-Host "What if: install worker files and register the per-user logon task."
  exit 0
}

if (
  -not [string]::IsNullOrWhiteSpace($PreviousWorkerId) -and
  $PreviousWorkerId -ne $WorkerId -and
  $PreviousWorkerId -match '^[a-z0-9][a-z0-9._-]{1,63}$' -and
  (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)
) {
  $PreviousTaskName = "Woolim Worker - $PreviousWorkerId"
  $PreviousTask = Get-ScheduledTask -TaskName $PreviousTaskName -ErrorAction SilentlyContinue
  if ($PreviousTask -and $PSCmdlet.ShouldProcess($PreviousTaskName, "Remove task for the previous worker ID")) {
    Stop-ScheduledTask -TaskName $PreviousTaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $PreviousTaskName -Confirm:$false
  }
}

foreach ($setting in $settings.GetEnumerator()) {
  if ($PSCmdlet.ShouldProcess("Current Windows user", "Set $($setting.Key)")) {
    [Environment]::SetEnvironmentVariable($setting.Key, [string]$setting.Value, "User")
    [Environment]::SetEnvironmentVariable($setting.Key, [string]$setting.Value, "Process")
  }
}
if ($PlainSecret) {
  Remove-Variable PlainSecret -ErrorAction SilentlyContinue
}

$installArguments = @{}
if ($NoAutoStart) { $installArguments.NoAutoStart = $true }
if ($StartNow) { $installArguments.StartNow = $true }
& (Join-Path $PSScriptRoot "install.ps1") @installArguments

Write-Host "Configuration finished for '$WorkerId' ($WorkerName)."
Write-Host "Run diagnose.ps1 to verify PowerPoint, Poppler, autostart, and server connectivity."
