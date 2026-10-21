$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $taskRoot
$taskTarget = 'evidence/RECEIPT-S09-R1'
$taskAllowed = @('AGENTS.md','执行看板.md','README.md','开始阅读.md','文档审阅记录.md','docs/ACCEPTANCE.md')
function Get-ManifestResult([string]$manifest, [bool]$allowState = $false) {
  $count = 0; $changed = @(); $unexpected = @()
  foreach ($line in Get-Content -LiteralPath $manifest -Encoding utf8) {
    if ($line -notmatch '^([a-fA-F0-9]{64})  (.+)$') { throw ('Malformed manifest: ' + $manifest) }
    $hash = $Matches[1]; $relative = $Matches[2]; $count++
    if (!(Test-Path -LiteralPath $relative) -or (Get-FileHash -LiteralPath $relative).Hash -ne $hash) {
      $before = Join-Path ($taskTarget + '/before') $relative
      if ($allowState -and $relative -in $taskAllowed -and (Test-Path -LiteralPath $before) -and (Get-FileHash -LiteralPath $before).Hash -eq $hash) { $changed += $relative }
      else { $unexpected += $relative }
    }
  }
  return @{manifest=$manifest;checked=$count;expectedStateChanges=$changed;unexpectedChanges=$unexpected;ok=($unexpected.Count -eq 0)}
}
$taskChecks = @(
  Get-ManifestResult ($taskTarget + '/INPUTS.sha256') $true
  Get-ManifestResult ($taskTarget + '/SOURCE-before.sha256')
  Get-ManifestResult ($taskTarget + '/BUILD-before.sha256')
  Get-ManifestResult 'evidence/S09/OUTPUTS.sha256' $true
)
$taskUnit = Get-Content -Raw -Encoding utf8 ($taskTarget + '/unit-results.json') | ConvertFrom-Json
$taskUi = Get-ChildItem -LiteralPath $taskTarget -Filter 'ui-selftest-*.json' | Sort-Object Name | Select-Object -Last 1 | ForEach-Object { Get-Content -Raw -Encoding utf8 $_.FullName | ConvertFrom-Json }
$taskIsolatedRuns = @(Get-ChildItem -LiteralPath $taskTarget -Filter 'isolated-acceptance-*.json' | Sort-Object Name | ForEach-Object { Get-Content -Raw -Encoding utf8 $_.FullName | ConvertFrom-Json })
$taskIsolated = $taskIsolatedRuns | Select-Object -Last 1
$taskReal = Get-ChildItem -LiteralPath $taskTarget -Filter 'real-acceptance-*.json' | Sort-Object Name | Select-Object -Last 1 | ForEach-Object { Get-Content -Raw -Encoding utf8 $_.FullName | ConvertFrom-Json }
$taskStartup = Get-Content -Raw -Encoding utf8 ($taskTarget + '/startup-summary.json') | ConvertFrom-Json
$taskScan = @(rg -l --hidden -g '!*.png' -g '!*.sha256' -- 'sk-[A-Za-z0-9]{24,}|data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]{80}' src scripts tests assets/probe evidence/S09 evidence/RECEIPT-S09-R1 handoff/S09 tasks/S09.md issues/BK-S09-003.md)
if ($LASTEXITCODE -gt 1) { throw 'Sensitive scan failed' }
$taskForbidden = @(Get-ChildItem -LiteralPath $taskTarget -Recurse -File | Where-Object { $_.Name -match '\.(db|sqlite|db-wal|db-shm)$|^deepseek\.secret\.json$|^\.env' } | Select-Object -ExpandProperty Name)
$taskProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('electron.exe','node.exe') -and $_.CommandLine -like '*BookKeep with AI*' } | Select-Object ProcessId,Name)
$taskResult = @{
  at=(Get-Date).ToString('o');head=(git rev-parse HEAD);branch=(git branch --show-current)
  powershell=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition
  status='S09-R1 accepted; G2 passed';next='Codex S10, waits for separate user start';S10='not started';G3toG6='not passed';AC07C='not executed; S11/G3 then S17'
  manifestChecks=$taskChecks
  unit=@{passed=$taskUnit.numPassedTests;failed=$taskUnit.numFailedTests;files=$taskUnit.testResults.Count}
  ui=@{ok=$taskUi.ok;checks=$taskUi.checks.Count;errors=$taskUi.errors.Count}
  isolated=@{ok=$taskIsolated.ok;checks=$taskIsolated.checks.Count;failedCollectorRunsPreserved=@($taskIsolatedRuns | Where-Object { !$_.ok }).Count}
  real=@{ok=$taskReal.ok;checks=$taskReal.checks.Count;reportId=$taskReal.realReportId;httpCalls=$taskReal.transport.calls;tokens=$taskReal.report.usage.totalTokens;passed=$taskReal.report.passed}
  startup=@{ok=$taskStartup.ok;first=@($taskStartup.firstReport.checks | Where-Object ok).Count;restart=@($taskStartup.report.checks | Where-Object ok).Count}
  sensitivePatternFileHits=$taskScan;forbiddenArtifactFiles=$taskForbidden;projectProcesses=$taskProcesses
  noProductChangesThisRound=$true;noOriginalTestsScriptsChanged=$true;noSoftwareZip=$true;noGitCommit=$true;noOtherChatMessages=$true
  gitStatus=@(git status --porcelain)
}
$taskResult | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 ($taskTarget + '/final-check.json')
if (@($taskChecks | Where-Object { !$_.ok }).Count -or $taskUnit.numFailedTests -or !$taskUi.ok -or !$taskIsolated.ok -or !$taskReal.ok -or !$taskStartup.ok -or $taskScan.Count -or $taskForbidden.Count -or $taskProcesses.Count) { throw 'Final verification failed; inspect final-check.json' }
$taskOutputPaths = @(Get-ChildItem -LiteralPath $taskTarget -Recurse -File | Where-Object { $_.Name -notin @('OUTPUTS.sha256','output-verification.json') } | Select-Object -ExpandProperty FullName) + @('handoff/S09/ACCEPTANCE-R1.md','issues/BK-S09-003.md') + $taskAllowed
$taskOutputLines = @($taskOutputPaths | ForEach-Object { [IO.Path]::GetRelativePath($taskRoot,[IO.Path]::GetFullPath($_)).Replace('\','/') } | Sort-Object -Unique | ForEach-Object { (Get-FileHash -LiteralPath $_).Hash.ToLowerInvariant() + '  ' + $_ })
[IO.File]::WriteAllLines((Join-Path $taskRoot ($taskTarget + '/OUTPUTS.sha256')), $taskOutputLines, [Text.UTF8Encoding]::new($false))
$taskOutputVerify = Get-ManifestResult ($taskTarget + '/OUTPUTS.sha256')
$taskOutputVerify | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 ($taskTarget + '/output-verification.json')
if (!$taskOutputVerify.ok) { throw 'Output verification failed' }
@{status=$taskResult.status;manifestChecks=$taskChecks;outputs=$taskOutputVerify.checked;tests=$taskResult.unit;ui=$taskResult.ui;isolated=$taskResult.isolated;real=$taskResult.real;startup=$taskResult.startup;projectProcesses=$taskProcesses} | ConvertTo-Json -Depth 6
