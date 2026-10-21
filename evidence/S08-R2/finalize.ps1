$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$e='evidence/S08-R2'
if(Test-Path "$e/final-check.json"){throw 'Do not overwrite final result'}
$start=Get-Date -Format o
& node.exe "$e/summarize.mjs" 2>&1|Tee-Object "$e/logs/summarize.log"
if($LASTEXITCODE){throw 'Summary source evidence assertion failed'}
function J($p,$v){$v|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $p -Encoding utf8}
function Get-FrozenHashComparison($p){@(Get-Content -Raw -LiteralPath $p|ConvertFrom-Json|ForEach-Object{ $actual=if(Test-Path -LiteralPath $_.path){(Get-FileHash -LiteralPath $_.path).Hash}else{'MISSING'};[ordered]@{path=$_.path;before=$_.sha256;after=$actual;matches=($_.sha256 -eq $actual)}})}
$tracked=Get-FrozenHashComparison "$e/FROZEN-TRACKED.json";$product=Get-FrozenHashComparison "$e/FROZEN-PRODUCT.json";$build=Get-FrozenHashComparison "$e/FROZEN-BUILD.json";$d49=Get-FrozenHashComparison "$e/FROZEN-D49.json"
$allowed=@('AGENTS.md','README.md','开始阅读.md','执行看板.md','docs/ACCEPTANCE.md','issues/BK-S08-001.md')
$different=@($tracked|Where-Object {!$_.matches})
$unexpected=@($different|Where-Object {$_.path -notin $allowed})
$history=@($tracked|Where-Object {$_.path -match '^(evidence|handoff)/'})
$historyDelta=@($history|Where-Object {!$_.matches})
$processes=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(node|electron|vite|npm)(\.exe)?$' -and ($_.CommandLine -like '*D:\BookKeep with AI*' -or $_.ExecutablePath -like 'D:\BookKeep with AI\*')}|Select-Object ProcessId,Name,ExecutablePath,CommandLine)
$tasks=@(foreach($f in @('tasks/S11.md','tasks/S17.md')){
 $text=Get-Content -Raw -LiteralPath $f;$row=$d49|Where-Object path -eq $f
 [ordered]@{path=$f;hash=$row.after;unchanged=$row.matches;openCheckboxes=([regex]::Matches($text,'- \[ \]')).Count;checkedCheckboxes=([regex]::Matches($text,'- \[[xX]\]')).Count;CStatusRetained=$text.Contains('未执行，待S11/G3验证、S17复验')}
})
# The D49 manifest remains byte-identical. Current status entries are validated against this round's before snapshots.
$d49Manifest=@(foreach($line in Get-Content evidence/S07-AC07-REWORK/OUTPUTS.sha256){if($line -match '^([A-Fa-f0-9]{64})\s+(.+)$'){
 $expected=$Matches[1];$f=$Matches[2];$lookup=if($f -in $allowed){"$e/before/$f"}else{$f}
 $actual=(Get-FileHash -LiteralPath $lookup).Hash
 [ordered]@{path=$f;verifiedPath=$lookup;expected=$expected;actual=$actual;matches=($expected -eq $actual);reason=if($lookup -ne $f){'Authorized current status update; prior bytes retained in S08-R2/before; original manifest not recalculated'}else{'unchanged'}}
}})
$files=@(Get-ChildItem -LiteralPath $e -Recurse -File)
$badData=@($files|Where-Object {$_.Extension -in @('.db','.sqlite','.sqlite3','.bkdb','.zip','.wal','.shm','.env','.key','.pem')})
$patternHits=@(foreach($f in $files|Where-Object {$_.Extension -in @('.json','.log','.md','.txt')}){
 $s=Get-Content -Raw -LiteralPath $f.FullName
 if($s -match '(?i)Bearer\s+[A-Za-z0-9_\-]{20,}|sk-[a-zA-Z0-9]{20,}|data:image/[^;]+;base64,[a-zA-Z0-9+/]{100,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'){ $f.FullName }
})
git diff --check
$diffExit=$LASTEXITCODE
$status=@(git -c core.quotepath=false status --short)
$initial=Get-Content -Raw "$e/freeze.json"|ConvertFrom-Json
$final=[ordered]@{checkedAt=(Get-Date -Format o);startedAt=$start;head=(git rev-parse HEAD).Trim();branch=(git branch --show-current).Trim();initialHead=$initial.head;headUnchanged=((git rev-parse HEAD).Trim() -eq $initial.head);shell=[ordered]@{requested='C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe';actual=(Get-Process -Id $PID).Path;version=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition};trackedCount=$tracked.Count;trackedUnchanged=@($tracked|Where-Object matches).Count;statusOnlyDifferences=$different;unexpectedTracked=$unexpected;productCount=$product.Count;productDifferences=@($product|Where-Object {!$_.matches});buildCount=$build.Count;buildDifferences=@($build|Where-Object {!$_.matches});d49NewCount=$d49.Count;d49NewDifferences=@($d49|Where-Object {!$_.matches});d49Manifest=$d49Manifest;historicalTrackedCount=$history.Count;historicalDifferences=$historyDelta;historicalNewPaths=@(git -c core.quotepath=false ls-files --others --exclude-standard evidence/S08);historicalRoutingIncident='Temporary write occurred; exact frozen Git bytes restored; correct-route rerun passed; see ISSUES/routing-incident/routing-resolution';tasks=$tasks;projectProcesses=$processes;gitStatus=$status;gitDiffCheckExitCode=$diffExit;unexpectedDataFiles=@($badData.FullName);sensitiveOutputPatternMatches=$patternHits;finiteSensitiveScan='Selected patterns only; not S19 exhaustive security/privacy audit';g1='PASSED';ac07A='PASSED';ac07B='PASSED';ac07C='未执行，待S11/G3验证、S17复验';ac07Parent='NOT_PASSED';s09Started=$false;s09G1PrerequisiteSatisfied=$true;nextOwner='Codex S09; user starts separately';noProductFixes=$true;noDependencyOrMigrationChange=$true;noRealImageAPI=$true;noPublication=$true;noExternalChatMessages=$true;noDifferentAuthorClaim=$true}
$errors=@()
if($unexpected.Count){$errors+='Unexpected tracked differences'}
if(@($final.productDifferences).Count -or @($final.buildDifferences).Count -or @($final.d49NewDifferences).Count){$errors+='Frozen product/build/D49-new differences'}
if($historyDelta.Count -or @($final.historicalNewPaths).Count){$errors+='Historical artifacts changed'}
if(@($d49Manifest|Where-Object {!$_.matches}).Count){$errors+='D49 manifest mismatch including before lookup'}
if(@($tasks|Where-Object {!$_.unchanged -or !$_.CStatusRetained -or $_.checkedCheckboxes -gt 0 -or $_.openCheckboxes -eq 0}).Count){$errors+='C mandatory tasks altered/closed'}
if($processes.Count -or $badData.Count -or $patternHits.Count -or $diffExit){$errors+='Processes/data/sensitive/diff check failed'}
$final.checkFailures=$errors
J "$e/final-check.json" $final
if($errors.Count){throw ($errors -join '; ')}
# A non-recursive manifest covers all this round's files except itself and its subsequent verification record.
$paths=@(Get-ChildItem -LiteralPath $e -Recurse -File|Where-Object {$_.Name -notin @('OUTPUTS.sha256','output-verification.json')}|ForEach-Object {$_.FullName.Substring((Get-Location).Path.Length+1).Replace('\','/')})+@('handoff/S08/ACCEPTANCE-R2.md')+$allowed
$paths|Sort-Object -Unique|ForEach-Object {'{0}  {1}' -f (Get-FileHash -LiteralPath $_).Hash,$_}|Set-Content "$e/OUTPUTS.sha256" -Encoding utf8
$verify=@(foreach($line in Get-Content "$e/OUTPUTS.sha256"){if($line -match '^([A-Fa-f0-9]{64})\s+(.+)$'){$expected=$Matches[1];$f=$Matches[2];$actual=(Get-FileHash -LiteralPath $f).Hash;[ordered]@{path=$f;expected=$expected;actual=$actual;matches=($expected -eq $actual)}}})
J "$e/output-verification.json" ([ordered]@{checkedAt=(Get-Date -Format o);manifestHash=(Get-FileHash "$e/OUTPUTS.sha256").Hash;count=$verify.Count;matched=@($verify|Where-Object matches).Count;failures=@($verify|Where-Object {!$_.matches});manifestExcludes=@('OUTPUTS.sha256 itself','output-verification.json verification receipt to avoid circular hash');entries=$verify})
if(@($verify|Where-Object {!$_.matches}).Count){throw 'Output manifest mismatch'}
Write-Output "Final checks passed: product $($product.Count), build $($build.Count), historical $($history.Count); outputs $($verify.Count); G1 PASSED, AC07 parent NOT_PASSED"
