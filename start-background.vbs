' 背景啟動簽核系統（不顯示黑窗），並開啟瀏覽器 — 埠 8080
Option Explicit
Dim sh, fso, root, bat, port, already, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
bat = root & "\start-hidden.bat"
port = "8080"
already = False

rc = sh.Run("powershell -NoProfile -Command ""exit (Get-NetTCPConnection -LocalPort " & port & " -State Listen -EA SilentlyContinue | Measure-Object).Count""", 0, True)
If rc > 0 Then already = True

If Not already Then
  If fso.FileExists(bat) Then
    sh.Run """" & bat & """", 0, False
    WScript.Sleep 2500
  Else
    MsgBox "找不到 start-hidden.bat", 16, "線上簽核系統"
    WScript.Quit 1
  End If
End If

sh.Run "http://127.0.0.1:" & port & "/", 1, False
