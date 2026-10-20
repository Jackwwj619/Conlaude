param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
if ([IO.Path]::GetExtension($resolvedExecutable) -ne '.exe') { throw 'Expected a Windows executable' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShellNameResource {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool EndUpdateResource(IntPtr handle, bool discard);
}
'@
$stream = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($stream)
# String ID 65001 is index 9 in RT_STRING block 4063.
foreach ($index in 0..15) {
  $value = if ($index -eq 9) { 'Conlaude' } else { '' }
  $writer.Write([UInt16]$value.Length)
  $writer.Write([Text.Encoding]::Unicode.GetBytes($value))
}
$writer.Flush()
$bytes = $stream.ToArray()
$writer.Dispose()
$handle = [ShellNameResource]::BeginUpdateResource($resolvedExecutable, $false)
if ($handle -eq [IntPtr]::Zero) { throw [ComponentModel.Win32Exception]::new() }
$committed = $false
try {
  if (-not [ShellNameResource]::UpdateResource($handle, [IntPtr]6, [IntPtr]4063, 1033, $bytes, $bytes.Length)) { throw [ComponentModel.Win32Exception]::new() }
  if (-not [ShellNameResource]::EndUpdateResource($handle, $false)) { throw [ComponentModel.Win32Exception]::new() }
  $committed = $true
} finally {
  if (-not $committed) { [void][ShellNameResource]::EndUpdateResource($handle, $true) }
}
