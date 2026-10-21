$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$rows=[Collections.Generic.List[object]]::new()
$start=Get-Date -Format o
& node.exe evidence/S08-R2/visual-review.mjs 2>&1|Tee-Object evidence/S08-R2/logs/visual-review.log
$code=$LASTEXITCODE
$rows.Add([ordered]@{label='visual-review';executable='node.exe';arguments=@('evidence/S08-R2/visual-review.mjs');startedAt=$start;finishedAt=(Get-Date -Format o);exitCode=$code})
if($code){throw 'Visual capture failed'}
$v=Get-Content -Raw evidence/S08-R2/d49/run3/results.json|ConvertFrom-Json
$env:LOCALAPPDATA=$v.branches[-1].localAppData
$start=Get-Date -Format o
& node.exe scripts/db-report.mjs --json=evidence/S08-R2/db-report.json --schema=evidence/S08-R2/schema.sql 2>&1|Tee-Object evidence/S08-R2/logs/db-report.log
$code=$LASTEXITCODE
$rows.Add([ordered]@{label='db-report';executable='node.exe';arguments=@('scripts/db-report.mjs','--json=evidence/S08-R2/db-report.json','--schema=evidence/S08-R2/schema.sql');localAppData=$env:LOCALAPPDATA;startedAt=$start;finishedAt=(Get-Date -Format o);exitCode=$code})
$rows|ConvertTo-Json -Depth 6|Set-Content evidence/S08-R2/final-commands.json -Encoding utf8
if($code){throw 'DB report failed'}
