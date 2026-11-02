param([string]$File)
$handle = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try { [Console]::WriteLine('READY'); [Console]::ReadLine() | Out-Null } finally { $handle.Dispose() }
