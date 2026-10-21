$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$e='evidence/S08-R2'
# Final report-only edits after finalize; recheck frozen product/history/task hashes without rerunning passed software tests.
$f=Get-Content -Raw "$e/final-check.json"|ConvertFrom-Json
if($f.checkFailures.Count){throw 'Final gate checks not passed'}
$all=@(Get-Content -Raw "$e/FROZEN-PRODUCT.json"|ConvertFrom-Json)+@(Get-Content -Raw "$e/FROZEN-BUILD.json"|ConvertFrom-Json)+@(Get-Content -Raw "$e/FROZEN-D49.json"|ConvertFrom-Json)+@(Get-Content -Raw "$e/FROZEN-TRACKED.json"|ConvertFrom-Json|Where-Object {$_.path -match '^(handoff|evidence)/'})
foreach($row in $all){if((Get-FileHash -LiteralPath $row.path).Hash -ne $row.sha256){throw "Protected hash changed: $($row.path)"}}
$allowed=@('AGENTS.md','README.md','开始阅读.md','执行看板.md','docs/ACCEPTANCE.md','issues/BK-S08-001.md')
$paths=@(Get-ChildItem -LiteralPath $e -Recurse -File|Where-Object {$_.Name -notin @('OUTPUTS.sha256','output-verification.json')}|ForEach-Object {$_.FullName.Substring((Get-Location).Path.Length+1).Replace('\','/')})+@('handoff/S08/ACCEPTANCE-R2.md')+$allowed
$paths|Sort-Object -Unique|ForEach-Object {'{0}  {1}' -f (Get-FileHash -LiteralPath $_).Hash,$_}|Set-Content "$e/OUTPUTS.sha256" -Encoding utf8
$rows=@(foreach($line in Get-Content "$e/OUTPUTS.sha256"){if($line -match '^([A-Fa-f0-9]{64})\s+(.+)$'){$expected=$Matches[1];$p=$Matches[2];$actual=(Get-FileHash -LiteralPath $p).Hash;[ordered]@{path=$p;expected=$expected;actual=$actual;matches=($expected -eq $actual)}}})
$processes=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(node|electron|vite|npm)(\.exe)?$' -and ($_.CommandLine -like '*D:\BookKeep with AI*' -or $_.ExecutablePath -like 'D:\BookKeep with AI\*')}|Select-Object ProcessId,Name)
if($processes.Count){throw 'Project process running'}
$bad=@($rows|Where-Object {!$_.matches})
$record=[ordered]@{checkedAt=(Get-Date -Format o);shellProcess=(Get-Process -Id $PID).Path;shellVersion=$PSVersionTable.PSVersion.ToString();manifestHash=(Get-FileHash "$e/OUTPUTS.sha256").Hash;count=$rows.Count;matched=$rows.Count-$bad.Count;failures=$bad;protectedFinalRecheckCount=$all.Count;protectedFinalRecheckAllMatch=$true;projectProcesses=$processes;head=(git rev-parse HEAD).Trim();manifestExcludes=@('OUTPUTS.sha256 itself','output-verification.json subsequent receipt to avoid circular hash');entries=$rows}
$record|ConvertTo-Json -Depth 12|Set-Content "$e/output-verification.json" -Encoding utf8
if($bad.Count){throw 'Output hash mismatch'}
Write-Output "SEALED $($rows.Count)/$($rows.Count), protected $($all.Count)/$($all.Count), no project process; G1 PASSED; AC07 parent NOT_PASSED"
