$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }
Set-Location -LiteralPath 'D:\BookKeep with AI'
$e = 'evidence/S07-AC07-REWORK'
function WriteJson($path, $value) { $value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding utf8 }
$status = @(git -c core.quotepath=false status --short)
$tracked = @(git -c core.quotepath=false ls-files)
$hashes = @($tracked | ForEach-Object { [ordered]@{path=$_; sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash} })
WriteJson "$e/BASELINE.json" $hashes
$planned = @('AGENTS.md','执行看板.md','开发方案.md','交接与验收.md','分步中文提示词.md','docs/PRD.md','docs/ACCEPTANCE.md','docs/FIXTURES.md','docs/DECISIONS.md','README.md','开始阅读.md','文档审阅记录.md','issues/BK-S08-001.md')
foreach ($f in $planned) {
  $dest = Join-Path "$e/before" $f
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item -LiteralPath $f -Destination $dest
}
$inputs = @($planned + @('tasks/S07.md','handoff/S07/HANDOFF.md','handoff/S07/ACCEPTANCE-R1.md','handoff/S08/HANDOFF.md','evidence/S08/ACCEPTANCE.md','evidence/S08/freeze.json','evidence/S08/final-check.json','evidence/S08/OUTPUTS.sha256','evidence/S07/SOURCE.sha256','evidence/S07/BUILD.sha256'))
$inputs | Sort-Object -Unique | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash,$_ } | Set-Content "$e/INPUTS.sha256" -Encoding utf8
$versions = foreach ($ref in @('47b60fe','ecc9795','65d2e16')) {
  $full = (git rev-parse "$ref^{commit}").Trim()
  git merge-base --is-ancestor $full HEAD
  if ($LASTEXITCODE -ne 0) { throw "Not ancestor: $ref" }
  [ordered]@{ref=$ref; commit=$full; ancestorOfHead=$true; summary=(git show -s --format='%s' $full); latestHandoffCommit=(git log -1 --format='%H' $full -- handoff/S08/HANDOFF.md)}
}
$manifests = foreach ($m in @('evidence/S08/OUTPUTS.sha256','evidence/S07/SOURCE.sha256','evidence/S07/BUILD.sha256')) {
  $rows = foreach ($line in Get-Content -LiteralPath $m -Encoding utf8) {
    if ($line -match '^([A-Fa-f0-9]{64})\s+(.+)$') {
      $file = $Matches[2]; $expected = $Matches[1].ToUpperInvariant()
      $actual = if (Test-Path -LiteralPath $file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash } else { 'MISSING' }
      [ordered]@{path=$file; expected=$expected; actual=$actual; matches=($expected -eq $actual)}
    }
  }
  [ordered]@{manifest=$m; count=@($rows).Count; failures=@($rows | Where-Object { !$_.matches }); entries=@($rows)}
}
$protectedDiff = @(git -c core.quotepath=false diff 47b60fe HEAD -- src tests scripts resources package.json package-lock.json tsconfig.json electron-builder.yml)
$projectProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|electron|vite|npm)(\.exe)?$' -and $_.CommandLine -like '*D:\BookKeep with AI*' } | Select-Object ProcessId,Name,CommandLine)
WriteJson "$e/input-verification.json" ([ordered]@{checkedAt=(Get-Date -Format o); head=(git rev-parse HEAD); branch=(git branch --show-current); initialStatusBeforeEvidence='clean (direct git status --short returned no entries)'; statusAfterPreflightFileCreation=$status; shell=[ordered]@{requested='C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe'; version=$PSVersionTable.PSVersion.ToString(); edition=$PSVersionTable.PSEdition; processPath=(Get-Process -Id $PID).Path}; versions=@($versions); manifests=@($manifests); protectedDiff47b60feToHead=$protectedDiff; projectProcesses=$projectProcesses; trackedCount=$tracked.Count; historicalEvidence='All existing evidence and handoff files frozen by BASELINE.json; no prior evidence rewritten'})
if (@($manifests | Where-Object { $_.failures.Count -gt 0 }).Count -gt 0) { throw 'Input manifest mismatch' }
Write-Output "Verified $($tracked.Count) tracked files; manifests: $($manifests.count -join ', '); protected diff lines: $($protectedDiff.Count); project processes: $($projectProcesses.Count)"
