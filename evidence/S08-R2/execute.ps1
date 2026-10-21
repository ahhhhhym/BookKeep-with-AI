$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$e='evidence/S08-R2'
$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
$commands=[Collections.Generic.List[object]]::new()
function Run([string]$label,[string]$exe,[string[]]$arguments){
 $started=Get-Date -Format o
 & $exe @arguments 2>&1 | Tee-Object -FilePath "$e/logs/$label.log"
 $code=$LASTEXITCODE
 $commands.Add([ordered]@{label=$label;executable=$exe;arguments=$arguments;startedAt=$started;finishedAt=(Get-Date -Format o);exitCode=$code;log="logs/$label.log";shellVersion=$PSVersionTable.PSVersion.ToString();shellProcess=(Get-Process -Id $PID).Path})
 $commands|ConvertTo-Json -Depth 8|Set-Content "$e/command-results.json" -Encoding utf8
 if($code){throw "$label failed ($code); evidence retained"}
}
Run 'typecheck' 'npm.cmd' @('run','typecheck')
Run 'tests' 'npm.cmd' @('test','--','--maxWorkers=2','--reporter=json','--outputFile=evidence/S08-R2/unit-results.json')
Run 'icons' 'npm.cmd' @('run','verify:icons')
Run 'build' 'npm.cmd' @('run','build')
Run 'startup' 'node.exe' @('evidence/S08-R2/startup-probe.mjs')
Run 'manual' 'node.exe' @('evidence/S08-R2/replay-s06.mjs')
Run 'statistics' 'node.exe' @('evidence/S08-R2/replay-s07.mjs')
Run 'manual-probes' 'node.exe' @('evidence/S08-R2/replay-s06-probes.mjs')
Run 'statistics-probes' 'node.exe' @('evidence/S08-R2/replay-s07-probes.mjs')
