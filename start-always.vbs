' 背景啟動簽核系統（不顯示黑窗）並開啟瀏覽器 — 埠 8080
Option Explicit
Dim sh, fso, root, node, port, rc, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
port = "8080"
node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node"
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder root & "\data"

' 已在聽就只開瀏覽器
rc = sh.Run("powershell -NoProfile -Command ""exit (Get-NetTCPConnection -LocalPort " & port & " -State Listen -EA SilentlyContinue | Measure-Object).Count""", 0, True)
If rc = 0 Then
  ' 用 PowerShell Start-Process 讓 process 獨立存活
  cmd = "powershell -NoProfile -ExecutionPolicy Bypass -Command ""Start-Process -FilePath '" & node & "' -ArgumentList 'start-server.js' -WorkingDirectory '" & root & "' -WindowStyle Hidden"""
  sh.Run cmd, 0, False
  WScript.Sleep 2500
End If
sh.Run "http://127.0.0.1:" & port & "/", 1, False
