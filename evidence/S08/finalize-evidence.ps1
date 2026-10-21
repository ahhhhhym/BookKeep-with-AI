$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$root = (Get-Location).Path
$target = Join-Path $root 'evidence/S08'
$o = Get-Content -Raw -Encoding utf8 "$target/observation/observations.json" | ConvertFrom-Json
$m = Get-Content -Raw -Encoding utf8 "$target/manual/ui-workflow.json" | ConvertFrom-Json
$u = Get-Content -Raw -Encoding utf8 "$target/unit-results.json" | ConvertFrom-Json
$commands = @(Get-Content -Raw -Encoding utf8 "$target/command-results.json" | ConvertFrom-Json)
$calc = Get-Content -Raw -Encoding utf8 "$target/calculations.json" | ConvertFrom-Json
$summary = Get-Content -Raw -Encoding utf8 "$target/result-summary.json" | ConvertFrom-Json
$f01Sql = ($m.checks | Where-Object id -eq 'actual-process-restart-and-sql-display-reconciliation').detail.active
if ($f01Sql.totalFen -ne 3330 -or $f01Sql.count -ne 3) { throw 'F01 latest results mismatch' }
if ($o.observations.f02.sql.total[0].totalFen -ne '96530' -or $o.observations.f02Restart.sql.total[0].totalFen -ne '96530') { throw 'F02 latest SQL mismatch' }
foreach ($period in 'week','month','year') {
    if ($o.observations.f02.$period.series.totalFen -ne '96530' -or $o.observations.f02.$period.summary.totalFen -ne '96530' -or $o.observations.f02.$period.ranking.totalFen -ne '96530') { throw 'F02 latest view mismatch' }
    if ($o.observations.current.$period.summary.totalFen -ne '3000') { throw 'Current period mismatch' }
}
if ($o.observations.f02.month.summary.dailyAverage.displayYuan -ne '32.18' -or $o.observations.current.week.summary.dailyAverage.displayYuan -ne '10.00') { throw 'Average mismatch' }
if (-not $o.complete -or -not $u.success -or $u.numPassedTests -ne 181 -or @($commands | Where-Object exitCode -ne 0).Count) { throw 'Latest acceptance command failed' }
$inputHashes = foreach ($file in 'observation/observations.json','manual/ui-workflow.json','statistics/ui-workflow.json','statistics-probes/additional-probes.json','unit-results.json') {
    [ordered]@{ file=$file; sha256=(Get-FileHash -LiteralPath (Join-Path $target $file)).Hash }
}
$calc | Add-Member -NotePropertyName finalExplicitShellRevalidatedAt -NotePropertyValue (Get-Date -Format o) -Force
$calc | Add-Member -NotePropertyName latestInputHashes -NotePropertyValue @($inputHashes) -Force
$calc | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 "$target/calculations.json"
$summary | Add-Member -NotePropertyName finalExplicitShell -NotePropertyValue '7.6.7 Core; shell-verification.json; all 11 commands exit 0' -Force
$summary | Add-Member -NotePropertyName latestInputHashes -NotePropertyValue @($inputHashes) -Force
$summary | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 "$target/result-summary.json"
$diffs = foreach ($line in Get-Content -Encoding utf8 "$target/FROZEN-TRACKED.sha256") {
    if ($line -match '^([A-Fa-f0-9]{64})  (.+)$') {
        $expected=$Matches[1]; $p=$Matches[2]
        $actual=if(Test-Path -LiteralPath $p){(Get-FileHash -LiteralPath $p).Hash}else{'MISSING'}
        if($actual -ne $expected){[ordered]@{path=$p;before=$expected;after=$actual}}
    }
}
$buildDiffs = foreach ($line in Get-Content -Encoding utf8 "$target/FROZEN-BUILD.sha256") {
    if($line -match '^([A-Fa-f0-9]{64})  (.+)$') {
        $expected=$Matches[1]; $p=$Matches[2]
        if((Get-FileHash -LiteralPath $p).Hash -ne $expected){$p}
    }
}
$unexpected = @($diffs | Where-Object {$_.path -ne '执行看板.md'})
if($unexpected.Count -or @($buildDiffs).Count){throw 'Unexpected frozen file change'}
$processes = @(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(node|electron|BookKeepAI)\.exe$' -and $_.CommandLine -like '*D:\BookKeep with AI*'} | Select-Object ProcessId,Name,CommandLine)
if($processes.Count){throw 'Project background processes remain'}
$inventory = @(Get-ChildItem -LiteralPath $target -File -Recurse)
$binary = @($inventory | Where-Object {$_.Extension -match '^\.(db|sqlite|sqlite3|zip|exe|key|pem)$'} | ForEach-Object FullName)
$sensitive = @()
foreach($f in $inventory | Where-Object {$_.Extension -in @('.json','.log','.md','.txt','.mjs','.sql','.sha256','.ps1')}) {
    $data=[IO.File]::ReadAllText($f.FullName,[Text.Encoding]::UTF8)
    if($data -match '(?i)Bearer\s+[a-z0-9_\-\.]{16,}|sk-[a-zA-Z0-9]{20,}|data:image/[^;]+;base64,[a-zA-Z0-9+/]{80,}'){$sensitive+=$f.FullName}
}
if($binary.Count -or $sensitive.Count){throw 'Sensitive or database artifact requires review'}
$check = [ordered]@{
    checkedAt=Get-Date -Format o
    frozenCommit=(git rev-parse HEAD)
    actualPowerShell=$PSVersionTable.PSVersion.ToString()
    edition=$PSVersionTable.PSEdition
    actualPowerShellProcess=(Get-Process -Id $PID).Path
    finalCommandCount=$commands.Count
    finalCommandFailures=@($commands | Where-Object exitCode -ne 0)
    trackedFrozen=607
    trackedUnchanged=(607-@($diffs).Count)
    allowedTrackedDifferences=@($diffs)
    unexpectedTrackedDifferences=$unexpected
    sourceTestsScriptsResourcesChanged=$false
    buildFrozen=5
    buildDifferences=@($buildDiffs)
    projectProcesses=$processes
    newEvidenceFileCountAtCheck=$inventory.Count
    unexpectedDatabaseOrArchive=$binary
    sensitivePatternMatches=$sensitive
    gitStatusAtCheck=@(git -c core.quotepath=false status --short)
    phase='Final explicit requested PowerShell acceptance; before evidence commit'
    g1='NOT_PASSED'
    s09Allowed=$false
    blockers=@('BK-S08-001')
    limitations='Persisted candidate state isolation not executed; human UI/IME/screen reader/system DPI/real system midnight/Win11/clean machine/formal ZIP/API not certified'
}
$check | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 "$target/final-check.json"
$paths = @((Get-ChildItem -LiteralPath $target -Recurse -File | Where-Object {$_.FullName -ne (Join-Path $target 'OUTPUTS.sha256')} | ForEach-Object FullName))
$paths += (Join-Path $root 'issues/BK-S08-001.md'), (Join-Path $root 'handoff/S08/HANDOFF.md'), (Join-Path $root '执行看板.md')
$manifest = foreach ($p in $paths | Sort-Object -Unique) {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $p).Hash,([IO.Path]::GetRelativePath($root,$p).Replace('\','/'))
}
$manifest | Set-Content -Encoding utf8 "$target/OUTPUTS.sha256"
$check | ConvertTo-Json -Depth 5
Write-Host ('Output manifest entries: ' + @($manifest).Count)
