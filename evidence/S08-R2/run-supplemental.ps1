$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$base=Get-Content -Raw evidence/S08-R2/d49-probes-run3.mjs
$index=$base.IndexOf("try{`n await begin('AC01')")
if($index -lt 0){throw 'Helper prefix not found'}
$prefix=$base.Substring(0,$index).Replace('evidence/S08-R2/d49/run3','evidence/S08-R2/supplemental')
if(Test-Path evidence/S08-R2/supplemental-probes.mjs){throw 'Do not overwrite'}
($prefix+(Get-Content -Raw evidence/S08-R2/supplemental-body.txt)) | Set-Content evidence/S08-R2/supplemental-probes.mjs -NoNewline -Encoding utf8
$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$start=Get-Date -Format o
& node.exe evidence/S08-R2/supplemental-probes.mjs 2>&1|Tee-Object -FilePath evidence/S08-R2/logs/supplemental.log
$code=$LASTEXITCODE
[ordered]@{label='supplemental';executable='node.exe';arguments=@('evidence/S08-R2/supplemental-probes.mjs');startedAt=$start;finishedAt=(Get-Date -Format o);exitCode=$code;version=$PSVersionTable.PSVersion.ToString();shellProcess=(Get-Process -Id $PID).Path;helpersSource='d49-probes-run3.mjs';helpersSourceHash=(Get-FileHash evidence/S08-R2/d49-probes-run3.mjs).Hash;collectorHash=(Get-FileHash evidence/S08-R2/supplemental-probes.mjs).Hash}|ConvertTo-Json -Depth 6|Set-Content evidence/S08-R2/supplemental-command.json -Encoding utf8
exit $code
