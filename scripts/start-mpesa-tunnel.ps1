param(
  [int]$Port = 4000,
  [string]$EnvFile = "",
  [string]$FrontendEnvFile = "",
  [string]$WebEnvFile = "",
  [switch]$NoEnvUpdate
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $EnvFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.env"))
}

if ([string]::IsNullOrWhiteSpace($FrontendEnvFile)) {
  $FrontendEnvFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.env.local"))
}

if ([string]::IsNullOrWhiteSpace($WebEnvFile)) {
  $WebEnvFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\web\.env"))
}

$cloudflared = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
}

if (-not $cloudflared) {
  throw "cloudflared is not installed on this machine."
}

function New-CallbackSecret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$logFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\mpesa-tunnel.log"))
$errFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\mpesa-tunnel.err.log"))

if (Test-Path $logFile) { Remove-Item -LiteralPath $logFile -Force }
if (Test-Path $errFile) { Remove-Item -LiteralPath $errFile -Force }

$process = Start-Process `
  -WindowStyle Hidden `
  -FilePath $cloudflared.Source `
  -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port") `
  -RedirectStandardOutput $logFile `
  -RedirectStandardError $errFile `
  -PassThru

$deadline = (Get-Date).AddSeconds(45)
$tunnelUrl = $null

while ((Get-Date) -lt $deadline -and -not $tunnelUrl) {
  Start-Sleep -Milliseconds 750

  $combined = @()
  if (Test-Path $logFile) { $combined += Get-Content $logFile -ErrorAction SilentlyContinue }
  if (Test-Path $errFile) { $combined += Get-Content $errFile -ErrorAction SilentlyContinue }

  foreach ($line in $combined) {
    $match = [regex]::Match($line, 'https://[a-zA-Z0-9\.-]+\.trycloudflare\.com')
    if ($match.Success) {
      $tunnelUrl = $match.Value
      break
    }
  }

  if ($process.HasExited) {
    throw "cloudflared exited before publishing a tunnel URL."
  }
}

if (-not $tunnelUrl) {
  throw "Could not detect the public Cloudflare tunnel URL. Check $logFile and $errFile."
}

$callbackUrl = "$tunnelUrl/api/payments/mpesa/callback"
$apiBaseUrl = "$tunnelUrl/api"

if (-not $NoEnvUpdate) {
  if (-not (Test-Path $EnvFile)) {
    throw "Env file not found: $EnvFile"
  }

  $lines = Get-Content $EnvFile
  $callbackUrlUpdated = $false
  $callbackSecretUpdated = $false
  $existingCallbackSecret = $null

  foreach ($line in $lines) {
    if ($line -match '^MPESA_CALLBACK_SECRET=(.*)$') {
      $existingCallbackSecret = $matches[1]
      break
    }
  }

  if ([string]::IsNullOrWhiteSpace($existingCallbackSecret)) {
    $existingCallbackSecret = New-CallbackSecret
  }

  $newLines = foreach ($line in $lines) {
    if ($line -match '^MPESA_CALLBACK_URL=') {
      $callbackUrlUpdated = $true
      "MPESA_CALLBACK_URL=$callbackUrl"
    } elseif ($line -match '^MPESA_CALLBACK_SECRET=') {
      $callbackSecretUpdated = $true
      "MPESA_CALLBACK_SECRET=$existingCallbackSecret"
    } else {
      $line
    }
  }

  if (-not $callbackUrlUpdated) {
    $newLines += "MPESA_CALLBACK_URL=$callbackUrl"
  }

  if (-not $callbackSecretUpdated) {
    $newLines += "MPESA_CALLBACK_SECRET=$existingCallbackSecret"
  }

  Set-Content -LiteralPath $EnvFile -Value $newLines

  if (Test-Path $FrontendEnvFile) {
    $frontendLines = Get-Content $FrontendEnvFile
    $apiUrlUpdated = $false

    $newFrontendLines = foreach ($line in $frontendLines) {
      if ($line -match '^EXPO_PUBLIC_API_BASE_URL=') {
        $apiUrlUpdated = $true
        "EXPO_PUBLIC_API_BASE_URL=$apiBaseUrl"
      } else {
        $line
      }
    }

    if (-not $apiUrlUpdated) {
      $newFrontendLines += "EXPO_PUBLIC_API_BASE_URL=$apiBaseUrl"
    }

    Set-Content -LiteralPath $FrontendEnvFile -Value $newFrontendLines
  }

  if (Test-Path $WebEnvFile) {
    $webLines = Get-Content $WebEnvFile
    $webApiUrlUpdated = $false
    $webAppEnvUpdated = $false

    $newWebLines = foreach ($line in $webLines) {
      if ($line -match '^VITE_API_BASE_URL=') {
        $webApiUrlUpdated = $true
        "VITE_API_BASE_URL=$apiBaseUrl"
      } elseif ($line -match '^VITE_APP_ENV=') {
        $webAppEnvUpdated = $true
        $line
      } else {
        $line
      }
    }

    if (-not $webApiUrlUpdated) {
      $newWebLines += "VITE_API_BASE_URL=$apiBaseUrl"
    }

    if (-not $webAppEnvUpdated) {
      $newWebLines += "VITE_APP_ENV=development"
    }

    Set-Content -LiteralPath $WebEnvFile -Value $newWebLines
  }
}

Write-Output "Cloudflare tunnel PID: $($process.Id)"
Write-Output "Tunnel URL: $tunnelUrl"
Write-Output "API base URL: $apiBaseUrl"
Write-Output "Callback URL: $callbackUrl"
Write-Output "Log file: $logFile"
Write-Output "Error log: $errFile"
