<#!
.SYNOPSIS
Deploys the SageSearch DeepSeek proxy, then writes the exact Cloud Run URL to
the desktop backend configuration.

.DESCRIPTION
The script deliberately takes secrets from the current process environment;
they are stored in Google Secret Manager and are never added to config.json.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Project,
  [Parameter(Mandatory = $true)] [string] $Region,
  [string] $Service = 'sagesearch-interpret',
  [string] $ConfigPath = (Join-Path $PSScriptRoot '..\backend\config.json')
)

$ErrorActionPreference = 'Stop'

foreach ($name in 'DEEPSEEK_API_KEY') {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name must be set in the current process before deployment."
  }
}

function Set-SecretVersion([string] $SecretName, [string] $Value) {
  $exists = gcloud secrets describe $SecretName --project $Project 2>$null
  if ($LASTEXITCODE -ne 0) {
    $null = $Value | gcloud secrets create $SecretName --project $Project --replication-policy automatic --data-file -
  } else {
    $null = $Value | gcloud secrets versions add $SecretName --project $Project --data-file -
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not create a version for Secret Manager secret $SecretName." }
}

Set-SecretVersion 'deepseek-api-key' $env:DEEPSEEK_API_KEY

gcloud run deploy $Service `
  --project $Project `
  --region $Region `
  --source $PSScriptRoot `
  --allow-unauthenticated `
  --max-instances 2 `
  --concurrency 10 `
  --set-secrets 'DEEPSEEK_API_KEY=deepseek-api-key:latest' `
  --set-env-vars 'INTERPRET_RATE_LIMIT_MAX=20'
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run deployment failed.' }

$serviceUrl = (gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)').Trim()
if (-not $serviceUrl) { throw 'Cloud Run did not return a service URL.' }

$resolvedConfigPath = (Resolve-Path $ConfigPath).Path
$config = Get-Content -Raw $resolvedConfigPath | ConvertFrom-Json
$config.provider.mode = 'cloud'
$config.provider.cloud.proxyUrl = "$serviceUrl/interpret"
$config | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $resolvedConfigPath

Write-Host "Deployed $serviceUrl and set $resolvedConfigPath to $serviceUrl/interpret"
