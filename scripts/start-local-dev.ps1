param(
  [switch]$SkipBackend
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $projectRoot '.pgdata'
$logFile = Join-Path $dataDir 'server.log'
$dbUrl = 'postgresql://nlbb:nlbb_dev@127.0.0.1:55432/nlbb'

function Resolve-PgCtl {
  $candidates = @(
    'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe',
    'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe',
    'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe',
    'C:\Program Files\PostgreSQL\15\bin\pg_ctl.exe',
    'C:\Program Files\PostgreSQL\14\bin\pg_ctl.exe',
    'C:\Program Files\PostgreSQL\13\bin\pg_ctl.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $command = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw 'pg_ctl.exe was not found. Install PostgreSQL or add pg_ctl.exe to PATH.'
}

function Test-ClusterRunning {
  param(
    [string]$PgCtl,
    [string]$ClusterDataDir
  )

  & $PgCtl -D $ClusterDataDir status *> $null
  return $LASTEXITCODE -eq 0
}

if (-not (Test-Path $dataDir)) {
  throw "Postgres data directory not found at $dataDir. Initialize it first before running this script."
}

$pgCtl = Resolve-PgCtl

if (-not (Test-ClusterRunning -PgCtl $pgCtl -ClusterDataDir $dataDir)) {
  Write-Host "Starting local PostgreSQL cluster from $dataDir ..."
  & $pgCtl -D $dataDir -l $logFile start | Out-Host

  if (-not (Test-ClusterRunning -PgCtl $pgCtl -ClusterDataDir $dataDir)) {
    $tail = (Get-Content $logFile -Tail 25 -ErrorAction SilentlyContinue) -join "`n"
    throw "PostgreSQL failed to start. Last log lines:`n$tail"
  }
}
else {
  Write-Host 'Local PostgreSQL cluster is already running.'
}

$env:DATABASE_URL = $dbUrl
Write-Host "DATABASE_URL set to $dbUrl"

if ($SkipBackend) {
  Write-Host 'Skipping backend start because -SkipBackend was provided.'
  exit 0
}

Set-Location $projectRoot
Write-Host 'Starting backend in watch mode (npm run dev) ...'
npm run dev
