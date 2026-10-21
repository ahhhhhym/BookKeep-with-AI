$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$old='evidence/S08/statistics/ui-workflow.json'
$expected=(Get-Content -Raw evidence/S08-R2/FROZEN-TRACKED.json|ConvertFrom-Json|Where-Object path -eq $old).sha256
New-Item -ItemType Directory -Force evidence/S08-R2/attempt1-routing | Out-Null
Copy-Item -LiteralPath $old -Destination evidence/S08-R2/attempt1-routing/ui-workflow.json
$psi=[Diagnostics.ProcessStartInfo]::new('git');$psi.ArgumentList.Add('show');$psi.ArgumentList.Add("HEAD:$old");$psi.RedirectStandardOutput=$true;$psi.UseShellExecute=$false
$p=[Diagnostics.Process]::Start($psi);$ms=[IO.MemoryStream]::new();$p.StandardOutput.BaseStream.CopyTo($ms);$p.WaitForExit()
$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($ms.ToArray()))
if($p.ExitCode -ne 0 -or $hash -ne $expected){throw 'Immutable recovery source not verified'}
[IO.File]::WriteAllBytes((Join-Path (Get-Location) $old),$ms.ToArray())
$f='evidence/S08-R2/replay-s07.mjs';Copy-Item $f evidence/S08-R2/attempt1-routing/replay-s07.mjs
$s=Get-Content -Raw $f
$t=$s.Replace("'evidence', 'S08', 'statistics'","'evidence', 'S08-R2', 'statistics'")
Set-Content -LiteralPath $f -Value $t -NoNewline -Encoding utf8
$delta=@(Get-Content -Raw evidence/S08-R2/FROZEN-TRACKED.json|ConvertFrom-Json|Where-Object {(Get-FileHash -LiteralPath $_.path).Hash -ne $_.sha256})
$untracked=@(git -c core.quotepath=false ls-files --others --exclude-standard evidence/S08)
$r=[ordered]@{at=(Get-Date -Format o);cause='Missed segmented path in new replay copy; historical JSON temporarily overwritten by new synthetic run';restoredFile=$old;frozenHash=$expected;verifiedGitBlobHash=$hash;restoredHash=(Get-FileHash $old).Hash;preservedNewResult='attempt1-routing/ui-workflow.json';otherFrozenDifferences=$delta;newHistoricalPaths=$untracked;correctedCopy=$f;source='evidence/S08/replay-s07.mjs';sourceHash=(Get-FileHash evidence/S08/replay-s07.mjs).Hash;copyHash=(Get-FileHash $f).Hash;diff=@(git diff --no-index -- evidence/S08/replay-s07.mjs $f);productChanged=$false;historicalFinalBytesPreserved=($delta.Count -eq 0 -and $untracked.Count -eq 0)}
$r|ConvertTo-Json -Depth 9|Set-Content evidence/S08-R2/routing-incident.json -Encoding utf8
if(!$r.historicalFinalBytesPreserved){throw 'Historical differences require review'}
Write-Output 'Historical frozen bytes restored and verified; new result preserved; rerun corrected copy only'
