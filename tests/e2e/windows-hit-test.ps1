param([long]$Handle, [double]$X, [double]$Y)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CaptionHitTest {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static long Hit(long handle, double x, double y) {
    var previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      var hwnd = new IntPtr(handle);
      RECT rect; GetClientRect(hwnd, out rect);
      var point = new POINT { X = (int)Math.Round((rect.Right - rect.Left) * x), Y = (int)Math.Round((rect.Bottom - rect.Top) * y) };
      ClientToScreen(hwnd, ref point);
      int packed = (point.Y << 16) | (point.X & 0xffff);
      return SendMessage(hwnd, 0x84, IntPtr.Zero, new IntPtr(packed)).ToInt64();
    } finally { SetThreadDpiAwarenessContext(previous); }
  }
}
"@
[CaptionHitTest]::Hit($Handle, $X, $Y)
