$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$records=[Collections.Generic.List[object]]::new()
foreach($row in @(@('statistics-reroute','evidence/S08-R2/replay-s07.mjs'),@('d49','evidence/S08-R2/d49-probes.mjs'))){
 $start=Get-Date -Format o
 & node.exe $row[1] 2>&1|Tee-Object -FilePath "evidence/S08-R2/logs/$($row[0]).log"
 $code=$LASTEXITCODE
 $records.Add([ordered]@{label=$row[0];executable='node.exe';arguments=@($row[1]);startedAt=$start;finishedAt=(Get-Date -Format o);exitCode=$code;shellProcess=(Get-Process -Id $PID).Path;version=$PSVersionTable.PSVersion.ToString()})
 $records|ConvertTo-Json -Depth 6|Set-Content evidence/S08-R2/additional-commands.json -Encoding utf8
 if($code){throw 'Collector failed; preserve failure and inspect'}
}
