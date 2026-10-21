$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$e='evidence/S08-R2'
if(Test-Path "$e/freeze.json"){throw 'Existing freeze: create a new run, never overwrite'}
New-Item -ItemType Directory -Force "$e/before","$e/logs" | Out-Null
function J($p,$v){$v | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $p -Encoding utf8}
$status=@(git -c core.quotepath=false status --short)
$tracked=@(git -c core.quotepath=false ls-files)
$hashes=@($tracked | ForEach-Object {[ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath $_).Hash}})
J "$e/FROZEN-TRACKED.json" $hashes
$newInputs=@('tasks/S08.md','tasks/S11.md','tasks/S17.md','handoff/S07/AC07-REWORK.md')+@(Get-ChildItem evidence/S07-AC07-REWORK -Recurse -File | ForEach-Object {$_.FullName.Substring((Get-Location).Path.Length+1).Replace('\','/')})
J "$e/FROZEN-D49.json" @($newInputs | ForEach-Object {[ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath $_).Hash}})
$build=@(Get-ChildItem dist -Recurse -File | ForEach-Object {[ordered]@{path=$_.FullName.Substring((Get-Location).Path.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}})
J "$e/FROZEN-BUILD.json" $build
$versions=@(foreach($ref in @('47b60fe503c38e05497e0252879587f2dfc6d5bc','ecc97950b62cf6eb71dddc69c15039e2374f6ed0','65d2e16')){
 $full=(git rev-parse "$ref`^{commit}").Trim(); if($LASTEXITCODE){throw 'Git resolve failed'}
 git merge-base --is-ancestor $full HEAD; if($LASTEXITCODE){throw 'Not ancestor'}
 [ordered]@{ref=$ref;commit=$full;ancestorOfHead=$true;subject=(git show -s --format=%s $full)}
})
$protected=@(git -c core.quotepath=false ls-files src tests scripts resources build package.json package-lock.json electron-builder.yml 'tsconfig*' '*config*')
J "$e/FROZEN-PRODUCT.json" @($protected | ForEach-Object {[ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath $_).Hash}})
$diffs=@(foreach($ref in @('47b60fe','ecc9795')){[ordered]@{ref=$ref;names=@(git -c core.quotepath=false diff --name-only $ref -- @protected)}})
$processes=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(node|electron|vite|npm)(\.exe)?$' -and ($_.CommandLine -like '*D:\BookKeep with AI*' -or $_.ExecutablePath -like 'D:\BookKeep with AI\*')} | Select-Object ProcessId,Name,ExecutablePath,CommandLine)
if($processes.Count){J "$e/project-processes-before.json" $processes;throw 'Project writer or app running: inspect before stopping'}
$manifests=@(foreach($m in @('evidence/S07/SOURCE.sha256','evidence/S07/BUILD.sha256','evidence/S07-AC07-REWORK/OUTPUTS.sha256','evidence/S08/OUTPUTS.sha256')){
 $rows=@(foreach($line in Get-Content -LiteralPath $m){if($line -match '^([A-Fa-f0-9]{64})\s+(.+)$'){
  $expected=$Matches[1];$f=$Matches[2];$lookup=$f;$reason='current file'
  if($m -eq 'evidence/S08/OUTPUTS.sha256' -and $f -in @('执行看板.md','issues/BK-S08-001.md')){$lookup='evidence/S07-AC07-REWORK/before/'+$f;$reason='D49 authorized revision: historical bytes in before; original manifest retained'}
  $actual=if(Test-Path -LiteralPath $lookup){(Get-FileHash -LiteralPath $lookup).Hash}else{'MISSING'}
  [ordered]@{path=$f;verifiedPath=$lookup;expected=$expected;actual=$actual;matches=($expected -eq $actual);reason=$reason;currentHash=if(Test-Path -LiteralPath $f){(Get-FileHash -LiteralPath $f).Hash}else{'MISSING'}}
 }})
 [ordered]@{manifest=$m;count=$rows.Count;entries=$rows;failures=@($rows | Where-Object {!$_.matches})}
})
# Historical object manifests are verified against their own immutable Git blobs.
$historical=@(foreach($row in @(@('evidence/S04/OUTPUTS.sha256','7ffbed3'),@('evidence/S05/OUTPUTS.sha256','29f0a51'),@('evidence/S06/SOURCE.sha256','fa034a3'))){
 $m=$row[0];$ref=$row[1];$lines=@(git show "${ref}:$m" 2>$null)
 if($LASTEXITCODE){$ref=(git log -1 --format=%H -- $m).Trim();$lines=@(git show "${ref}:$m")}
 $entries=@(foreach($l in $lines){if($l -match '^([A-Fa-f0-9]{64})\s+(.+)$'){
  $expected=$Matches[1];$f=$Matches[2]
  # git binary stdout must not pass through text decoding.
  $psi=[Diagnostics.ProcessStartInfo]::new('git');$psi.ArgumentList.Add('show');$psi.ArgumentList.Add("${ref}:$f");$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.UseShellExecute=$false
  $p=[Diagnostics.Process]::Start($psi);$ms=[IO.MemoryStream]::new();$p.StandardOutput.BaseStream.CopyTo($ms);$p.WaitForExit()
  $actual=if($p.ExitCode -eq 0){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($ms.ToArray()))}else{'NOT_IN_COMMIT'}
  [ordered]@{path=$f;expected=$expected;actual=$actual;matches=($expected -eq $actual)}
 }})
 [ordered]@{manifest=$m;commit=$ref;count=$entries.Count;entries=$entries;failures=@($entries | Where-Object {!$_.matches})}
})
J "$e/input-verification.json" ([ordered]@{manifests=$manifests;historical=$historical;protectedDiffs=$diffs})
$docs=@('AGENTS.md','执行看板.md','tasks/S08.md','开发方案.md','交接与验收.md','docs/PRD.md','docs/ACCEPTANCE.md','docs/FIXTURES.md','docs/DECISIONS.md','docs/ARCHITECTURE.md','docs/CONTRACTS.md','docs/UX.md','handoff/S04/HANDOFF.md','handoff/S05/HANDOFF.md','handoff/S06/HANDOFF.md','handoff/S07/HANDOFF.md','evidence/RECEIPT-S04-S05/RECEIPT.md','handoff/S05/ACCEPTANCE-R2.md','handoff/S06/ACCEPTANCE-R1.md','handoff/S07/ACCEPTANCE-R1.md','handoff/S07/AC07-REWORK.md','evidence/S07-AC07-REWORK/REVIEW.md','evidence/S07-AC07-REWORK/input-verification.json','evidence/S07-AC07-REWORK/final-check.json','evidence/S07-AC07-REWORK/OUTPUTS.sha256','handoff/S08/HANDOFF.md','evidence/S08/ACCEPTANCE.md','evidence/S08/freeze.json','evidence/S08/final-check.json','evidence/S08/OUTPUTS.sha256','issues/BK-S08-001.md','tasks/S11.md','tasks/S17.md')
$docs | ForEach-Object {'{0}  {1}' -f (Get-FileHash -LiteralPath $_).Hash,$_} | Set-Content "$e/INPUTS.sha256" -Encoding utf8
foreach($f in @('执行看板.md','AGENTS.md','README.md','开始阅读.md','docs/ACCEPTANCE.md','issues/BK-S08-001.md')){$d=Join-Path "$e/before" $f;New-Item -ItemType Directory -Force (Split-Path $d)|Out-Null;Copy-Item -LiteralPath $f -Destination $d}
J "$e/freeze.json" ([ordered]@{startedAt=(Get-Date -Format o);requestedShell='C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe';actualProcess=(Get-Process -Id $PID).Path;version=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;head=(git rev-parse HEAD).Trim();branch=(git branch --show-current).Trim();initialGitStatus=$status;versions=$versions;productDiffs=$diffs;projectProcesses=$processes;node=(& node --version);npm=(& npm.cmd --version);os=(Get-CimInstance Win32_OperatingSystem|Select-Object Caption,Version,OSArchitecture);timezone=(Get-TimeZone).Id;role='Codex previously implemented; separate acceptance phase/evidence, no different-author independence';initialChangesOrigin='D49 documents: all modified tracked paths listed by prior final-check, and outputs validated';trackedCount=$hashes.Count;buildCount=$build.Count})
if(@($manifests.failures).Count -or @($historical.failures).Count -or @($diffs.names).Count){throw 'Input chain verification failure: inspect JSON'}
Write-Output ('Verified manifests: '+($manifests.count -join ',')+'; historical objects: '+($historical.count -join ',')+'; product '+$protected.Count+'; no project processes')
