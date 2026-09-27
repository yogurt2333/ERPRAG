param([string]$Proxy)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Force $logDir | Out-Null
Start-Transcript -Path (Join-Path $logDir 'windows-erp-setup.log') -Append
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run with Windows administrator privileges.' }
  if ($Proxy) { $env:HTTP_PROXY=$Proxy; $env:HTTPS_PROXY=$Proxy; $env:ALL_PROXY=$Proxy }
  $restartNeeded = $false
  foreach ($feature in @('Microsoft-Windows-Subsystem-Linux','VirtualMachinePlatform')) {
    $state = Get-WindowsOptionalFeature -Online -FeatureName $feature
    if ($state.State -ne 'Enabled') {
      $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
      $restartNeeded = $restartNeeded -or $result.RestartNeeded
    }
  }
  foreach ($package in @('Microsoft.WSL','Docker.DockerDesktop')) {
    & winget install --id $package --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -notin @(0,3010,-1978335189)) { throw "Installation of $package returned $LASTEXITCODE; inspect the log." }
    if ($LASTEXITCODE -eq 3010) { $restartNeeded=$true }
  }
  @{status='installed'; restartNeeded=$restartNeeded; completedAt=(Get-Date -Format o)} |
    ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $logDir 'windows-erp-setup-result.json')
  Write-Output 'Setup completed. No automatic reboot was requested by this script.'
} catch {
  @{status='failed'; error=$_.Exception.Message; completedAt=(Get-Date -Format o)} |
    ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $logDir 'windows-erp-setup-result.json')
  throw
} finally { Stop-Transcript }
