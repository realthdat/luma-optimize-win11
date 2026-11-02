# Luma engine. Ids are a whitelist. Paths arrive in the request JSON, never via the command string.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('scan', 'apply', 'set-startup', 'revert', 'restore-point', 'add-exclusion', 'remove-exclusion', 'self-test')]
  [string]$Action,
  [Parameter(Mandatory = $true)][string]$Request,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
$script:UiLang = 'en'
function L([string]$En, [string]$Vi) {
  if ($script:UiLang -eq 'vi') { return $Vi }
  return $En
}
$BestOverlay = 'ded574b5-45a0-4f42-8737-46345c09c238'
$SuggestionNames = @(
  'SubscribedContent-338388Enabled',
  'SubscribedContent-338389Enabled',
  'SubscribedContent-353694Enabled',
  'SubscribedContent-353696Enabled',
  'SubscribedContent-310093Enabled',
  'SoftLandingEnabled',
  'SystemPaneSuggestionsEnabled'
)
$SpotlightNames = @(
  'RotatingLockScreenEnabled',
  'RotatingLockScreenOverlayEnabled',
  'SubscribedContent-338387Enabled'
)

function Write-Out($Obj) {
  $json = $Obj | ConvertTo-Json -Depth 8 -Compress
  [IO.File]::WriteAllText($Out, $json, [Text.UTF8Encoding]::new($false))
}

function Read-Reg([string]$Path, [string]$Name) {
  $row = @{ exists = $false; value = $null; type = $null }
  if (-not (Test-Path -LiteralPath $Path)) { return $row }
  $item = Get-Item -LiteralPath $Path
  try { $kind = $item.GetValueKind($Name) } catch { return $row }
  $row.exists = $true
  $row.value = $item.GetValue($Name)
  $row.type = switch ($kind) {
    'DWord' { 'DWord' }
    'QWord' { 'QWord' }
    'String' { 'String' }
    'ExpandString' { 'ExpandString' }
    default { 'Unknown' }
  }
  return $row
}

function Write-Reg([string]$Path, [string]$Name, [string]$Type, $Value) {
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -Path $Path -Force | Out-Null }
  $v = $Value
  if ($Type -eq 'DWord') { $v = [int]$Value }
  New-ItemProperty -LiteralPath $Path -Name $Name -PropertyType $Type -Value $v -Force | Out-Null
}

function Restore-Reg([string]$Path, [string]$Name, $Before) {
  if ($null -eq $Before -or -not $Before.exists) {
    if (Test-Path -LiteralPath $Path) {
      Remove-ItemProperty -LiteralPath $Path -Name $Name -ErrorAction SilentlyContinue
    }
    return
  }
  Write-Reg $Path $Name ([string]$Before.type) $Before.value
}

function Test-DwordOff($Row) {
  return $Row.exists -and [int]$Row.value -eq 0
}

function Read-DwordGroup([string]$Path, [string[]]$Names, [int]$Target) {
  $all = $true
  foreach ($name in $Names) {
    $row = Read-Reg $Path $name
    if (-not $row.exists -or [int]$row.value -ne $Target) { $all = $false }
  }
  return $all
}

function Capture-DwordGroup([string]$Path, [string[]]$Names) {
  $bag = @{}
  foreach ($name in $Names) { $bag[$name] = Read-Reg $Path $name }
  return $bag
}

function Write-DwordGroup([string]$Path, [string[]]$Names, [int]$Value) {
  foreach ($name in $Names) { Write-Reg $Path $name 'DWord' $Value }
}

function Restore-DwordGroup([string]$Path, $Before) {
  foreach ($prop in $Before.PSObject.Properties) {
    Restore-Reg $Path $prop.Name $prop.Value
  }
}

function Get-SvcStart([string]$Name) {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
  if (-not $svc) { return $null }
  switch ($svc.StartMode) {
    'Auto' { return 'Automatic' }
    'Manual' { return 'Manual' }
    'Disabled' { return 'Disabled' }
    default { return [string]$svc.StartMode }
  }
}

function Read-ServiceGroup([string[]]$Names) {
  $before = @{}
  $available = $false
  $applied = $true
  foreach ($name in $Names) {
    $start = Get-SvcStart $name
    if ($null -eq $start) { continue }
    $available = $true
    $before[$name] = $start
    if ($start -ne 'Disabled') { $applied = $false }
  }
  if (-not $available) { $applied = $false }
  return @{ available = $available; applied = $applied; before = $before }
}

function Disable-ServiceGroup([string[]]$Names) {
  foreach ($name in $Names) {
    if ($null -eq (Get-SvcStart $name)) { continue }
    try { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue } catch {}
    Set-Service -Name $name -StartupType Disabled
  }
}

function Restore-ServiceGroup($Before) {
  foreach ($prop in $Before.PSObject.Properties) {
    $mode = [string]$prop.Value
    if ($mode -notin @('Automatic', 'Manual', 'Disabled')) { continue }
    Set-Service -Name $prop.Name -StartupType $mode
    if ($mode -eq 'Automatic') {
      try { Start-Service -Name $prop.Name -ErrorAction SilentlyContinue } catch {}
    }
  }
}

function Test-RealPrinter {
  $printers = @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue)
  foreach ($printer in $printers) {
    if ($printer.Name -match 'PDF|XPS|OneNote|Fax|Microsoft Print') { continue }
    return $true
  }
  return $false
}

function Test-TrustedPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return (L 'Missing path' 'Thiếu đường dẫn') }
  try { $full = [IO.Path]::GetFullPath($Path) } catch { return (L 'Invalid path' 'Đường dẫn không hợp lệ') }
  if (-not (Test-Path -LiteralPath $full -PathType Container)) { return (L 'Not an existing folder' 'Không phải thư mục đang tồn tại') }
  $trim = $full.TrimEnd('\')
  $root = [IO.Path]::GetPathRoot($full).TrimEnd('\')
  if ($trim.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return (L 'Cannot exclude a whole drive' 'Không loại trừ cả ổ đĩa') }
  $win = $env:SystemRoot
  $blocked = @(
    $win,
    (Join-Path $win 'System32'),
    (Join-Path $win 'SysWOW64'),
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)}
  ) | Where-Object { $_ }
  foreach ($block in $blocked) {
    $base = $block.TrimEnd('\')
    if ($trim.Equals($base, [StringComparison]::OrdinalIgnoreCase) -or $trim.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) {
      return (L 'Cannot exclude a system folder' 'Không loại trừ thư mục hệ thống')
    }
  }
  return $null
}

function ConvertTo-StartupId([string]$Hive, [string]$Kind, [string]$Name) {
  $json = (@{ hive = $Hive; kind = $Kind; name = $Name } | ConvertTo-Json -Compress)
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  return "startup:$b64"
}

function ConvertFrom-StartupId([string]$Id) {
  if (-not $Id.StartsWith('startup:')) { throw (L 'Invalid startup item' 'Mục khởi động không hợp lệ') }
  $raw = $Id.Substring(8).Replace('-', '+').Replace('_', '/')
  switch ($raw.Length % 4) { 2 { $raw += '==' } 3 { $raw += '=' } }
  $obj = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw)) | ConvertFrom-Json
  if ($obj.hive -notin @('HKCU', 'HKLM') -or $obj.kind -notin @('Run', 'StartupFolder')) { throw (L 'Invalid startup item' 'Mục khởi động không hợp lệ') }
  if ([string]::IsNullOrWhiteSpace([string]$obj.name)) { throw (L 'Invalid startup item' 'Mục khởi động không hợp lệ') }
  return $obj
}

function Get-ExePath([string]$Command) {
  if ($Command -match '^"([^"]+\.exe)"') { return $Matches[1] }
  if ($Command -match '(?i)^([^\s]+\.exe)') { return $Matches[1] }
  return $null
}

function Test-Protected([string]$Name, [string]$Command) {
  $hay = "$Name $Command"
  return $hay -match 'securityhealth|windowsdefender|msmpeng|smartscreen|avast|avgui|avguard|bitdefender|\bekrn\b|avpui|mcshield|norton|malwarebytes|\bmbam\b|nvcontainer|nvidia|amdrsserv|radeonsoftware|realtek|rtkaud|igfx|igcc|armoury'
}

function Get-Impact([string]$Name, [string]$Command) {
  $hay = "$Name $Command"
  if ($hay -match 'spotify|discord|steam|epicgames|adobe|acrobat|teams|onedrive|dropbox|icloud|skype|zoom|slack|battle\.net|riotclient|origin|eadesktop|ubisoft|corsair|razer|armoury|lghub|steelseries|\bicue\b') {
    return 'high'
  }
  return 'mid'
}

function Get-ApprovedBytes([string]$Path, [string]$Name) {
  $row = Read-Reg $Path $Name
  if (-not $row.exists -or $null -eq $row.value) { return $null }
  return [Convert]::ToBase64String([byte[]]$row.value)
}

function Test-StartupEnabled([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  $item = Get-Item -LiteralPath $Path
  try { $bytes = [byte[]]$item.GetValue($Name) } catch { return $true }
  if ($null -eq $bytes -or $bytes.Length -eq 0) { return $true }
  return $bytes[0] -ne 3
}

function Set-StartupByte([string]$Path, [string]$Name, [bool]$Enable) {
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -Path $Path -Force | Out-Null }
  $item = Get-Item -LiteralPath $Path
  $bytes = $null
  try { $bytes = [byte[]]$item.GetValue($Name) } catch { $bytes = $null }
  if ($null -eq $bytes -or $bytes.Length -lt 12) {
    $fresh = New-Object byte[] 12
    if ($null -ne $bytes -and $bytes.Length -gt 0) { [Array]::Copy($bytes, $fresh, $bytes.Length) }
    $bytes = $fresh
  }
  $bytes[0] = $(if ($Enable) { 2 } else { 3 })
  New-ItemProperty -LiteralPath $Path -Name $Name -PropertyType Binary -Value $bytes -Force | Out-Null
}

function Get-StartupRoots([string]$Hive) {
  $root = if ($Hive -eq 'HKCU') { 'HKCU:' } else { 'HKLM:' }
  $folder = if ($Hive -eq 'HKCU') {
    [Environment]::GetFolderPath('Startup')
  } else {
    Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup'
  }
  return @{
    run = "$root\Software\Microsoft\Windows\CurrentVersion\Run"
    approvedRun = "$root\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
    folder = $folder
    approvedFolder = "$root\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
  }
}

function Read-StartupItems {
  $items = @()
  foreach ($hive in @('HKCU', 'HKLM')) {
    $roots = Get-StartupRoots $hive
    if (Test-Path -LiteralPath $roots.run) {
      foreach ($name in @((Get-Item -LiteralPath $roots.run).Property)) {
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $command = [string](Get-Item -LiteralPath $roots.run).GetValue($name)
        $exe = Get-ExePath $command
        $publisher = ''
        if ($exe -and (Test-Path -LiteralPath $exe)) {
          try { $publisher = [string][Diagnostics.FileVersionInfo]::GetVersionInfo($exe).CompanyName } catch { $publisher = '' }
        }
        $protected = Test-Protected $name $command
        $items += @{
          id = (ConvertTo-StartupId $hive 'Run' $name)
          name = $name
          command = $command
          publisher = $publisher
          impact = $(if ($protected) { 'none' } else { Get-Impact $name $command })
          enabled = (Test-StartupEnabled $roots.approvedRun $name)
          protected = $protected
          hive = $hive
        }
      }
    }
    if (Test-Path -LiteralPath $roots.folder) {
      foreach ($file in @(Get-ChildItem -LiteralPath $roots.folder -File -ErrorAction SilentlyContinue)) {
        if ($file.Name -eq 'desktop.ini') { continue }
        $protected = Test-Protected $file.Name $file.FullName
        $items += @{
          id = (ConvertTo-StartupId $hive 'StartupFolder' $file.Name)
          name = $file.Name
          command = $file.FullName
          publisher = ''
          impact = $(if ($protected) { 'none' } else { Get-Impact $file.Name $file.FullName })
          enabled = (Test-StartupEnabled $roots.approvedFolder $file.Name)
          protected = $protected
          hive = $hive
        }
      }
    }
  }
  return $items
}

function Set-StartupState([string]$Id, [bool]$Enabled, [bool]$Manual = $false) {
  $key = ConvertFrom-StartupId $Id
  $roots = Get-StartupRoots $key.hive
  $approved = if ($key.kind -eq 'Run') { $roots.approvedRun } else { $roots.approvedFolder }
  $command = ''
  if ($key.kind -eq 'Run') {
    if (-not (Test-Path -LiteralPath $roots.run)) { throw (L 'That startup item is gone' 'Không còn mục khởi động này') }
    $command = [string](Get-Item -LiteralPath $roots.run).GetValue($key.name)
    if ([string]::IsNullOrWhiteSpace($command)) { throw (L 'That startup item is gone' 'Không còn mục khởi động này') }
  } else {
    $command = Join-Path $roots.folder ([string]$key.name)
    if (-not (Test-Path -LiteralPath $command -PathType Leaf)) { throw (L 'That startup item is gone' 'Không còn mục khởi động này') }
  }
  if (-not $Manual -and (Test-Protected $key.name $command)) { throw (L 'Security and driver items stay on' 'Mục bảo mật hoặc driver được giữ') }
  $before = @{
    hive = [string]$key.hive
    kind = [string]$key.kind
    name = [string]$key.name
    enabled = (Test-StartupEnabled $approved $key.name)
    approvedB64 = (Get-ApprovedBytes $approved $key.name)
  }
  if ($before.enabled -eq $Enabled) { return @{ id = $Id; ok = $true; skipped = $true; label = [string]$key.name } }
  Set-StartupByte $approved $key.name $Enabled
  return @{ id = $Id; ok = $true; before = $before; label = [string]$key.name }
}

function Restore-Startup($Before) {
  if ($Before.hive -notin @('HKCU', 'HKLM') -or $Before.kind -notin @('Run', 'StartupFolder')) { throw (L 'Invalid startup item' 'Mục khởi động không hợp lệ') }
  $roots = Get-StartupRoots $Before.hive
  $approved = if ($Before.kind -eq 'Run') { $roots.approvedRun } else { $roots.approvedFolder }
  if ($Before.approvedB64) {
    $bytes = [Convert]::FromBase64String([string]$Before.approvedB64)
    if (-not (Test-Path -LiteralPath $approved)) { New-Item -Path $approved -Force | Out-Null }
    New-ItemProperty -LiteralPath $approved -Name ([string]$Before.name) -PropertyType Binary -Value $bytes -Force | Out-Null
  } else {
    Set-StartupByte $approved ([string]$Before.name) ([bool]$Before.enabled)
  }
}

$tweaks = @{}

# id: suggestions
$tweaks['suggestions'] = @{
  Read = {
    $cdm = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
    $adv = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
    $pol = 'HKCU:\Software\Policies\Microsoft\Windows\Explorer'
    $applied = (Read-DwordGroup $cdm $SuggestionNames 0) -and (Test-DwordOff (Read-Reg $adv 'Start_IrisRecommendations')) -and ((Read-Reg $pol 'DisableSearchBoxSuggestions').exists) -and ([int](Read-Reg $pol 'DisableSearchBoxSuggestions').value -eq 1)
    @{ applied = [bool]$applied; available = $true; reboot = $false }
  }
  Capture = {
    @{
      cdm = (Capture-DwordGroup 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' $SuggestionNames)
      iris = (Read-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'Start_IrisRecommendations')
      search = (Read-Reg 'HKCU:\Software\Policies\Microsoft\Windows\Explorer' 'DisableSearchBoxSuggestions')
    }
  }
  Write = {
    Write-DwordGroup 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' $SuggestionNames 0
    Write-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'Start_IrisRecommendations' 'DWord' 0
    Write-Reg 'HKCU:\Software\Policies\Microsoft\Windows\Explorer' 'DisableSearchBoxSuggestions' 'DWord' 1
  }
  Revert = {
    param($Before)
    Restore-DwordGroup 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' $Before.cdm
    Restore-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'Start_IrisRecommendations' $Before.iris
    Restore-Reg 'HKCU:\Software\Policies\Microsoft\Windows\Explorer' 'DisableSearchBoxSuggestions' $Before.search
  }
}

# id: spotlight
$tweaks['spotlight'] = @{
  Read = {
    $applied = Read-DwordGroup 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' $SpotlightNames 0
    @{ applied = [bool]$applied; available = $true; reboot = $false }
  }
  Capture = { Capture-DwordGroup 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' $SpotlightNames }
  Write = { Write-DwordGroup 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' $SpotlightNames 0 }
  Revert = { param($Before) Restore-DwordGroup 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager' $Before }
}

# id: widgets
$tweaks['widgets'] = @{
  Read = {
    @{ applied = (Test-DwordOff (Read-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'TaskbarDa')); available = $true; reboot = $false }
  }
  Capture = { Read-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'TaskbarDa' }
  Write = { Write-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'TaskbarDa' 'DWord' 0 }
  Revert = { param($Before) Restore-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'TaskbarDa' $Before }
}

# id: animations
$tweaks['animations'] = @{
  Read = {
    $delay = Read-Reg 'HKCU:\Control Panel\Desktop' 'MenuShowDelay'
    $font = Read-Reg 'HKCU:\Control Panel\Desktop' 'FontSmoothing'
    $delayOk = $delay.exists -and ([int]$delay.value) -le 100
    $fontOk = $font.exists -and [string]$font.value -eq '2'
    @{ applied = ($delayOk -and $fontOk); available = $true; reboot = $false }
  }
  Capture = {
    @{
      delay = (Read-Reg 'HKCU:\Control Panel\Desktop' 'MenuShowDelay')
      font = (Read-Reg 'HKCU:\Control Panel\Desktop' 'FontSmoothing')
    }
  }
  Write = {
    $delay = Read-Reg 'HKCU:\Control Panel\Desktop' 'MenuShowDelay'
    if (-not $delay.exists -or ([int]$delay.value) -gt 100) { Write-Reg 'HKCU:\Control Panel\Desktop' 'MenuShowDelay' 'String' '100' }
    $font = Read-Reg 'HKCU:\Control Panel\Desktop' 'FontSmoothing'
    if (-not $font.exists -or [string]$font.value -ne '2') { Write-Reg 'HKCU:\Control Panel\Desktop' 'FontSmoothing' 'String' '2' }
  }
  Revert = {
    param($Before)
    Restore-Reg 'HKCU:\Control Panel\Desktop' 'MenuShowDelay' $Before.delay
    Restore-Reg 'HKCU:\Control Panel\Desktop' 'FontSmoothing' $Before.font
  }
}

# id: gamedvr
$tweaks['gamedvr'] = @{
  Read = {
    $a = Test-DwordOff (Read-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled')
    $b = Test-DwordOff (Read-Reg 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled')
    @{ applied = ($a -and $b); available = $true; reboot = $false }
  }
  Capture = {
    @{
      capture = (Read-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled')
      enabled = (Read-Reg 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled')
    }
  }
  Write = {
    Write-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled' 'DWord' 0
    Write-Reg 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled' 'DWord' 0
  }
  Revert = {
    param($Before)
    Restore-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled' $Before.capture
    Restore-Reg 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled' $Before.enabled
  }
}

# id: power-ac
$tweaks['power-ac'] = @{
  Read = {
    $battery = $null -ne (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
    $row = Read-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' 'ActiveOverlayAcPowerScheme'
    $applied = $row.exists -and ([string]$row.value).ToLower() -eq $BestOverlay
    @{ applied = [bool]$applied; available = (-not $battery -and (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes')); reboot = $false }
  }
  Capture = { Read-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' 'ActiveOverlayAcPowerScheme' }
  Write = {
    if ($null -ne (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)) { throw (L 'This PC has a battery, so the power mode stays' 'Máy có pin, không đổi chế độ nguồn') }
    Write-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' 'ActiveOverlayAcPowerScheme' 'String' $BestOverlay
    & powercfg.exe /setactive scheme_current | Out-Null
  }
  Revert = {
    param($Before)
    Restore-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' 'ActiveOverlayAcPowerScheme' $Before
    & powercfg.exe /setactive scheme_current | Out-Null
  }
}

# id: svc-diagtrack
$tweaks['svc-diagtrack'] = @{
  Read = { $info = Read-ServiceGroup @('DiagTrack'); @{ applied = $info.applied; available = $info.available; reboot = $false } }
  Capture = { (Read-ServiceGroup @('DiagTrack')).before }
  Write = { Disable-ServiceGroup @('DiagTrack') }
  Revert = { param($Before) Restore-ServiceGroup $Before }
}

# id: svc-fax
$tweaks['svc-fax'] = @{
  Read = { $info = Read-ServiceGroup @('Fax'); @{ applied = $info.applied; available = $info.available; reboot = $false } }
  Capture = { (Read-ServiceGroup @('Fax')).before }
  Write = { Disable-ServiceGroup @('Fax') }
  Revert = { param($Before) Restore-ServiceGroup $Before }
}

# id: svc-retaildemo
$tweaks['svc-retaildemo'] = @{
  Read = { $info = Read-ServiceGroup @('RetailDemo'); @{ applied = $info.applied; available = $info.available; reboot = $false } }
  Capture = { (Read-ServiceGroup @('RetailDemo')).before }
  Write = { Disable-ServiceGroup @('RetailDemo') }
  Revert = { param($Before) Restore-ServiceGroup $Before }
}

# id: svc-maps
$tweaks['svc-maps'] = @{
  Read = { $info = Read-ServiceGroup @('MapsBroker'); @{ applied = $info.applied; available = $info.available; reboot = $false } }
  Capture = { (Read-ServiceGroup @('MapsBroker')).before }
  Write = { Disable-ServiceGroup @('MapsBroker') }
  Revert = { param($Before) Restore-ServiceGroup $Before }
}

# id: svc-xbox
$tweaks['svc-xbox'] = @{
  Read = {
    $info = Read-ServiceGroup @('XblAuthManager', 'XblGameSave', 'XboxNetApiSvc', 'XboxGipSvc')
    @{ applied = $info.applied; available = $info.available; reboot = $false }
  }
  Capture = { (Read-ServiceGroup @('XblAuthManager', 'XblGameSave', 'XboxNetApiSvc', 'XboxGipSvc')).before }
  Write = { Disable-ServiceGroup @('XblAuthManager', 'XblGameSave', 'XboxNetApiSvc', 'XboxGipSvc') }
  Revert = { param($Before) Restore-ServiceGroup $Before }
}

# id: svc-spooler
$tweaks['svc-spooler'] = @{
  Read = {
    $info = Read-ServiceGroup @('Spooler')
    $free = -not (Test-RealPrinter)
    @{ applied = ($free -and $info.applied); available = ($info.available -and $free); reboot = $false }
  }
  Capture = { (Read-ServiceGroup @('Spooler')).before }
  Write = {
    if (Test-RealPrinter) { throw (L 'A printer is installed, so the spooler stays' 'Máy đang có máy in, không tắt hàng đợi in') }
    Disable-ServiceGroup @('Spooler')
  }
  Revert = { param($Before) Restore-ServiceGroup $Before }
}

# id: gamemode
$tweaks['gamemode'] = @{
  Read = {
    $row = Read-Reg 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled'
    @{ applied = ($row.exists -and [int]$row.value -eq 1); available = $true; reboot = $false }
  }
  Capture = {
    @{
      auto = (Read-Reg 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled')
      allow = (Read-Reg 'HKCU:\Software\Microsoft\GameBar' 'AllowAutoGameMode')
    }
  }
  Write = {
    Write-Reg 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled' 'DWord' 1
    Write-Reg 'HKCU:\Software\Microsoft\GameBar' 'AllowAutoGameMode' 'DWord' 1
  }
  Revert = {
    param($Before)
    Restore-Reg 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled' $Before.auto
    Restore-Reg 'HKCU:\Software\Microsoft\GameBar' 'AllowAutoGameMode' $Before.allow
  }
}

# id: hags
$tweaks['hags'] = @{
  Read = {
    $path = 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers'
    $row = Read-Reg $path 'HwSchMode'
    @{ applied = ($row.exists -and [int]$row.value -eq 2); available = (Test-Path -LiteralPath $path); reboot = $true }
  }
  Capture = { Read-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode' }
  Write = { Write-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode' 'DWord' 2 }
  Revert = { param($Before) Restore-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode' $Before }
}

# id: vbs
$tweaks['vbs'] = @{
  Read = {
    $vbs = Read-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' 'EnableVirtualizationBasedSecurity'
    $hvci = Read-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled'
    $off = (Test-DwordOff $vbs) -and (Test-DwordOff $hvci)
    @{ applied = [bool]$off; available = $true; reboot = $true }
  }
  Capture = {
    @{
      vbs = (Read-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' 'EnableVirtualizationBasedSecurity')
      hvci = (Read-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled')
    }
  }
  Write = {
    Write-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' 'EnableVirtualizationBasedSecurity' 'DWord' 0
    Write-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled' 'DWord' 0
  }
  Revert = {
    param($Before)
    Restore-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' 'EnableVirtualizationBasedSecurity' $Before.vbs
    Restore-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled' $Before.hvci
  }
}

# id: windows-update
$tweaks['windows-update'] = @{
  Read = {
    $policy = Read-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoUpdate'
    $policyOff = $policy.exists -and [int]$policy.value -eq 1
    $svcOff = (Get-SvcStart 'wuauserv') -eq 'Disabled'
    @{ applied = ($policyOff -and $svcOff); available = $true; reboot = $false; revived = ($policyOff -and -not $svcOff) }
  }
  Capture = {
    @{
      useDefaults = $false
      policy = (Read-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoUpdate')
      wuauserv = (Get-SvcStart 'wuauserv')
      usosvc = (Get-SvcStart 'UsoSvc')
    }
  }
  Write = {
    Write-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoUpdate' 'DWord' 1
    foreach ($name in @('wuauserv', 'UsoSvc')) {
      try { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue } catch {}
      Set-Service -Name $name -StartupType Disabled
    }
  }
  Revert = {
    param($Before)
    if ($Before.useDefaults) {
      Restore-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoUpdate' @{ exists = $false }
      Set-Service -Name 'wuauserv' -StartupType Manual
      Set-Service -Name 'UsoSvc' -StartupType Automatic
      try { Start-Service -Name 'UsoSvc' -ErrorAction SilentlyContinue } catch {}
      return
    }
    Restore-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoUpdate' $Before.policy
    foreach ($pair in @(@('wuauserv', $Before.wuauserv), @('UsoSvc', $Before.usosvc))) {
      $mode = [string]$pair[1]
      if ($mode -notin @('Automatic', 'Manual', 'Disabled')) { continue }
      Set-Service -Name $pair[0] -StartupType $mode
      if ($mode -ne 'Disabled') {
        try { Start-Service -Name $pair[0] -ErrorAction SilentlyContinue } catch {}
      }
    }
  }
}

$apps = @{}
# id: app-widgets
$apps['app-widgets'] = @{ Name = 'MicrosoftWindows.Client.WebExperience'; Winget = '9MSSGKG348SP'; Label = 'Widgets (Web Experience)' }
# id: app-copilot
$apps['app-copilot'] = @{ Name = 'Microsoft.Copilot'; Winget = '9NHT9RB2F4HD'; Label = 'Copilot' }
# id: app-teams
$apps['app-teams'] = @{ Name = 'MSTeams'; Winget = 'Microsoft.Teams'; Label = 'Teams' }
# id: app-news
$apps['app-news'] = @{ Name = 'Microsoft.BingNews'; Winget = '9NBLGGH4V8Q5'; Label = 'News' }
# id: app-clipchamp
$apps['app-clipchamp'] = @{ Name = 'Clipchamp.Clipchamp'; Winget = 'Clipchamp.Clipchamp'; Label = 'Clipchamp' }
# id: app-devhome
$apps['app-devhome'] = @{ Name = 'Microsoft.Windows.DevHome'; Winget = 'Microsoft.DevHome'; Label = 'Dev Home' }
# id: app-xbox
$apps['app-xbox'] = @{ Name = 'Microsoft.GamingApp'; Winget = '9MV0B5HZVK9Z'; Label = 'Xbox' }
# id: app-gamebar
$apps['app-gamebar'] = @{ Name = 'Microsoft.XboxGamingOverlay'; Winget = '9NZKPSTSNW4P'; Label = 'Xbox Game Bar' }

function Read-UpdateState {
  $read = & $tweaks['windows-update'].Read
  return @{ disabled = [bool]$read.applied; revived = [bool]$read.revived }
}

function Invoke-ApplyId([string]$Id) {
  if ($Id.StartsWith('startup:')) { return Set-StartupState $Id $false }
  if ($apps.ContainsKey($Id)) {
    $meta = $apps[$Id]
    $pkgs = @(Get-AppxPackage -Name $meta.Name -ErrorAction SilentlyContinue)
    if ($pkgs.Count -eq 0) { return @{ id = $Id; ok = $true; skipped = $true; label = $meta.Label } }
    $pkgs | Remove-AppxPackage
    return @{ id = $Id; ok = $true; before = @{ name = $meta.Name; winget = $meta.Winget }; label = $meta.Label }
  }
  if (-not $tweaks.ContainsKey($Id)) { return @{ id = $Id; ok = $false; message = (L 'Unknown item' 'Không có mục này') } }
  $tweak = $tweaks[$Id]
  $state = & $tweak.Read
  if ($state.applied) { return @{ id = $Id; ok = $true; skipped = $true } }
  $before = & $tweak.Capture
  & $tweak.Write
  return @{ id = $Id; ok = $true; before = $before; reboot = [bool]$state.reboot }
}

function Invoke-RevertId($Item) {
  $id = [string]$Item.id
  $before = $Item.before
  if ($id.StartsWith('startup:')) {
    Restore-Startup $before
    return @{ id = $id; ok = $true }
  }
  if ($id.StartsWith('exclusion:')) {
    $reason = Test-TrustedPath ([string]$before.path)
    if ($reason) { throw $reason }
    if ($before.existed) { Add-MpPreference -ExclusionPath ([string]$before.path) }
    else { Remove-MpPreference -ExclusionPath ([string]$before.path) }
    return @{ id = $id; ok = $true }
  }
  if ($apps.ContainsKey($id)) {
    $meta = $apps[$id]
    $prov = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq $meta.Name } | Select-Object -First 1
    if ($prov -and $prov.InstallLocation) {
      $manifest = Join-Path $prov.InstallLocation 'AppxManifest.xml'
      if (Test-Path -LiteralPath $manifest) {
        Add-AppxPackage -DisableDevelopmentMode -Register $manifest
        return @{ id = $id; ok = $true }
      }
    }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { throw (L 'No package left to reinstall, and winget is missing' 'Không tìm thấy gói để cài lại và máy không có winget') }
    $proc = Start-Process -FilePath $winget.Source -Wait -PassThru -ArgumentList @('install', '--id', $meta.Winget, '-e', '--accept-package-agreements', '--accept-source-agreements')
    if ($proc.ExitCode -ne 0) { throw ((L 'winget exited with code ' 'winget thoát với mã ') + $proc.ExitCode) }
    return @{ id = $id; ok = $true }
  }
  if (-not $tweaks.ContainsKey($id)) { return @{ id = $id; ok = $false; message = (L 'Unknown item' 'Không có mục này') } }
  & $tweaks[$id].Revert $before
  return @{ id = $id; ok = $true }
}

if ($Action -eq 'self-test') {
  try {
    $fails = @()
    $root = $env:SystemDrive + '\'
    if ($null -eq (Test-TrustedPath $root)) { $fails += 'root accepted' }
    if ($null -eq (Test-TrustedPath $env:SystemRoot)) { $fails += 'windows accepted' }
    if ($null -eq (Test-TrustedPath (Join-Path $env:SystemRoot 'System32'))) { $fails += 'system32 accepted' }
    $temp = Join-Path $env:TEMP ('muot-path-' + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
      $reason = Test-TrustedPath $temp
      if ($null -ne $reason) { $fails += "temp rejected: $reason" }
    } finally {
      Remove-Item -LiteralPath $temp -Force
    }
    if ($fails.Count -gt 0) { throw ($fails -join '; ') }
    Write-Out @{ ok = $true }
    exit 0
  } catch {
    Write-Out @{ ok = $false; message = $_.Exception.Message }
    exit 1
  }
}

$req = [IO.File]::ReadAllText($Request) | ConvertFrom-Json
if ([string]$req.lang -eq 'vi') { $script:UiLang = 'vi' }

try {
  switch ($Action) {
    'scan' {
      $installed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
      foreach ($pkg in @(Get-AppxPackage)) { [void]$installed.Add($pkg.Name) }
      $appRows = @()
      foreach ($key in $apps.Keys) {
        $appRows += @{ id = $key; installed = $installed.Contains($apps[$key].Name) }
      }
      $tweakRows = @{}
      foreach ($key in $tweaks.Keys) { $tweakRows[$key] = & $tweaks[$key].Read }
      $exclusions = @()
      $exclusionError = $null
      try {
        $pref = Get-MpPreference
        $exclusions = @($pref.ExclusionPath | Where-Object { $_ })
      } catch {
        $exclusionError = 'exclusion-unreadable'
      }
      $body = @{
        ok = $true
        startup = @(Read-StartupItems)
        tweaks = $tweakRows
        apps = $appRows
        update = (Read-UpdateState)
        exclusions = $exclusions
        hasBattery = ($null -ne (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue))
      }
      if ($exclusionError) { $body.exclusionError = $exclusionError }
      Write-Out $body
    }
    'apply' {
      $results = @()
      foreach ($id in @($req.ids)) {
        try { $results += Invoke-ApplyId ([string]$id) }
        catch { $results += @{ id = [string]$id; ok = $false; message = $_.Exception.Message } }
      }
      Write-Out @{ ok = $true; results = $results }
    }
    'set-startup' {
      if ($req.enabled -isnot [bool]) { throw 'Invalid startup state' }
      $result = Set-StartupState ([string]$req.id) ([bool]$req.enabled) $true
      Write-Out @{ ok = $true; results = @($result) }
    }
    'revert' {
      $results = @()
      foreach ($item in @($req.items)) {
        try { $results += Invoke-RevertId $item }
        catch { $results += @{ id = [string]$item.id; ok = $false; message = $_.Exception.Message } }
      }
      Write-Out @{ ok = $true; results = $results }
    }
    'restore-point' {
      # Verify the actual restore-point inventory, not just a cached timestamp.
      $recent = @(Get-ComputerRestorePoint -ErrorAction Stop | Where-Object {
        $_.Description -in @('Luma', 'Trim') -and
        [Management.ManagementDateTimeConverter]::ToDateTime($_.CreationTime) -gt (Get-Date).AddHours(-24)
      })
      if ($recent.Count -gt 0) {
        Write-Out @{ ok = $true }
        break
      }
      try { Enable-ComputerRestore -Drive "$($env:SystemDrive)\" } catch {}
      $started = Get-Date
      Checkpoint-Computer -Description 'Luma' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
      $created = @(Get-ComputerRestorePoint -ErrorAction Stop | Where-Object {
        $_.Description -eq 'Luma' -and [Management.ManagementDateTimeConverter]::ToDateTime($_.CreationTime) -ge $started.AddSeconds(-2)
      })
      if ($created.Count -eq 0) { throw (L 'Windows did not create a new restore point' 'Windows chưa tạo điểm khôi phục mới') }
      Write-Out @{ ok = $true }
    }
    'add-exclusion' {
      $reason = Test-TrustedPath ([string]$req.path)
      if ($reason) { throw $reason }
      $full = [IO.Path]::GetFullPath([string]$req.path).TrimEnd('\')
      $pref = Get-MpPreference
      $already = @($pref.ExclusionPath) | Where-Object { $_ -and $_.TrimEnd('\') -eq $full }
      if ($already) {
        Write-Out @{ ok = $true; skipped = $true; path = $full }
      } else {
        Add-MpPreference -ExclusionPath $full
        Write-Out @{ ok = $true; path = $full }
      }
    }
    'remove-exclusion' {
      $full = [IO.Path]::GetFullPath([string]$req.path)
      Remove-MpPreference -ExclusionPath $full
      Write-Out @{ ok = $true; path = $full }
    }
  }
} catch {
  $hint = $_.Exception.Message
  if ($Action -eq 'add-exclusion' -or $Action -eq 'remove-exclusion') {
    $hint = $hint + ' ' + (L 'Open Windows Security, Virus and threat protection, Manage settings, Exclusions.' 'Mở Windows Security, Bảo vệ khỏi virus và mối đe dọa, Quản lý cài đặt, Loại trừ.')
  }
  Write-Out @{ ok = $false; message = $hint }
  exit 1
}
