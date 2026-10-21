' Starts Pixel Office (node.exe app\cli.js) without a console window.
' Arguments are passed through, e.g. "wscript launch.vbs --open".
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = """" & dir & "\node.exe"" """ & dir & "\app\cli.js"""
For Each a In WScript.Arguments
  cmd = cmd & " " & a
Next
CreateObject("WScript.Shell").Run cmd, 0, False
