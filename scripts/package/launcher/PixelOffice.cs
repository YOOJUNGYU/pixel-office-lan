// Pixel Office launcher for Windows (C# 5, .NET Framework 4.x; built in package.yml by the csc.exe
// that ships with Windows, installed next to node.exe). Replaces launch.vbs: endpoint AV flags
// wscript running a hidden-window script, and a plain exe is the boring way to start a GUI-less node.
//
//   PixelOffice.exe [args...]   start "<dir>\node.exe" "<dir>\app\cli.js" [args...] with no console
//                               window, then exit (shortcuts pass --open; the pixeloffice: URL
//                               scheme passes nothing — its command is fixed, never the URL)
//
// Keep it boring: no registry, no network, no shell — exactly one child, our own node.exe.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("Pixel Office")]
[assembly: AssemblyProduct("Pixel Office")]
[assembly: AssemblyCompany("YOOJUNGYU")]
[assembly: AssemblyVersion("1.0.0.0")]

static class PixelOfficeLauncher
{
    // One argv element quoted the way CommandLineToArgvW (node's argv parser) reads it back.
    static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
        StringBuilder sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in a)
        {
            if (c == '\\') { slashes++; continue; }
            sb.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            slashes = 0;
            sb.Append(c);
        }
        sb.Append('\\', slashes * 2);
        return sb.Append('"').ToString();
    }

    static int Main(string[] args)
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        StringBuilder cmd = new StringBuilder(Quote(Path.Combine(dir, "app", "cli.js")));
        foreach (string a in args) cmd.Append(' ').Append(Quote(a));
        ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(dir, "node.exe"), cmd.ToString());
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = dir;
        try
        {
            using (Process.Start(psi)) { }
            return 0;
        }
        catch
        {
            return 1;
        }
    }
}
