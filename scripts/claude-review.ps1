param(
  [switch]$SkipPacket,
  [string]$PromptFile = "",
  [string]$OutputFile = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

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
$Candidates = @()
if (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CODE_COMMAND)) {
  $Candidates += $env:CLAUDE_CODE_COMMAND
}
$Candidates += @("claude.cmd", "claude")

foreach ($Candidate in $Candidates) {
  try {
    Write-Host "Trying Claude Code CLI: $Candidate"
    $Output = & $Candidate -p $Prompt --output-format text 2>&1
    $ExitCode = $LASTEXITCODE
    $Text = (($Output | Out-String).TrimEnd())
    if ($ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($Text)) {
      $Text | Set-Content -Encoding UTF8 -Path $OutputFile
      Write-Host "Claude review saved: $OutputFile"
      exit 0
    }
    $Attempts.Add("$Candidate exited $ExitCode`: $Text") | Out-Null
  }
  catch {
    $Attempts.Add("$Candidate failed: $($_.Exception.Message)") | Out-Null
  }
}

$ManualFile = Join-Path $ReviewDir "CLAUDE_MANUAL_PROMPT.md"
$AttemptText = ($Attempts -join "`n`n")
$Manual = @"
# Claude Code CLI did not run

Use the manual one-word fallback.

1. Open Claude Code in:

````text
$Root
````

2. Send:

````text
ревью
````

3. Wait until Claude writes:

````text
.codex/reviews/CLAUDE_REVIEW.md
````

## CLI attempts

````text
$AttemptText
````
"@
$Manual | Set-Content -Encoding UTF8 -Path $ManualFile

Write-Host "Claude Code CLI was not available. Manual prompt written: $ManualFile"
exit 2
