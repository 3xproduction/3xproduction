param(
  [string]$Task = "",
  [string[]]$Focus = @(),
  [int]$TimeoutSec = 180,
  [int]$MaxDiffChars = 50000,
  [int]$MaxFileLines = 220,
  [switch]$NoClaude
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$ReviewDir = Join-Path $Root ".codex\reviews"
New-Item -ItemType Directory -Force -Path $ReviewDir | Out-Null

$PromptFile = Join-Path $ReviewDir "FAST_REVIEW_PROMPT.md"
$PacketFile = Join-Path $ReviewDir "REVIEW_PACKET.md"
$TaskFile = Join-Path $ReviewDir "CLAUDE_REVIEW_TASK.md"
$ReviewFile = Join-Path $ReviewDir "CLAUDE_REVIEW.md"

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Add-Line {
  param([System.Text.StringBuilder]$Sb, [string]$Text = "")
  [void]$Sb.AppendLine($Text)
}

function Normalize-Focus {
  param([string[]]$Raw)
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($item in $Raw) {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    foreach ($part in ($item -split ",")) {
      $p = $part.Trim().Trim('"').Trim("'")
      if ([string]::IsNullOrWhiteSpace($p)) { continue }
      $p = $p -replace "\\", "/"
      if ($p.StartsWith("./")) { $p = $p.Substring(2) }
      if (-not $out.Contains($p)) { $out.Add($p) | Out-Null }
    }
  }
  return @($out)
}

$Focus = Normalize-Focus $Focus
if ($Focus.Count -eq 0) {
  throw "No focus files. Pass -Focus file1,file2."
}
if ($Focus.Count -gt 16) {
  throw "Too many focus files for fast review ($($Focus.Count)). Pass a smaller -Focus list or use npm.cmd run review."
}
if ([string]::IsNullOrWhiteSpace($Task)) {
  $Task = "Review the supplied focused diff for regressions before deploy."
}

$sb = New-Object System.Text.StringBuilder
Add-Line $sb "# Claude Fast Review Prompt"
Add-Line $sb ""
Add-Line $sb "You are Claude Code acting as the independent pre-deploy reviewer for Codex changes in 3XMedia Production."
Add-Line $sb ""
Add-Line $sb "Review only the supplied task, diff, and focus file excerpts. Do not inspect the repository. Do not read CLAUDE.md, CODEX.md, wiki, git status, or unrelated files for this fast review."
Add-Line $sb ""
Add-Line $sb "Current task:"
Add-Line $sb $Task
Add-Line $sb ""
Add-Line $sb "Focus files:"
foreach ($f in $Focus) { Add-Line $sb "- $f" }
Add-Line $sb ""
Add-Line $sb "Required output format:"
Add-Line $sb ""
Add-Line $sb "# Claude Review"
Add-Line $sb ""
Add-Line $sb "Verdict: PASS | CHANGES_REQUESTED | BLOCKED"
Add-Line $sb ""
Add-Line $sb "## Findings"
Add-Line $sb "- [P0/P1/P2/P3] path:line Short title - explanation and suggested fix."
Add-Line $sb ""
Add-Line $sb "## Verification Gaps"
Add-Line $sb "- Checks that were missing or could not be trusted."
Add-Line $sb ""
Add-Line $sb "## Notes"
Add-Line $sb "- Short non-blocking observations."
Add-Line $sb ""
Add-Line $sb "Verdict rules: BLOCKED for likely data loss/security/broken deploy; CHANGES_REQUESTED for concrete bug/regression; PASS for no blocking findings."
Add-Line $sb ""

Add-Line $sb "## Focused Diff"
Add-Line $sb ""
Add-Line $sb '```diff'
$diffArgs = @("-c", "core.quotepath=false", "diff", "--") + $Focus
$oldPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$diff = & git @diffArgs 2>&1
$ErrorActionPreference = $oldPreference
$diffText = (($diff | Out-String).TrimEnd())
if ($diffText.Length -gt $MaxDiffChars) {
  $diffText = $diffText.Substring(0, $MaxDiffChars) + "`n... diff truncated for fast review; use full review for wider context ..."
}
Add-Line $sb $diffText
Add-Line $sb '```'
Add-Line $sb ""

Add-Line $sb "## Focus File Excerpts"
foreach ($rel in $Focus) {
  $abs = Join-Path $Root $rel
  if (-not (Test-Path -LiteralPath $abs -PathType Leaf)) { continue }
  $item = Get-Item -LiteralPath $abs
  if ($item.Length -gt 120000) {
    Add-Line $sb ""
    Add-Line $sb "### $rel"
    Add-Line $sb "Skipped: file is larger than 120KB. Use full review if needed."
    continue
  }
  $lines = Get-Content -Encoding UTF8 -LiteralPath $abs
  $max = [Math]::Min($lines.Length, $MaxFileLines)
  Add-Line $sb ""
  Add-Line $sb "### $rel"
  Add-Line $sb '```text'
  for ($i = 1; $i -le $max; $i++) {
    Add-Line $sb ("{0,4}: {1}" -f $i, $lines[$i - 1])
  }
  if ($lines.Length -gt $max) {
    Add-Line $sb ("... truncated at {0} of {1} lines ..." -f $max, $lines.Length)
  }
  Add-Line $sb '```'
}

$prompt = $sb.ToString()
Write-Utf8NoBom $PromptFile $prompt

$packet = @"
# Codex -> Claude Fast Review Packet

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Repository: $Root

## Task
$Task

## Mode
Fast review. Claude must review only .codex/reviews/FAST_REVIEW_PROMPT.md.
Do not re-read CLAUDE.md, CODEX.md, wiki, or unrelated files for this packet.

## Focus
$($Focus -join "`n")
"@
Write-Utf8NoBom $PacketFile $packet

$taskText = @"
Fast review mode.

Read only .codex/reviews/FAST_REVIEW_PROMPT.md.
Do not edit files.
Do not re-read CLAUDE.md, CODEX.md, wiki, git status, or unrelated files.
Write the final Markdown review to .codex/reviews/CLAUDE_REVIEW.md.
"@
Write-Utf8NoBom $TaskFile $taskText

Write-Host "Fast review prompt ready: $PromptFile"

if ($NoClaude) {
  Write-Host "Claude run skipped by -NoClaude"
  exit 0
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "claude.cmd"
$psi.WorkingDirectory = $Root
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.Arguments = '-p --output-format text --tools "" --no-session-persistence --effort low'

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
[void]$proc.Start()
$proc.StandardInput.Write($prompt)
$proc.StandardInput.Close()

if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
  try { $proc.Kill() } catch {}
  throw "Claude fast review timed out after $TimeoutSec seconds"
}

$out = $proc.StandardOutput.ReadToEnd().Trim()
$err = $proc.StandardError.ReadToEnd().Trim()
if ($proc.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($out)) {
  if ($err) { Write-Host $err }
  throw "Claude fast review failed with exit code $($proc.ExitCode)"
}

Write-Utf8NoBom $ReviewFile $out
Write-Host "Claude fast review saved: $ReviewFile"

$hasPass = $out -match "(?im)^\s*Verdict:\s*PASS\s*$"
$hasBadVerdict = $out -match "(?im)^\s*Verdict:\s*(BLOCKED|CHANGES_REQUESTED)\s*$"
$hasHighFinding = $out -match "(?m)^\s*-\s*\[(P0|P1)\]"
if (-not $hasPass -or $hasBadVerdict -or $hasHighFinding) {
  Write-Host $out
  exit 1
}

Write-Host "Claude fast review PASS" -ForegroundColor Green
exit 0
