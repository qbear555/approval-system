========================================
  Online Approval System - Install Guide
  線上簽核系統 - 安裝與啟停說明
========================================

[Requirements]
- Windows 10 / 11 (64-bit)
- Portable Node.js is included (no need to install Node first)

[Install]
1. Copy Install-ApprovalSystem.bat + ApprovalSystem-Portable.zip together
2. Double-click Install-ApprovalSystem.bat
   Or extract zip and run install.bat

Install folder: %LOCALAPPDATA%\ApprovalSystem
URL after install: http://127.0.0.1:3847/
Admin: Admin / see data/.admin-bootstrap.txt (change immediately)

========================================
[START / ENABLE the server]
========================================
The website only works when the server is running.

Option 1 (Recommended): Double-click desktop shortcut "線上簽核系統"
Option 2: Start Menu -> 線上簽核系統 -> 啟動簽核系統
Option 3: Open %LOCALAPPDATA%\ApprovalSystem
          - start-background.vbs  (background, no black window)
          - start.bat             (shows console; close window = stop)
          - start-hidden.bat      (background only, no browser)

Check if running:
  Open http://127.0.0.1:3847/
  Or run: netstat -ano | findstr :3847
  (LISTENING means server is ON)

========================================
[STOP / DISABLE the server]
========================================
After stop, nobody can open the site until you start again.

Option 1 (Recommended): Start Menu -> 線上簽核系統 -> 停止簽核系統
Option 2: Run stop.bat in %LOCALAPPDATA%\ApprovalSystem
Option 3: If started with start.bat, press Ctrl+C or close the black window

Check if stopped:
  http://127.0.0.1:3847/ cannot connect
  Or: netstat -ano | findstr :3847 shows nothing listening

[Daily tips]
- Need to use the system: start the server first
- End of day / maintenance: stop the server
- After reboot: start again (unless you set auto-start)

[Data paths - backup regularly]
  DB:      %LOCALAPPDATA%\ApprovalSystem\app\data\approval.db
  Backups: %LOCALAPPDATA%\ApprovalSystem\app\data\backups
  Uploads: %LOCALAPPDATA%\ApprovalSystem\app\data\uploads

[LAN]
1. Install + START on the server PC
2. Allow firewall TCP 3847
3. Clients open: http://SERVER-IP:3847/

[Uninstall]
Start Menu -> 線上簽核系統 -> 解除安裝
Stop the server before uninstall. Backup approval.db first.
========================================
