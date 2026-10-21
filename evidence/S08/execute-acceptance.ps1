$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core') {
    throw 'PowerShell 7 Core required; no fallback allowed'
}
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$target = Join-Path (Get-Location).Path 'evidence/S08'
$firstEntries = @(Get-ChildItem -LiteralPath $target)
$archive = Join-Path $target 'attempt1-bundled-shell'
if (Test-Path -LiteralPath $archive) { throw 'First attempt archive already exists; do not overwrite' }
New-Item -ItemType Directory -Path $archive | Out-Null
foreach ($entry in $firstEntries) { Copy-Item -LiteralPath $entry.FullName -Destination $archive -Recurse }
$shellRecord = [ordered]@{
    checkedAt = Get-Date -Format o
    requestedPath = 'C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe'
    effectiveProcessPath = (Get-Process -Id $PID).Path
    version = $PSVersionTable.PSVersion.ToString()
    edition = $PSVersionTable.PSEdition
    firstAttempt = 'Tool shell parameter was not honored: bundled PowerShell 7.6.5 Core. Preserved in attempt1-bundled-shell. Acceptance commands rerun through explicit requested executable.'
}
$shellRecord | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $target 'shell-verification.json')
$freezePath = Join-Path $target 'freeze.json'
$freeze = Get-Content -Raw -Encoding utf8 $freezePath | ConvertFrom-Json
$freeze.powershellVersion = $PSVersionTable.PSVersion.ToString()
$freeze | Add-Member -NotePropertyName explicitShellVerification -NotePropertyValue $shellRecord -Force
$freeze | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $freezePath
$commands = [Collections.Generic.List[object]]::new()
function Run-Check([string] $label, [string] $executable, [string[]] $arguments, [string] $log) {
    $started = Get-Date -Format o
    Write-Host "Running $label"
    & $executable @arguments 2>&1 | Tee-Object -FilePath (Join-Path $target "logs/$log")
    $code = $LASTEXITCODE
    "EXIT_CODE=$code" | Add-Content -Encoding utf8 (Join-Path $target "logs/$log")
    $commands.Add([ordered]@{ label=$label; executable=$executable; arguments=$arguments; startedAt=$started; finishedAt=(Get-Date -Format o); exitCode=$code; log="logs/$log" })
    $commands | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $target 'command-results.json')
    if ($code -ne 0) { throw "$label failed with exit code $code; preserve evidence" }
}
$env:BOOKKEEP_QA_NODE_MODULES = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
Run-Check 'typecheck' 'npm.cmd' @('run','typecheck') 'typecheck.log'
Run-Check 'tests' 'npm.cmd' @('test','--','--maxWorkers=2','--reporter=json','--outputFile=evidence/S08/unit-results.json') 'test.log'
Run-Check 'icons' 'npm.cmd' @('run','verify:icons') 'verify-icons.log'
Run-Check 'build' 'npm.cmd' @('run','build') 'build.log'
Run-Check 'startup' 'node.exe' @('evidence/S08/startup-probe.mjs') 'startup.log'
Run-Check 'manual' 'node.exe' @('evidence/S08/replay-s06.mjs') 'manual.log'
Run-Check 'statistics' 'node.exe' @('evidence/S08/replay-s07.mjs') 'statistics.log'
Run-Check 'manual probes' 'node.exe' @('evidence/S08/replay-s06-probes.mjs') 'manual-probes.log'
Run-Check 'statistics probes' 'node.exe' @('evidence/S08/replay-s07-probes.mjs') 'statistics-probes.log'
Run-Check 'runtime observation' 'node.exe' @('evidence/S08/observe-runtime.mjs') 'observation.log'
$observation = Get-Content -Raw -Encoding utf8 (Join-Path $target 'observation/observations.json') | ConvertFrom-Json
$env:LOCALAPPDATA = $observation.localAppData
Run-Check 'db report (isolated)' 'node.exe' @('scripts/db-report.mjs','--json=evidence/S08/db-report.json','--schema=evidence/S08/schema.sql') 'db-report.log'
Write-Host ('Explicit requested PowerShell acceptance commands completed: ' + $PSVersionTable.PSVersion.ToString() + ' ' + $PSVersionTable.PSEdition)
