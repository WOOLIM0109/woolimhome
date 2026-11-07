Option Explicit
Dim files, shell, base, mode, target, command
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
mode = LCase(WScript.Arguments(0))
If mode <> "worker" And mode <> "bridge" Then WScript.Quit 2
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
base = files.GetParentFolderName(WScript.ScriptFullName)
If mode = "worker" Then
  target = files.BuildPath(base, "worker.ps1")
Else
  target = files.BuildPath(base, "bridge-launch.ps1")
End If
If Not files.FileExists(target) Then
  base = files.BuildPath(base, "app")
  If mode = "worker" Then
    target = files.BuildPath(base, "worker.ps1")
  Else
    target = files.BuildPath(base, "bridge-launch.ps1")
  End If
End If
If Not files.FileExists(target) Then WScript.Quit 1
command = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & target & """"
shell.Run command, 0, False
