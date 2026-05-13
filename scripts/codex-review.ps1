param(
  [string]$Task = "",
  [switch]$RunClaude,
  [switch]$NoDiff
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$ReviewDir = Join-Path $Root ".codex\reviews"
New-Item -ItemType Directory -Force -Path $ReviewDir | Out-Null

$PacketFile = Join-Path $ReviewDir "REVIEW_PACKET.md"
$TaskFile = Join-Path $ReviewDir "CLAUDE_REVIEW_TASK.md"
$DiffFile = Join-Path $ReviewDir "DIFF.patch"
$UntrackedFile = Join-Path $ReviewDir "UNTRACKED_TEXT.md"
$ManualFile = Join-Path $ReviewDir "CLAUDE_MANUAL_PROMPT.md"

function Invoke-GitText {
  param([string[]]$GitArgs)
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git @GitArgs 2>&1
    return (($output | Out-String).TrimEnd())
  }
  finally {
    $ErrorActionPreference = $oldPreference
  }
}

function Test-ReviewTextFile {
  param([string]$Path)
  $name = [IO.Path]::GetFileName($Path)
  $ext = [IO.Path]::GetExtension($Path).ToLowerInvariant()
  $textExt = @(".js", ".jsx", ".json", ".md", ".css", ".html", ".sql", ".sh", ".ps1", ".txt", ".env", ".example", ".yml", ".yaml", ".toml", ".svg")
  return ($textExt -contains $ext) -or ($name -in @("Dockerfile", ".dockerignore", ".gitignore"))
}

if ([string]::IsNullOrWhiteSpace($Task)) {
  $Task = "Not provided. Infer the task from git status, diff, and recent repository changes."
}

$GeneratedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
$BranchStatus = Invoke-GitText @("status", "--short", "--branch")
$DiffStat = Invoke-GitText @("-c", "core.quotepath=false", "diff", "--stat")
$NameStatus = Invoke-GitText @("-c", "core.quotepath=false", "diff", "--name-status")
$CachedStat = Invoke-GitText @("-c", "core.quotepath=false", "diff", "--cached", "--stat")
$LastCommit = Invoke-GitText @("log", "-1", "--oneline", "--decorate")
$Untracked = @(& git -c core.quotepath=false ls-files --others --exclude-standard 2>$null)
$UntrackedList = ($Untracked -join "`n")

if (-not $NoDiff) {
  $diffArgs = @(
    "-c", "core.quotepath=false", "diff", "--", ".",
    ":(exclude)frontend/public/*.png",
    ":(exclude)frontend/public/*.jpg",
    ":(exclude)frontend/public/*.jpeg",
    ":(exclude)frontend/public/*.webp",
    ":(exclude)frontend/public/*.ico",
    ":(exclude).codex/reviews/*"
  )
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $diffOutput = & git @diffArgs 2>&1
  $ErrorActionPreference = $oldPreference
  if ($LASTEXITCODE -ne 0) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $diffOutput = & git -c core.quotepath=false diff -- . 2>&1
    $ErrorActionPreference = $oldPreference
  }
  ($diffOutput | Out-String).TrimEnd() | Set-Content -Encoding UTF8 -Path $DiffFile
}
else {
  "Diff generation skipped by -NoDiff." | Set-Content -Encoding UTF8 -Path $DiffFile
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Untracked text file excerpts")
[void]$sb.AppendLine("")
foreach ($rel in $Untracked) {
  if ([string]::IsNullOrWhiteSpace($rel)) { continue }
  if ($rel -like ".codex/reviews/*") { continue }
  $abs = Join-Path $Root $rel
  if (-not (Test-Path -LiteralPath $abs -PathType Leaf)) { continue }
  $item = Get-Item -LiteralPath $abs
  if ($item.Length -gt 80000) { continue }
  if (-not (Test-ReviewTextFile $abs)) { continue }
  $ext = [IO.Path]::GetExtension($abs).TrimStart('.').ToLowerInvariant()
  [void]$sb.AppendLine("## $rel")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("````$ext")
  try {
    [void]$sb.AppendLine((Get-Content -Raw -Encoding UTF8 -LiteralPath $abs))
  }
  catch {
    [void]$sb.AppendLine("<Could not read as UTF-8: $($_.Exception.Message)>")
  }
  [void]$sb.AppendLine("````")
  [void]$sb.AppendLine("")
}
$sb.ToString() | Set-Content -Encoding UTF8 -Path $UntrackedFile

$Prompt = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $Root ".codex\review-prompt.md")

$Packet = @"
# Codex -> Claude Review Packet

Generated: $GeneratedAt
Repository: $Root
Last commit: $LastCommit

## Current Task

$Task

## Review Contract

$Prompt

## Important Local Context

- Read `CLAUDE.md` in the repository root.
- Read `CODEX.md` in the repository root if available.
- Use `C:\Users\Editor08\wiki\schema\index.md` and relevant `C:\Users\Editor08\wiki\wiki\*.md` pages for domain context.
- Treat this as pre-deploy review. Do not modify code during review.
- If this diff is too large, prioritize changed files related to the current task and list review coverage gaps.

## Git Status

````text
$BranchStatus
````

## Changed Tracked Files

````text
$NameStatus
````

## Untracked Files

````text
$UntrackedList
````

## Diff Stat

````text
$DiffStat
````

## Staged Diff Stat

````text
$CachedStat
````

## Attached Files

- `.codex/reviews/DIFF.patch` — tracked diff, excluding common binary image assets.
- `.codex/reviews/UNTRACKED_TEXT.md` — excerpts of small untracked text files.
- `.codex/reviews/CLAUDE_REVIEW_TASK.md` — short task prompt for Claude Code.

## Required Review Output

If you are running interactively in Claude Code, write the final review to:

````text
.codex/reviews/CLAUDE_REVIEW.md
````

If you are running through CLI print mode, output the same Markdown to stdout so the wrapper can save it.
"@
$Packet | Set-Content -Encoding UTF8 -Path $PacketFile

$TaskText = @"
Act as the independent pre-deploy reviewer for Codex changes.

1. Read `.codex/reviews/REVIEW_PACKET.md`.
2. Inspect `.codex/reviews/DIFF.patch`, `.codex/reviews/UNTRACKED_TEXT.md`, and the changed files in the repo as needed.
3. Do not edit code.
4. Produce the review in the exact format requested in `.codex/review-prompt.md`.
5. If interactive, write the final Markdown to `.codex/reviews/CLAUDE_REVIEW.md`.

Short command from the user may simply be: "ревью".
"@
$TaskText | Set-Content -Encoding UTF8 -Path $TaskFile

$Manual = @"
# What to tell Claude Code

Open Claude Code in this repository and send one word:

````text
ревью
````

`CLAUDE.md` tells Claude Code to read `.codex/reviews/CLAUDE_REVIEW_TASK.md`, perform the review, and write `.codex/reviews/CLAUDE_REVIEW.md`.

If Claude does not follow the shortcut, paste this:

````text
$(Get-Content -Raw -Encoding UTF8 -Path $TaskFile)
````
"@
$Manual | Set-Content -Encoding UTF8 -Path $ManualFile

Write-Host "Review packet ready: $PacketFile"
Write-Host "Claude shortcut: say 'ревью' in Claude Code opened at $Root"

if ($RunClaude) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "claude-review.ps1") -SkipPacket
  exit $LASTEXITCODE
}
