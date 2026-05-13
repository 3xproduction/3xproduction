$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Add-UniqueString {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$Value
  )
  if ([string]::IsNullOrWhiteSpace($Value)) { return }
  if (-not $List.Contains($Value)) { $List.Add($Value) | Out-Null }
}

function Resolve-CommandCandidate {
  param([string]$Candidate)
  if ([string]::IsNullOrWhiteSpace($Candidate)) { return $null }

  try {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $Candidate).Path
    }
  }
  catch {}

  try {
    $cmd = Get-Command $Candidate -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }
  catch {}

  return $null
}

function Resolve-ClaudeCli {
  $candidates = New-Object System.Collections.Generic.List[string]

  Add-UniqueString $candidates $env:CLAUDE_CODE_COMMAND

  foreach ($name in @("claude.cmd", "claude.exe", "claude", "claude.ps1")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { Add-UniqueString $candidates $cmd.Source }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
    Add-UniqueString $candidates (Join-Path $env:APPDATA "npm\claude.cmd")
    Add-UniqueString $candidates (Join-Path $env:APPDATA "npm\claude.ps1")
  }

  try {
    $prefix = (& npm.cmd config get prefix 2>$null | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace($prefix)) {
      Add-UniqueString $candidates (Join-Path $prefix "claude.cmd")
      Add-UniqueString $candidates (Join-Path $prefix "claude.ps1")
      Add-UniqueString $candidates (Join-Path $prefix "node_modules\.bin\claude.cmd")
    }
  }
  catch {}

  foreach ($candidate in $candidates) {
    $resolved = Resolve-CommandCandidate $candidate
    if (-not [string]::IsNullOrWhiteSpace($resolved)) { return $resolved }
  }

  return $null
}

function Quote-ProcessArgument {
  param([string]$Argument)
  if ([string]::IsNullOrEmpty($Argument)) { return '""' }
  if ($Argument -notmatch '[\s"]') { return $Argument }

  $result = New-Object System.Text.StringBuilder
  [void]$result.Append('"')
  $backslashes = 0

  foreach ($ch in $Argument.ToCharArray()) {
    if ($ch -eq '\') {
      $backslashes += 1
      continue
    }

    if ($ch -eq '"') {
      if ($backslashes -gt 0) { [void]$result.Append('\' * ($backslashes * 2)) }
      [void]$result.Append('\"')
      $backslashes = 0
      continue
    }

    if ($backslashes -gt 0) {
      [void]$result.Append('\' * $backslashes)
      $backslashes = 0
    }
    [void]$result.Append($ch)
  }

  if ($backslashes -gt 0) { [void]$result.Append('\' * ($backslashes * 2)) }
  [void]$result.Append('"')
  return $result.ToString()
}

function Quote-PowerShellString {
  param([string]$Argument)
  return "'" + $Argument.Replace("'", "''") + "'"
}

function Join-ProcessArguments {
  param([string[]]$Arguments)
  return (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " ")
}

function New-ClaudeStartInfo {
  param(
    [string]$Command,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  foreach ($prop in @("StandardInputEncoding", "StandardOutputEncoding", "StandardErrorEncoding")) {
    if ($psi.PSObject.Properties.Name -contains $prop) {
      $psi.$prop = $utf8
    }
  }

  $ext = [IO.Path]::GetExtension($Command).ToLowerInvariant()
  $argText = Join-ProcessArguments $Arguments

  if ($ext -eq ".cmd" -or $ext -eq ".bat") {
    $psi.FileName = $env:ComSpec
    $cmdLine = '"' + $Command + '"'
    if (-not [string]::IsNullOrWhiteSpace($argText)) { $cmdLine += " $argText" }
    $psi.Arguments = '/d /s /c "' + $cmdLine + '"'
  }
  elseif ($ext -eq ".ps1") {
    $psi.FileName = "powershell.exe"
    $scriptCall = "& " + (Quote-PowerShellString $Command)
    foreach ($arg in $Arguments) {
      $scriptCall += " " + (Quote-PowerShellString $arg)
    }
    $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $scriptCall)
    $psi.Arguments = Join-ProcessArguments $psArgs
  }
  else {
    $psi.FileName = $Command
    $psi.Arguments = $argText
  }

  return $psi
}

function Get-TaskText {
  param(
    [Parameter(Mandatory=$true)]$Task,
    [int]$TimeoutMs = 5000,
    [string]$Fallback = ""
  )

  try {
    if ($Task.Wait($TimeoutMs)) {
      return $Task.Result.TrimEnd()
    }
  }
  catch {}

  return $Fallback
}

function Invoke-ClaudeCli {
  param(
    [Parameter(Mandatory=$true)][string]$Prompt,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [int]$TimeoutSec = 1800,
    [string[]]$ExtraArgs = @()
  )

  $command = Resolve-ClaudeCli
  if ([string]::IsNullOrWhiteSpace($command)) {
    throw "Claude Code CLI not found. Install it with: npm.cmd install -g @anthropic-ai/claude-code, or set CLAUDE_CODE_COMMAND to the executable path."
  }

  $cliArgs = @("-p", "--output-format", "text") + $ExtraArgs
  $psi = New-ClaudeStartInfo -Command $command -Arguments $cliArgs -WorkingDirectory $WorkingDirectory

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi

  [void]$proc.Start()
  $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
  $stderrTask = $proc.StandardError.ReadToEndAsync()
  $proc.StandardInput.Write($Prompt)
  $proc.StandardInput.Close()

  if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
    try { $proc.Kill() } catch {}
    try { $proc.WaitForExit(5000) | Out-Null } catch {}
    $stdoutText = Get-TaskText -Task $stdoutTask -Fallback "<stdout read did not complete after process kill>"
    $stderrText = Get-TaskText -Task $stderrTask -Fallback "<stderr read did not complete after process kill>"
    return [pscustomobject]@{
      Command = $command
      ExitCode = -1
      Stdout = $stdoutText
      Stderr = $stderrText
      TimedOut = $true
      TimeoutSec = $TimeoutSec
    }
  }

  $proc.WaitForExit()
  $stdoutText = Get-TaskText -Task $stdoutTask -Fallback "<stdout read did not complete after process exit>"
  $stderrText = Get-TaskText -Task $stderrTask -Fallback "<stderr read did not complete after process exit>"
  return [pscustomobject]@{
    Command = $command
    ExitCode = $proc.ExitCode
    Stdout = $stdoutText
    Stderr = $stderrText
    TimedOut = $false
    TimeoutSec = $TimeoutSec
  }
}

function Invoke-GitText {
  param([string[]]$GitArgs)
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git @GitArgs 2>$null
    return (($output | Out-String).TrimEnd())
  }
  finally {
    $ErrorActionPreference = $oldPreference
  }
}

function Test-GitRef {
  param([string]$Ref)
  if ([string]::IsNullOrWhiteSpace($Ref)) { return $false }
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & git rev-parse --verify --quiet $Ref *> $null
    return ($LASTEXITCODE -eq 0)
  }
  finally {
    $ErrorActionPreference = $oldPreference
  }
}

function Resolve-ReviewBaseRef {
  param([string]$BaseRef = "")
  if (-not [string]::IsNullOrWhiteSpace($BaseRef)) {
    if (Test-GitRef $BaseRef) { return $BaseRef }
    throw "Base ref not found: $BaseRef"
  }

  foreach ($candidate in @("origin/master", "master", "origin/main", "main")) {
    if (Test-GitRef $candidate) { return $candidate }
  }

  return ""
}
