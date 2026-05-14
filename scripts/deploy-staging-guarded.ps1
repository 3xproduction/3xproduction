param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,
  [switch]$RunClaude,
  [switch]$SkipClaude,
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$gateArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "pre-deploy-check.ps1"))
if ($RunClaude) { $gateArgs += "-RunClaude" }
if ($SkipClaude) { $gateArgs += "-SkipClaude" }
if ($SkipFrontend) { $gateArgs += "-SkipFrontend" }
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

Write-Host "Gate passed. Deploying staging version $Version..."
& $Bash (Join-Path $PSScriptRoot "deploy-staging.sh") $Version
exit $LASTEXITCODE
