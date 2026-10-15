' 背景啟動簽核系統（不顯示黑窗），並開啟瀏覽器 — 埠 3847
Option Explicit
Dim sh, fso, root, bat, port, already, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
bat = root & "\start-hidden.bat"
port = "3847"
already = False

rc = sh.Run("powershell -NoProfile -Command ""exit (Get-NetTCPConnection -LocalPort " & port & " -State Listen -EA SilentlyContinue | Measure-Object).Count""", 0, True)
If rc > 0 Then already = True

If Not already Then
  ' 優先啟動 WSL Ubuntu (Docker 容器簽核系統)
  sh.Run "wsl.exe -d Ubuntu-26.04 -u root --exec /bin/true", 0, True
  WScript.Sleep 2500
  rc = sh.Run("powershell -NoProfile -Command ""exit (Get-NetTCPConnection -LocalPort " & port & " -State Listen -EA SilentlyContinue | Measure-Object).Count""", 0, True)
  If rc > 0 Then already = True
  
  If Not already And fso.FileExists(bat) Then
    sh.Run """" & bat & """", 0, False
    WScript.Sleep 2500
  End If
End If

sh.Run "http://127.0.0.1:" & port & "/", 1, False
