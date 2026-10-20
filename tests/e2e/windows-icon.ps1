param([long]$WindowHandle, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowIconProbe {
  [DllImport("shlwapi.dll", CharSet=CharSet.Unicode)] static extern int SHLoadIndirectString(string source, System.Text.StringBuilder output, uint length, IntPtr reserved);
  public static string ResolveName(string source) {
    if (source == null || !source.StartsWith("@")) return source;
    var text = new System.Text.StringBuilder(1024);
    Marshal.ThrowExceptionForHR(SHLoadIndirectString(source, text, 1024, IntPtr.Zero));
    return text.ToString();
  }
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr ptr; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  public static string ReadProperty(IntPtr handle, uint id) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(handle, ref iid, out store));
    try {
      var key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = id };
      PropVariant value;
      Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      try { return value.vt == 31 ? Marshal.PtrToStringUni(value.ptr) : null; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
}
'@
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
$nativeHandle = [IntPtr]$WindowHandle
$report = [ordered]@{
  appId = [WindowIconProbe]::ReadProperty($nativeHandle, 5)
  relaunchIcon = [WindowIconProbe]::ReadProperty($nativeHandle, 3)
  relaunchCommand = [WindowIconProbe]::ReadProperty($nativeHandle, 2)
  displayName = [WindowIconProbe]::ReadProperty($nativeHandle, 4)
}
$report['resolvedDisplayName'] = [WindowIconProbe]::ResolveName($report.displayName)
foreach ($kind in @(0, 1)) {
  $iconHandle = [WindowIconProbe]::SendMessage($nativeHandle, 0x007f, [IntPtr]$kind, [IntPtr]::Zero)
  if ($iconHandle -eq [IntPtr]::Zero) { throw "Window icon $kind is missing" }
  $borrowed = [System.Drawing.Icon]::FromHandle($iconHandle)
  $bitmap = $borrowed.ToBitmap()
  $bitmap.Save((Join-Path $resolvedOutput "window-icon-$kind.png"))
  $report["iconSize$kind"] = "$($bitmap.Width)x$($bitmap.Height)"
  $bitmap.Dispose()
}
$report | ConvertTo-Json -Compress
