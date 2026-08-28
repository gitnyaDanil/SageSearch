<#!
.SYNOPSIS
Deploys the SageSearch Autonomous Agent Service to Google Cloud Run.

.DESCRIPTION
This script containerizes and deploys the agent service to Google Cloud Run,
binding required secrets (GEMINI_API_KEY) from Google Secret Manager.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Project,
  [string] $Region = 'us-west4',
  [string] $Service = 'sagesearch-agent'
)

$ErrorActionPreference = 'Stop'

function Set-SecretVersion([string] $SecretName, [string] $Value) {
  $exists = gcloud secrets describe $SecretName --project $Project 2>$null
  if ($LASTEXITCODE -ne 0) {
    $null = $Value | gcloud secrets create $SecretName --project $Project --replication-policy automatic --data-file -
  } else {
    $null = $Value | gcloud secrets versions add $SecretName --project $Project --data-file -
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not create Secret Manager secret $SecretName." }
}

if (-not [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
  Write-Host "Syncing GEMINI_API_KEY to Secret Manager..."
  Set-SecretVersion 'gemini-api-key' $env:GEMINI_API_KEY
  $secretArg = "--set-secrets=GEMINI_API_KEY=gemini-api-key:latest"
} else {
  Write-Warning "GEMINI_API_KEY environment variable not set. Deploying without live API secret."
  $secretArg = ""
}

Write-Host "Deploying $Service to Google Cloud Run (Region: $Region, Project: $Project)..."

gcloud run deploy $Service `
  --project $Project `
  --region $Region `
  --source $PSScriptRoot `
  --allow-unauthenticated `
  --max-instances 2 `
  --concurrency 20 `
  --set-env-vars "GEMINI_MODEL=gemini-2.5-flash,GCP_PROJECT=$Project" `
  $secretArg

if ($LASTEXITCODE -ne 0) { throw 'Cloud Run deployment failed.' }

$serviceUrl = (gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)').Trim()
Write-Host "Successfully deployed SageSearch Agent service to: $serviceUrl"
