// Pixel Office tray helper for Windows (C# 5, .NET Framework 4.x WinForms; built in package.yml by
// the csc.exe that ships with Windows, installed next to node.exe). A plain signed-by-nobody exe is
// still far less suspicious to endpoint AV than a hidden -EncodedCommand PowerShell (v1.0.0).
//
//   PixelOfficeTray.exe --pid <server pid>    tray icon until that pid is gone (1 s poll)
//   PixelOfficeTray.exe --smoke               build the icon, print the language + "ready", exit 0
//                                             (also when PO_TRAY_SMOKE=1, as cli.js --tray-check sets it)
//   PixelOfficeTray.exe --make-shortcut <lnk> <target> <args> <workdir>   write a .lnk (WScript.Shell COM)
//
// IPC (lan/tray.ts): stdout = one word per line: "ko"|"en" (UI language, before "ready"), "ready",
// "open", "quit". stdin = one command per line: "notify <base64 UTF-8 body>" → a balloon tip, which
// Windows 10/11 shows as a toast attributed to this exe (FileDescription "Pixel Office" + its icon).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Pixel Office")]
[assembly: AssemblyProduct("Pixel Office")]
[assembly: AssemblyCompany("YOOJUNGYU")]
[assembly: AssemblyVersion("1.0.0.0")]

static class PixelOfficeTray
{
    static readonly Regex NotifyLine = new Regex("^notify ([A-Za-z0-9+/=]+)$");
    static readonly Queue<string> Pending = new Queue<string>();

    static void Say(string s)
    {
        try { Console.Out.WriteLine(s); Console.Out.Flush(); } catch { }
    }

    static Icon LoadIcon()
    {
        string exe = Application.ExecutablePath;
        try
        {
            string ico = Path.Combine(Path.GetDirectoryName(exe), "icon.ico");
            if (File.Exists(ico)) return new Icon(ico, SystemInformation.SmallIconSize);
        }
        catch { }
        try { return Icon.ExtractAssociatedIcon(exe); } catch { }
        return SystemIcons.Application;
    }

    static int MakeShortcut(string[] a)
    {
        if (a.Length != 5) return 2;
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { a[1] });
            Type lt = lnk.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { a[2] });
            lt.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { a[3] });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { a[4] });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            return 0;
        }
        catch (Exception e)
        {
            try { Console.Error.WriteLine(e.Message); } catch { }
            return 1;
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--make-shortcut") return MakeShortcut(args);
        bool smoke = Array.IndexOf(args, "--smoke") >= 0 || Environment.GetEnvironmentVariable("PO_TRAY_SMOKE") == "1";
        int pid = 0;
        int at = Array.IndexOf(args, "--pid");
        if (at >= 0 && at + 1 < args.Length) int.TryParse(args[at + 1], out pid);

        bool ko = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ko";
        NotifyIcon ni = new NotifyIcon();
        ni.Icon = LoadIcon();
        ni.Text = "Pixel Office";
        ni.Visible = true;
        Say(ko ? "ko" : "en");
        Say("ready");
        if (smoke)
        {
            ni.Visible = false;
            ni.Dispose();
            return 0;
        }

        System.Diagnostics.Process parent = null;
        try { if (pid > 0) parent = System.Diagnostics.Process.GetProcessById(pid); } catch { }
        if (parent == null)
        {
            ni.Visible = false;
            ni.Dispose();
            return 0;
        }

        Action leave = delegate
        {
            try { ni.Visible = false; ni.Dispose(); } catch { }
            Application.Exit();
        };
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add(ko ? "Pixel Office 열기" : "Open Pixel Office", null, delegate { Say("open"); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(ko ? "Pixel Office 종료" : "Quit Pixel Office", null, delegate { Say("quit"); leave(); });
        ni.ContextMenuStrip = menu;
        DateTime last = DateTime.MinValue;
        ni.MouseClick += delegate(object s, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && (DateTime.Now - last).TotalSeconds > 1)
            {
                last = DateTime.Now;
                Say("open");
            }
        };

        // stdin on a background thread; the UI-thread timer drains it (and watches the server).
        Thread reader = new Thread(delegate()
        {
            try
            {
                StreamReader input = new StreamReader(Console.OpenStandardInput(), Encoding.ASCII);
                string line;
                while ((line = input.ReadLine()) != null)
                    lock (Pending) Pending.Enqueue(line);
            }
            catch { }
        });
        reader.IsBackground = true;
        reader.Start();

        System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        timer.Interval = 1000;
        timer.Tick += delegate
        {
            try { if (parent.HasExited) { timer.Stop(); leave(); return; } }
            catch { timer.Stop(); leave(); return; }
            while (true)
            {
                string l;
                lock (Pending)
                {
                    if (Pending.Count == 0) break;
                    l = Pending.Dequeue();
                }
                Match m = NotifyLine.Match(l.TrimEnd('\r'));
                if (!m.Success) continue;
                try
                {
                    string body = Encoding.UTF8.GetString(Convert.FromBase64String(m.Groups[1].Value));
                    ni.ShowBalloonTip(5000, "Pixel Office", body, ToolTipIcon.None);
                }
                catch { }
            }
        };
        timer.Start();
        Application.Run();
        return 0;
    }
}
