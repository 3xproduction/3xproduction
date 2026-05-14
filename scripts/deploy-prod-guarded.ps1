param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,
  [switch]$SkipClaude
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$gateArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "pre-deploy-check.ps1"))
if ($SkipClaude) { $gateArgs += "-SkipClaude" } else { $gateArgs += "-RunClaude" }
& powershell @gateArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$GitBash = "C:\Program Files\Git\bin\bash.exe"
if (Test-Path -LiteralPath $GitBash) {
  $Bash = $GitBash
}
else {
  $BashCommand = Get-Command bash -ErrorAction SilentlyContinue
  if (-not $BashCommand) {
    Write-Error "Git Bash is required for deploy scripts."
    exit 1
  }
  $Bash = $BashCommand.Source
}

Write-Host "Gate passed. Deploying prod version $Version..."
$env:PROD_DEPLOY_CONFIRMED = "yes"
& $Bash (Join-Path $PSScriptRoot "deploy-prod.sh") $Version
exit $LASTEXITCODE
