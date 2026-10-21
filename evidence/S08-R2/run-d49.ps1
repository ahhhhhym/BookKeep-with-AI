$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$started=Get-Date -Format o
& node.exe evidence/S08-R2/d49-probes.mjs 2>&1 | Tee-Object -FilePath evidence/S08-R2/logs/d49-run2.log
$code=$LASTEXITCODE
[ordered]@{label='d49-run2';executable='node.exe';arguments=@('evidence/S08-R2/d49-probes.mjs');startedAt=$started;finishedAt=(Get-Date -Format o);exitCode=$code;version=$PSVersionTable.PSVersion.ToString();shellProcess=(Get-Process -Id $PID).Path;reason='run1 evidence write UNKNOWN on repeated same-path write; unique checkpoints in new subdirectory, assertions unchanged'}|ConvertTo-Json -Depth 6|Set-Content evidence/S08-R2/d49-command-run2.json -Encoding utf8
exit $code
