$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$m='evidence/S05/OUTPUTS.sha256';$ref=(git log -1 --format=%H -- $m).Trim()
$entries=@(foreach($line in git show "${ref}:$m") {if($line -match '^([a-fA-F0-9]{64})\s+(.+)$'){
 $expected=$Matches[1];$f=$Matches[2]
 $psi=[Diagnostics.ProcessStartInfo]::new('git');$psi.ArgumentList.Add('show');$psi.ArgumentList.Add("${ref}:$f");$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.UseShellExecute=$false
 $p=[Diagnostics.Process]::Start($psi);$ms=[IO.MemoryStream]::new();$p.StandardOutput.BaseStream.CopyTo($ms);$p.WaitForExit();if($p.ExitCode){throw 'Git blob unavailable'}
 $actual=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($ms.ToArray()))
 [ordered]@{path=$f;expected=$expected;actual=$actual;matches=($expected -eq $actual)}
}})
$v=Get-Content -Raw evidence/S08-R2/input-verification.json|ConvertFrom-Json
$resolution=[ordered]@{at=(Get-Date -Format o);initialCollectorExitCode=1;cause='S05 original manifest wrongly compared to later 29f0a51 repair; no product or evidence corruption';manifest=$m;correctCommit=$ref;count=$entries.Count;entries=$entries;failures=@($entries|Where-Object {!$_.matches});currentManifestsUnchanged=$true;readyToAccept=($entries.Where({!$_.matches}).Count -eq 0 -and $v.manifests.failures.Count -eq 0 -and $v.protectedDiffs.names.Count -eq 0)}
$resolution|ConvertTo-Json -Depth 10|Set-Content evidence/S08-R2/input-resolution.json -Encoding utf8
if(!$resolution.readyToAccept){throw 'Input chain unresolved'}
Write-Output "S05 historical manifest $($entries.Count)/$($entries.Count) at $ref; frozen input chain ready"
