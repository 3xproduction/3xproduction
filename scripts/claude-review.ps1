param(
  [switch]$SkipPacket,
  [string]$PromptFile = "",
  [string]$OutputFile = "",
  [int]$TimeoutSec = 1800
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
. (Join-Path $PSScriptRoot "claude-cli.ps1")

$ReviewDir = Join-Path $Root ".codex\reviews"
New-Item -ItemType Directory -Force -Path $ReviewDir | Out-Null

if ([string]::IsNullOrWhiteSpace($PromptFile)) {
  $PromptFile = Join-Path $ReviewDir "CLAUDE_REVIEW_TASK.md"
}
if ([string]::IsNullOrWhiteSpace($OutputFile)) {
  $OutputFile = Join-Path $ReviewDir "CLAUDE_REVIEW.md"
}

if (-not $SkipPacket) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "codex-review.ps1")
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path -LiteralPath $PromptFile)) {
  throw "Prompt file not found: $PromptFile"
}

$Prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath $PromptFile
$Prompt = $Prompt + "`n`nReturn only the review Markdown. Do not edit files."

$Attempts = New-Object System.Collections.Generic.List[string]

try {
  Write-Host "Trying Claude Code CLI (timeout ${TimeoutSec}s)"
  $Result = Invoke-ClaudeCli -Prompt $Prompt -WorkingDirectory $Root -TimeoutSec $TimeoutSec -ExtraArgs @("--no-session-persistence")
  if ($Result.TimedOut) {
    $Attempts.Add("$($Result.Command) timed out after $TimeoutSec seconds.`nSTDOUT:`n$($Result.Stdout)`nSTDERR:`n$($Result.Stderr)") | Out-Null
  }
  elseif ($Result.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($Result.Stdout)) {
    Write-Utf8NoBom $OutputFile $Result.Stdout
    Write-Host "Claude review saved: $OutputFile"
    exit 0
  }
  else {
    $Attempts.Add("$($Result.Command) exited $($Result.ExitCode).`nSTDOUT:`n$($Result.Stdout)`nSTDERR:`n$($Result.Stderr)") | Out-Null
  }
}
catch {
  $Attempts.Add("Claude CLI failed before launch: $($_.Exception.Message)") | Out-Null
}

$ManualFile = Join-Path $ReviewDir "CLAUDE_MANUAL_PROMPT.md"
$AttemptText = ($Attempts -join "`n`n")
$Manual = @"
# Claude Code CLI did not run

Use the manual one-word fallback.

1. Open Claude Code in:

~~~~text
$Root
~~~~

2. Send:

~~~~text
ревью
~~~~

3. Wait until Claude writes:

~~~~text
.codex/reviews/CLAUDE_REVIEW.md
~~~~

## CLI attempts

~~~~text
$AttemptText
~~~~
"@
$Manual | Set-Content -Encoding UTF8 -Path $ManualFile

Write-Host "Claude Code CLI review did not complete. Manual prompt written: $ManualFile"
exit 2
