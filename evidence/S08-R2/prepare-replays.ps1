$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'){throw 'PS7 Core required'}
[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath 'D:\BookKeep with AI'
$entries=@(foreach($name in @('replay-s06.mjs','replay-s07.mjs','replay-s06-probes.mjs','replay-s07-probes.mjs','startup-probe.mjs')){
 $source='evidence/S08/'+$name;$dest='evidence/S08-R2/'+$name
 if(Test-Path $dest){throw 'Do not overwrite collector'}
 $s=Get-Content -Raw $source
 $t=$s.Replace('evidence/S08/','evidence/S08-R2/').Replace("'S08', 'manual'","'S08-R2', 'manual'")
 Set-Content -LiteralPath $dest -Value $t -NoNewline -Encoding utf8
 [ordered]@{source=$source;copy=$dest;sourceSha256=(Get-FileHash $source).Hash;copySha256=(Get-FileHash $dest).Hash;changes='Only evidence output route; original assertions, isolation and origin-kind labels preserved';diff=@(git diff --no-index -- $source $dest)}
})
$entries|ConvertTo-Json -Depth 8|Set-Content evidence/S08-R2/replay-routing.json -Encoding utf8
