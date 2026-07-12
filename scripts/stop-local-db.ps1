$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $projectRoot '.pgdata'

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

if (-not (Test-Path $dataDir)) {
  throw "Postgres data directory not found at $dataDir."
}

$pgCtl = Resolve-PgCtl

& $pgCtl -D $dataDir status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Local PostgreSQL cluster is already stopped.'
  exit 0
}

Write-Host "Stopping local PostgreSQL cluster from $dataDir ..."
& $pgCtl -D $dataDir stop -m fast | Out-Host

& $pgCtl -D $dataDir status *> $null
if ($LASTEXITCODE -eq 0) {
  throw 'PostgreSQL did not stop cleanly.'
}

Write-Host 'Local PostgreSQL cluster stopped.'
