param(
  [switch]$SkipFrontend,
  [switch]$SkipClaude,
  [switch]$RunClaude,
  [switch]$NoDiff,
  [switch]$RefreshPacket
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$Failures = New-Object System.Collections.Generic.List[string]

function Run-Step {
  param(
    [string]$Name,
    [scriptblock]$Step
  )
  Write-Host "==> $Name"
  & $Step
  if ($LASTEXITCODE -ne 0) {
    $script:Failures.Add("$Name failed with exit code $LASTEXITCODE") | Out-Null
  }
}

if (-not $SkipFrontend) {
  Push-Location (Join-Path $Root "frontend")
  Run-Step "frontend lint" { npm.cmd run lint }
  Run-Step "frontend build" { npm.cmd run build }
  Pop-Location
}

$ReviewDir = Join-Path $Root ".codex\reviews"
$PacketFile = Join-Path $ReviewDir "REVIEW_PACKET.md"
$ReviewFile = Join-Path $ReviewDir "CLAUDE_REVIEW.md"

if ($RefreshPacket -or $RunClaude) {
  $reviewArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "codex-review.ps1"))
  if ($NoDiff) { $reviewArgs += "-NoDiff" }
  & powershell @reviewArgs
  if ($LASTEXITCODE -ne 0) {
    $Failures.Add("review packet generation failed") | Out-Null
  }
}
elseif (-not (Test-Path -LiteralPath $PacketFile)) {
  $Failures.Add("review packet missing: run npm.cmd run review first") | Out-Null
}

if ($RunClaude -and -not $SkipClaude) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "claude-review.ps1") -SkipPacket
  if ($LASTEXITCODE -ne 0) {
    $Failures.Add("Claude CLI review did not complete; use the manual 'ревью' fallback") | Out-Null
  }
}

if (-not $SkipClaude) {
  if (-not (Test-Path -LiteralPath $ReviewFile)) {
    $Failures.Add("Claude review missing: run npm.cmd run review, then say 'ревью' in Claude Code") | Out-Null
  }
  else {
    $packetTime = (Get-Item -LiteralPath $PacketFile).LastWriteTimeUtc
    $reviewTime = (Get-Item -LiteralPath $ReviewFile).LastWriteTimeUtc
    if ($reviewTime -lt $packetTime) {
      $Failures.Add("Claude review is stale: regenerate/re-run review") | Out-Null
    }

    $review = Get-Content -Raw -Encoding UTF8 -LiteralPath $ReviewFile
    $hasPass = $review -match "(?im)^\s*Verdict:\s*PASS\s*$"
    $hasBadVerdict = $review -match "(?im)^\s*Verdict:\s*(BLOCKED|CHANGES_REQUESTED)\s*$"
    $hasHighFinding = $review -match "(?m)^\s*-\s*\[(P0|P1)\]"
    if (-not $hasPass -or $hasBadVerdict -or $hasHighFinding) {
      $Failures.Add("Claude review is not a clean PASS") | Out-Null
    }
  }
}

if ($Failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Pre-deploy gate FAILED:" -ForegroundColor Red
  foreach ($failure in $Failures) { Write-Host "- $failure" -ForegroundColor Red }
  exit 1
}

Write-Host ""
Write-Host "Pre-deploy gate PASS" -ForegroundColor Green
exit 0
