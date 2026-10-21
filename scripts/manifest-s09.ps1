$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskRoot
$target = Join-Path $taskRoot 'evidence/S09'
[IO.Directory]::CreateDirectory((Join-Path $target 'logs')) | Out-Null
Get-ChildItem -LiteralPath $target -File -Filter '*.log' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target ('logs/' + $_.Name)) }
function Write-Manifest($paths, $output) {
  $lines = @($paths | Sort-Object -Unique | ForEach-Object {
    $full = [IO.Path]::GetFullPath($_)
    if (!$full.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path outside workspace' }
    $relative = [IO.Path]::GetRelativePath($taskRoot, $full).Replace('\','/')
    (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
  })
  [IO.File]::WriteAllLines($output, $lines, [Text.UTF8Encoding]::new($false))
}
$source = @(rg --files src scripts tests assets build) + @('package.json','package-lock.json','vite.config.ts','vitest.config.ts','tsconfig.base.json','tsconfig.main.json','tsconfig.renderer.json','tsconfig.tests.json','electron-builder.yml')
Write-Manifest $source (Join-Path $target 'SOURCE.sha256')
Write-Manifest @(Get-ChildItem -LiteralPath dist -Recurse -File | Select-Object -ExpandProperty FullName) (Join-Path $target 'BUILD.sha256')
$original = @(); $unexpected = @(); $expectedChanges = @()
foreach ($line in Get-Content -LiteralPath evidence/S08-R2/OUTPUTS.sha256) {
  if ($line -match '^([a-fA-F0-9]{64})  (.+)$') {
    $hash = $Matches[1]; $relative = $Matches[2]; $original += $relative
    if ((Get-FileHash -LiteralPath $relative).Hash -ne $hash) {
      $before = Join-Path $target ('before/' + [IO.Path]::GetFileName($relative))
      if ((Test-Path -LiteralPath $before) -and (Get-FileHash -LiteralPath $before).Hash -eq $hash) { $expectedChanges += $relative } else { $unexpected += $relative }
    }
  }
}
$scanPaths = @('src','scripts','tests','assets/probe','evidence/S09','handoff/S09','tasks/S09.md','issues/BK-S09-001.md','issues/BK-S09-002.md')
$secretPattern = 'sk-[A-Za-z0-9]{24,}|data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]{80}'
$hits = @(rg -l --hidden --glob '!SOURCE.sha256' --glob '!OUTPUTS.sha256' --glob '!BUILD.sha256' --glob '!*.png' -- $secretPattern @scanPaths)
if ($LASTEXITCODE -gt 1) { throw 'Sensitive-pattern scan failed' }
$forbidden = @(Get-ChildItem -LiteralPath $target -Recurse -File | Where-Object { $_.Name -match '\.(db|sqlite|db-wal|db-shm)$|^deepseek\.secret\.json$|^\.env' } | Select-Object -ExpandProperty FullName)
$priorBuild = Get-Content -Raw evidence/S09/real-probe-build.json | ConvertFrom-Json
$realMain = ($priorBuild | Where-Object { $_.Path -like '*dist\main\index.cjs' }).Hash
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('electron.exe','node.exe') -and $_.CommandLine -like '*BookKeep with AI*' } | Select-Object ProcessId,Name)
$ui = Get-ChildItem -LiteralPath $target -Filter 'ui-selftest-*.json' | Sort-Object Name | Select-Object -Last 1 | ForEach-Object { Get-Content -Raw $_.FullName | ConvertFrom-Json }
$startup = Get-Content -Raw evidence/S09/startup.json | ConvertFrom-Json
$restart = Get-Content -Raw evidence/S09/startup-restart.json | ConvertFrom-Json
$unit = Get-Content -Raw evidence/S09/unit-results.json | ConvertFrom-Json
$result = @{
  date=(Get-Date).ToString('o'); head=(git rev-parse HEAD); branch=(git branch --show-current); gitStatus=@(git status --porcelain)
  powershell=$PSVersionTable.PSVersion.ToString(); edition=$PSVersionTable.PSEdition; executable=(Get-Process -Id $PID).Path
  G1='passed per S08-R2/D49; AC07-C not executed'; G2='passed real report 75e4eb46-1128-4a71-a258-4e10ee51b4ca'; S10='not started'
  realRequests=3; mockEvidenceCountsAsReal=$false; originalOutputsChecked=$original.Count; expectedChangedStateFiles=$expectedChanges; unexpectedOriginalChanges=$unexpected
  sensitivePatternFileHits=$hits; forbiddenArtifactFiles=$forbidden; scanScope='S09 source/evidence text only; no secret store read, heuristic plus reviewed data flow, not full security audit'
  realSuccessMainBundleMatchesFinal=($realMain -eq (Get-FileHash -LiteralPath dist/main/index.cjs).Hash)
  tests=@{passed=$unit.numPassedTests;failed=$unit.numFailedTests}; ui=@{ok=$ui.ok;checks=$ui.checks.Count;errors=$ui.errors.Count;reportScreenshot=$ui.finalScreenshot;smallScreenshot=$ui.smallScreenshot}
  startup=@{ok=$startup.ok;passed=@($startup.checks|Where-Object ok).Count}; restart=@{ok=$restart.ok;passed=@($restart.checks|Where-Object ok).Count}
  projectProcesses=$processes; noGitCommit=$true; noSoftwareZip=$true; noOtherChatMessages=$true
}
$result | ConvertTo-Json -Depth 7 | Set-Content -Encoding utf8 (Join-Path $target 'final-check.json')
$outputs = @(Get-ChildItem -LiteralPath $target -Recurse -File | Where-Object Name -ne 'OUTPUTS.sha256' | Select-Object -ExpandProperty FullName) + @('tasks/S09.md','handoff/S09/HANDOFF.md','issues/BK-S09-001.md','issues/BK-S09-002.md','AGENTS.md','执行看板.md','docs/DECISIONS.md','docs/CONTRACTS.md')
Write-Manifest $outputs (Join-Path $target 'OUTPUTS.sha256')
if ($unexpected.Count -or $hits.Count -or $forbidden.Count -or $processes.Count -or !$result.realSuccessMainBundleMatchesFinal -or !$ui.ok -or $unit.numFailedTests) { throw 'Final checks require review; see final-check.json' }
Write-Output ('S09 final checks passed: source=' + $source.Count + ', outputs=' + $outputs.Count + ', tests=' + $unit.numPassedTests + ', ui=' + $ui.checks.Count)
