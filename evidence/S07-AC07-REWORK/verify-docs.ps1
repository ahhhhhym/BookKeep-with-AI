$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') { throw 'PowerShell 7 Core required' }
Set-Location -LiteralPath 'D:\BookKeep with AI'
$e = 'evidence/S07-AC07-REWORK'
function WriteJson($path, $value) { $value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding utf8 }
$modified = @('AGENTS.md','执行看板.md','开发方案.md','交接与验收.md','分步中文提示词.md','docs/PRD.md','docs/ACCEPTANCE.md','docs/FIXTURES.md','docs/DECISIONS.md','README.md','开始阅读.md','文档审阅记录.md','issues/BK-S08-001.md')
$newDocs = @('tasks/S08.md','tasks/S11.md','tasks/S17.md','handoff/S07/AC07-REWORK.md')
$baseline = @(Get-Content "$e/BASELINE.json" -Raw -Encoding utf8 | ConvertFrom-Json)
$comparisons = @($baseline | ForEach-Object {
  $actual = if (Test-Path -LiteralPath $_.path) { (Get-FileHash -LiteralPath $_.path -Algorithm SHA256).Hash } else { 'MISSING' }
  [ordered]@{path=$_.path; before=$_.sha256; after=$actual; matches=($_.sha256 -eq $actual)}
})
$changed = @($comparisons | Where-Object { !$_.matches })
$unexpected = @($changed | Where-Object { $_.path -notin $modified })
$historical = @($comparisons | Where-Object { $_.path -match '^(evidence|handoff)/' })
$protected = @($comparisons | Where-Object { $_.path -notin $modified })
$snapshots = @($modified | ForEach-Object {
  $f = $_; $original = $baseline | Where-Object path -eq $f
  [ordered]@{path=$f; matches=((Get-FileHash -LiteralPath "$e/before/$f" -Algorithm SHA256).Hash -eq $original.sha256)}
})
$checks = [System.Collections.Generic.List[object]]::new()
function Check($name, $pass) { $checks.Add([ordered]@{name=$name; passed=[bool]$pass}) }
foreach ($f in ($modified + $newDocs)) {
  $s = Get-Content -LiteralPath $f -Raw -Encoding utf8
  Check "$f : D49 trace" ($s.Contains('D49'))
  Check "$f : AC07 or current entry" ($s.Contains('AC07'))
  Check "$f : S17 responsibility" ($s.Contains('S17'))
}
foreach ($f in @('AGENTS.md','开发方案.md','交接与验收.md','docs/PRD.md','docs/ACCEPTANCE.md','tasks/S08.md','README.md','开始阅读.md')) {
  $s = Get-Content -LiteralPath $f -Raw -Encoding utf8
  Check "$f : AC01-06 plus A/B" ($s -match 'AC01～AC06' -and $s -match 'AC07-A/B')
  Check "$f : no parent AC07 auto-pass" ($s -match '整项' -and $s -match '不代表|真实证据')
}
$acceptance = Get-Content docs/ACCEPTANCE.md -Raw -Encoding utf8
Check 'No old full AC07 G1 row' ($acceptance -notmatch '\| G1 \|[^\r\n]*AC01～AC07')
Check 'A B C explicit rows' (@([regex]::Matches($acceptance, '(?m)^\| AC07-[ABC] ')).Count -eq 3)
Check 'C exact pending status' ($acceptance.Contains('未执行，待S11/G3验证、S17复验'))
Check 'Issue current status' ((Get-Content issues/BK-S08-001.md -Raw -Encoding utf8).Contains('范围/依赖已修订，待S08按新口径复验'))
Check 'G1 not passed and S09 not started' ((Get-Content 执行看板.md -Raw -Encoding utf8).Contains('G1仍未通过、S09仍未开始'))
Check 'G3 mandatory checklist' ((Get-Content tasks/S11.md -Raw -Encoding utf8) -match 'AC07-C-G3' -and (Get-Content tasks/S11.md -Raw -Encoding utf8) -match '关闭条件')
Check 'S17 mandatory checklist' ((Get-Content tasks/S17.md -Raw -Encoding utf8) -match 'AC07-C-S17' -and (Get-Content tasks/S17.md -Raw -Encoding utf8) -match '阻断G5')
$fixtures = Get-Content docs/FIXTURES.md -Raw -Encoding utf8
Check 'F03-I split and exact amounts' ($fixtures -match 'F03-I-B' -and $fixtures -match 'F03-I-C' -and $fixtures -match '9900' -and $fixtures -match '8800' -and $fixtures -match '106430' -and $fixtures -match '96530')
Check 'Approval increment integer calculation' ((96530 + 9900) -eq 106430 -and (92104 + 9900) -eq 102004 -and (4350 + 9900) -eq 14250)
Check 'All before snapshots original bytes' (@($snapshots | Where-Object { !$_.matches }).Count -eq 0)
Check 'All historical evidence and handoffs unchanged' (@($historical | Where-Object { !$_.matches }).Count -eq 0)
Check 'No unexpected tracked modifications' ($unexpected.Count -eq 0)
Check 'All 13 intended documents modified' ($changed.Count -eq 13)
# The graph models forward prerequisites only; repair/retest loops are execution transitions.
$edges = @(@('S04','S05'),@('S05','S06'),@('S06','S07'),@('S07','S08_G1_AB'),@('S08_G1_AB','S09_G2'),@('S09_G2','S10'),@('S10','S11_G3_C'),@('S11_G3_C','S12'),@('S12','S13'),@('S13','S14_G4'),@('S14_G4','S15'),@('S15','S16'),@('S16','S17_G5_ABC'))
$nodes = @($edges | ForEach-Object { $_[0]; $_[1] } | Select-Object -Unique)
$remaining = [System.Collections.Generic.List[string]]::new(); foreach ($n in $nodes) { $remaining.Add($n) }
$order = [System.Collections.Generic.List[string]]::new()
while ($remaining.Count -gt 0) {
  $ready = @($remaining | Where-Object { $node = $_; @($edges | Where-Object { $_[1] -eq $node -and $_[0] -in $remaining }).Count -eq 0 })
  if ($ready.Count -eq 0) { break }
  foreach ($n in $ready) { $order.Add($n); [void]$remaining.Remove($n) }
}
Check 'D49 forward prerequisite graph acyclic' ($remaining.Count -eq 0)
$linkRows = [System.Collections.Generic.List[object]]::new()
$utf8 = [System.Text.UTF8Encoding]::new($false,$true)
foreach ($f in ($modified + $newDocs + @("$e/REVIEW.md"))) {
  $text = $utf8.GetString([System.IO.File]::ReadAllBytes((Join-Path (Get-Location) $f)))
  foreach ($m in [regex]::Matches($text, '\[[^\]]*\]\(([^)]+)\)')) {
    $target = $m.Groups[1].Value.Trim('<','>')
    if ($target -match '^(https?://|#|mailto:)') { continue }
    $pathPart = ($target -split '#',2)[0]
    $resolved = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent (Join-Path (Get-Location) $f)) $pathPart))
    # Output reports are created by this script immediately below.
    $generated = $pathPart -match '(document-check\.json|final-check\.json|diff\.patch|changed-files\.txt|OUTPUTS\.sha256)$'
    $linkRows.Add([ordered]@{file=$f; target=$target; exists=((Test-Path -LiteralPath $resolved) -or $generated)})
  }
}
Check 'Changed document relative links resolve' (@($linkRows | Where-Object { !$_.exists }).Count -eq 0)
$scan = @(rg -n 'G1|AC07' --glob '*.md' --glob '!evidence/**' --glob '!handoff/**' --glob '!resources/**')
$scan | Set-Content "$e/current-g1-ac07-scan.txt" -Encoding utf8
$untracked = @(git -c core.quotepath=false ls-files --others --exclude-standard)
$unexpectedNew = @($untracked | Where-Object { $_ -notlike "$e/*" -and $_ -notin $newDocs })
Check 'New files restricted to documented scope' ($unexpectedNew.Count -eq 0)
$projectProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|electron|vite|npm)(\.exe)?$' -and $_.CommandLine -like '*D:\BookKeep with AI*' } | Select-Object ProcessId,Name,CommandLine)
Check 'No project background processes' ($projectProcesses.Count -eq 0)
WriteJson "$e/document-check.json" ([ordered]@{checkedAt=(Get-Date -Format o); type='Static document checks only, not software acceptance'; checks=@($checks); failures=@($checks | Where-Object { !$_.passed }); links=@($linkRows); snapshots=$snapshots; dependencyEdges=$edges; topologicalOrder=@($order); scanFile='current-g1-ac07-scan.txt'; manualSemanticReview='REVIEW.md: current definitions classified separately from historical records; final business and security invariants retained'})
git -c core.quotepath=false diff --no-ext-diff --binary | Set-Content "$e/diff.patch" -Encoding utf8
git -c core.quotepath=false diff --check
if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed' }
WriteJson "$e/final-check.json" ([ordered]@{checkedAt=(Get-Date -Format o); head=(git rev-parse HEAD); branch=(git branch --show-current); gitStatus=@(git -c core.quotepath=false status --short); baselineCount=$baseline.Count; changedTracked=$changed; protectedCount=$protected.Count; protectedUnchanged=@($protected | Where-Object matches).Count; historicalEvidenceHandoffCount=$historical.Count; historicalDifferences=@($historical | Where-Object { !$_.matches }); unexpectedTracked=$unexpected; unexpectedNew=$unexpectedNew; projectProcesses=$projectProcesses; originalSourceTestsScriptsDependenciesMigrationsUnchanged=($unexpected.Count -eq 0); checkFailures=@($checks | Where-Object { !$_.passed }); gitDiffCheckExitCode=0; softwareTestsRun=$false; s08RetestExecuted=$false; s09Started=$false; g1='NOT_PASSED'; ac07='NOT_PASSED'; ac07C='未执行，待S11/G3验证、S17复验'; nextOwner='Codex S08-R2; user starts separately'; versioning='No commit made; modified/new artifacts fixed by OUTPUTS.sha256'; manifestExcludes='OUTPUTS.sha256 itself only'})
$files = @($modified + $newDocs + @(Get-ChildItem -LiteralPath $e -File -Recurse | ForEach-Object { [System.IO.Path]::GetRelativePath((Get-Location).Path,$_.FullName).Replace('\','/') }) + @("$e/OUTPUTS.sha256","$e/changed-files.txt") | Sort-Object -Unique)
$files | Set-Content "$e/changed-files.txt" -Encoding utf8
$files | Where-Object { $_ -ne "$e/OUTPUTS.sha256" } | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash,$_ } | Set-Content "$e/OUTPUTS.sha256" -Encoding utf8
if (@($checks | Where-Object { !$_.passed }).Count -gt 0) { throw 'Document verification failed; see document-check.json' }
Write-Output "PASS: $($checks.Count) static checks; $($linkRows.Count) links; $($protected.Count) original protected files unchanged; $($historical.Count) historical evidence/handoff files unchanged; no software acceptance executed."
