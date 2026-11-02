$ErrorActionPreference = 'Stop'
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'engine.ps1'), [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Set-StartupState' }, $true)
Invoke-Expression $fn.Extent.Text
function ConvertFrom-StartupId { @{hive='HKCU';kind=$script:kind;name='Test'} }
function Get-StartupRoots { @{run='mock-run';approvedRun='mock-approved';folder='C:\mock';approvedFolder='mock-folder'} }
function Test-Path { param($LiteralPath, $PathType) $script:exists }
function Get-Item { param($LiteralPath) $obj = New-Object PSObject; $obj | Add-Member ScriptMethod GetValue { param($name) 'example.exe' }; $obj }
function Test-Protected { $script:protected }
function Test-StartupEnabled { $script:enabled }
function Get-ApprovedBytes { 'AwAAAAAAAAAAAAAA' }
function Set-StartupByte { param($path,$name,$value) $script:written = $value; $script:writes++ }
function L { param($en,$vi) $en }
function Assert($value,$message) { if (-not $value) { throw $message } }
$script:kind='Run'; $script:exists=$true; $script:protected=$false; $script:enabled=$false; $script:writes=0
$r=Set-StartupState 'startup:test' $true $true
Assert ($r.ok -and $script:written -eq $true -and $r.before.enabled -eq $false) 'Enable previously disabled startup must capture prior state'
$script:enabled=$true
$r=Set-StartupState 'startup:test' $false $true
Assert ($r.ok -and $script:written -eq $false -and $r.before.enabled -eq $true) 'Disable must capture enabled state'
$script:enabled=$false; $script:writes=0
$r=Set-StartupState 'startup:test' $false $true
Assert ($r.skipped -and $script:writes -eq 0) 'Same-state operation must be a no-op'
$script:enabled=$true; $script:protected=$true
$blocked=$false
try { Set-StartupState 'startup:test' $false } catch { $blocked=$true }
Assert $blocked 'Automatic profiles must not disable protected items'
$r=Set-StartupState 'startup:test' $false $true
Assert $r.ok 'Manual control must allow protected items'
$script:kind='StartupFolder'; $script:exists=$false; $blocked=$false
try { Set-StartupState 'startup:test' $true $true } catch { $blocked=$true }
Assert $blocked 'Missing startup folder item must be rejected'
Write-Output 'Startup state tests passed (6 cases; all OS writes mocked)'
