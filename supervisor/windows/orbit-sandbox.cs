// ORBIT test sandbox (Windows). Runs one command inside an AppContainer with NO capabilities, inside a job that ends every
// process it started when this exits. Used by test-run.ts for every command that executes repo or model-written code.
// An AppContainer without internetClient / privateNetworkClientServer can't open network connections, can't reach loopback
// services of other processes (ORBIT on 127.0.0.1:3000 included) and can't resolve names, and it can open only files granted to
// its SID or to ALL APPLICATION PACKAGES. That covers what a per-user firewall rule can't (loopback, DNS through the DNS Client
// service). Built by install-test-runner.ps1 with the .NET Framework compiler that ships with Windows (C# 5).
//   orbit-sandbox.exe --sid                       print the AppContainer SID (for the ACL grants)
//   orbit-sandbox.exe --cwd <dir> -- <exe> [args]  run <exe> in the sandbox; exit code = its exit code (125 = couldn't start)
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

static class OrbitSandbox {
  const string Name = "orbit.test.runner";

  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr str);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr retSize);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("advapi32.dll", SetLastError = true)] static extern uint GetSecurityInfo(IntPtr h, int type, uint info, IntPtr owner, IntPtr group, out IntPtr dacl, IntPtr sacl, out IntPtr sd);
  [DllImport("advapi32.dll", SetLastError = true)] static extern uint SetSecurityInfo(IntPtr h, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint SetEntriesInAcl(int count, ref EXPLICIT_ACCESS ea, IntPtr oldAcl, out IntPtr newAcl);
  [StructLayout(LayoutKind.Sequential)] struct TRUSTEE { public IntPtr pMultipleTrustee; public int MultipleTrusteeOperation, TrusteeForm, TrusteeType; public IntPtr ptstrName; }
  [StructLayout(LayoutKind.Sequential)] struct EXPLICIT_ACCESS { public uint grfAccessPermissions; public int grfAccessMode; public uint grfInheritance; public TRUSTEE Trustee; }

  // A process in an AppContainer can't load user32 (exit 0xC0000142) unless its SID may use the window station and desktop it
  // starts on. The task's own (non-interactive) ones belong to this logon session; grant the SID on them, nothing else.
  static void GrantUi(IntPtr handle, uint rights, IntPtr sid, string what) {
    IntPtr dacl, sd, newAcl;
    uint e = GetSecurityInfo(handle, 7 /* SE_WINDOW_OBJECT */, 4 /* DACL */, IntPtr.Zero, IntPtr.Zero, out dacl, IntPtr.Zero, out sd);
    if (e != 0) throw new Win32Exception((int)e, "GetSecurityInfo " + what);
    var ea = new EXPLICIT_ACCESS(); ea.grfAccessPermissions = rights; ea.grfAccessMode = 1 /* GRANT */; ea.Trustee.TrusteeForm = 0 /* SID */; ea.Trustee.ptstrName = sid;
    e = SetEntriesInAcl(1, ref ea, dacl, out newAcl);
    if (e != 0) throw new Win32Exception((int)e, "SetEntriesInAcl " + what);
    e = SetSecurityInfo(handle, 7, 4, IntPtr.Zero, IntPtr.Zero, newAcl, IntPtr.Zero);
    if (e != 0) throw new Win32Exception((int)e, "SetSecurityInfo " + what);
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong R, W, O, RB, WB, OB; }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION Basic; public IO_COUNTERS Io;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }

  static Exception Fail(string what) { return new Win32Exception(Marshal.GetLastWin32Error(), what); }

  static IntPtr Derive() {
    IntPtr sid; int hr = DeriveAppContainerSidFromAppContainerName(Name, out sid);
    if (hr != 0) throw new Win32Exception(hr, "DeriveAppContainerSidFromAppContainerName");
    return sid;
  }

  static string SidString(IntPtr sid) {
    IntPtr s; if (!ConvertSidToStringSid(sid, out s)) throw Fail("ConvertSidToStringSid");
    return Marshal.PtrToStringUni(s);
  }

  // Windows command-line quoting (the rules CommandLineToArgvW and the C runtime parse back).
  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\""); int bs = 0;
    foreach (char c in a) {
      if (c == '\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
      sb.Append('\\', bs); bs = 0; sb.Append(c);
    }
    sb.Append('\\', bs * 2); sb.Append('"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    try {
      if (args.Length == 1 && args[0] == "--sid") { Console.WriteLine(SidString(Derive())); return 0; }
      if (args.Length < 4 || args[0] != "--cwd" || args[2] != "--") { Console.Error.WriteLine("usage: orbit-sandbox --sid | --cwd <dir> -- <exe> [args]"); return 2; }
      string cwd = args[1];
      IntPtr sid; int hr = CreateAppContainerProfile(Name, "ORBIT test runner", "Model-written tests: no network capabilities", IntPtr.Zero, 0, out sid);
      if (hr == unchecked((int)0x800700B7)) sid = Derive(); // already exists
      else if (hr != 0) throw new Win32Exception(hr, "CreateAppContainerProfile");

      GrantUi(GetProcessWindowStation(), 0x000F037F /* WINSTA_ALL_ACCESS */, sid, "window station");
      GrantUi(GetThreadDesktop(GetCurrentThreadId()), 0x000F01FF /* DESKTOP_ALL */, sid, "desktop");
      var caps = new SECURITY_CAPABILITIES(); caps.AppContainerSid = sid; // no capabilities at all
      IntPtr capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(caps)); Marshal.StructureToPtr(caps, capsPtr, false);
      IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      IntPtr list = Marshal.AllocHGlobal(size);
      if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw Fail("InitializeProcThreadAttributeList");
      if (!UpdateProcThreadAttribute(list, 0, (IntPtr)0x00020009, capsPtr, (IntPtr)Marshal.SizeOf(caps), IntPtr.Zero, IntPtr.Zero)) throw Fail("UpdateProcThreadAttribute");

      var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(si); si.lpAttributeList = list;
      si.StartupInfo.dwFlags = 0x100; // STARTF_USESTDHANDLES: output goes back to test-run.ts
      si.StartupInfo.hStdInput = GetStdHandle(-10); si.StartupInfo.hStdOutput = GetStdHandle(-11); si.StartupInfo.hStdError = GetStdHandle(-12);
      var cmd = new StringBuilder();
      for (int i = 3; i < args.Length; i++) { if (i > 3) cmd.Append(' '); cmd.Append(Quote(args[i])); }

      IntPtr job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) throw Fail("CreateJobObject");
      var lim = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); lim.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE: no process outlives the run
      if (!SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(lim))) throw Fail("SetInformationJobObject");

      PROCESS_INFORMATION pi;
      const uint EXTENDED_STARTUPINFO_PRESENT = 0x80000, CREATE_SUSPENDED = 0x4;
      if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED, IntPtr.Zero, cwd, ref si, out pi)) throw Fail("CreateProcess " + args[3]);
      if (!AssignProcessToJobObject(job, pi.hProcess)) { TerminateProcess(pi.hProcess, 125); throw Fail("AssignProcessToJobObject"); }
      ResumeThread(pi.hThread);
      WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
      uint code; GetExitCodeProcess(pi.hProcess, out code);
      return (int)code; // the job handle closes on exit and ends whatever the command left running
    } catch (Exception e) {
      Console.Error.WriteLine("orbit-sandbox: " + e.Message);
      return 125;
    }
  }
}
