param([ValidateSet('init','start','status','stop')][string]$Action='status')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$envFile=Join-Path $root 'private/erpnext.env'
if ($Action -eq 'init') {
  if (Test-Path -LiteralPath $envFile) { Write-Output 'Existing private configuration preserved.'; exit 0 }
  New-Item -ItemType Directory -Force (Split-Path $envFile) | Out-Null
  $dbPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
  $adminPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
  @('ERPNEXT_VERSION=v16.35.0','ERP_HTTP_PORT=8080','PULL_POLICY=missing',"DB_PASSWORD=$dbPassword","ERP_ADMIN_PASSWORD=$adminPassword") |
    Set-Content -LiteralPath $envFile -Encoding utf8
  Write-Output 'Created private/erpnext.env. Credentials are not printed.'
  exit 0
}
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Run this script with -Action init first.' }
$docker=Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  $dockerPath=Join-Path $env:ProgramFiles 'Docker/Docker/resources/bin/docker.exe'
  if (-not (Test-Path -LiteralPath $dockerPath)) { throw 'Docker Desktop is not installed.' }
} else { $dockerPath=$docker.Source }
$composeArgs=@('compose','--project-name','erprag','--env-file',$envFile,
  '-f',(Join-Path $root 'deploy/erpnext/upstream/compose.yaml'),
  '-f',(Join-Path $root 'deploy/erpnext/upstream/compose.mariadb.yaml'),
  '-f',(Join-Path $root 'deploy/erpnext/upstream/compose.redis.yaml'),
  '-f',(Join-Path $root 'deploy/erpnext/local.yaml'))
function Invoke-Compose([string[]]$CommandArgs) {
  & $dockerPath @composeArgs @CommandArgs
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed: $($CommandArgs[0])" }
}
Invoke-Compose @('config','--quiet')
switch ($Action) {
  'start' {
    Invoke-Compose @('pull')
    Invoke-Compose @('up','-d')
    Invoke-Compose @('run','--rm','create-site')
    Write-Output 'ERPNext containers started. Verify the HTTP endpoint before declaring readiness.'
  }
  'status' { Invoke-Compose @('ps','-a') }
  'stop' { Invoke-Compose @('stop'); Write-Output 'Containers stopped. Named data volumes retained.' }
}
