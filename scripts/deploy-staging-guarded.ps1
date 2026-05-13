param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,
  [switch]$RunClaude,
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$gateArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "pre-deploy-check.ps1"))
if ($RunClaude) { $gateArgs += "-RunClaude" }
if ($SkipFrontend) { $gateArgs += "-SkipFrontend" }
& powershell @gateArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Gate passed. Deploying staging version $Version..."
& bash (Join-Path $PSScriptRoot "deploy-staging.sh") $Version
exit $LASTEXITCODE
