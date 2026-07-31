# 線上簽核系統 — 完整遷移到 Ubuntu

適用：Ubuntu 22.04 / 24.04 LTS（x86_64）

本系統已用 **Node.js + SQLite + 本機檔案**，無 Windows 專屬依賴，可完整搬到 Ubuntu。

---

## 一、建議方式（二選一）

| 方式 | 優點 | 適合 |
|------|------|------|
| **A. Docker Compose**（建議） | 環境一致、好備份、與 NAS 相同 | 正式主機、有 Docker |
| **B. 原生 Node + systemd** | 不依賴 Docker、好除錯 | 單純 Linux 伺服器 |

兩種方式**資料格式相同**（`data/approval.db`、uploads、backups），可互相搬移。

---

## 二、要搬哪些資料（最重要）

從舊機（Windows / Synology）複製整個 **`data`** 目錄：

```
data/
  approval.db          ← 帳號、流程、簽核紀錄（核心）
  approval.db-wal      ← 若有，一併複製（或先 checkpoint）
  approval.db-shm      ← 若有可一併
  uploads/             ← 上傳附件
  backups/             ← 備份 PDF／ZIP
  mail-config.json     ← 若有用 Email
  mail-outbox/         ← 若有
```

**路徑對照**

| 來源 | 路徑 |
|------|------|
| Windows 專案 | `C:\Users\…\approval-system\data\` |
| Synology | `/volume1/docker/approval-system/data/` |
| Ubuntu Docker | `./data`（compose 目錄下） |
| Ubuntu 原生 | `/opt/approval-system/data/`（本文件預設） |

搬移前請先**停止舊服務**，避免資料庫寫入中。

---

## 三、方式 A：Docker Compose（建議）

### 1. 安裝 Docker（Ubuntu）

```bash
sudo apt update
sudo apt install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# 重新登入後再繼續
docker --version
docker compose version
```

### 2. 上傳專案

```bash
# 範例：放到 /opt
sudo mkdir -p /opt/approval-system
sudo chown "$USER:$USER" /opt/approval-system

# 從本機上傳（在 Windows PowerShell / WSL）
# scp -r server public fonts package.json package-lock.json Dockerfile docker-compose.yml \
#   user@ubuntu-ip:/opt/approval-system/
```

或用 git / rsync / USB。

### 3. 放入資料

```bash
cd /opt/approval-system
mkdir -p data
# 將舊 data 整包覆蓋到此
# rsync -avz --progress old:/path/data/ ./data/
```

### 4. 修改密鑰

編輯 `docker-compose.yml`：

```yaml
- JWT_SECRET=請改成很長的隨機字串
- TZ=Asia/Taipei
```

### 5. 啟動

```bash
cd /opt/approval-system
docker compose up -d --build
docker compose ps
docker compose logs -f
```

瀏覽：`http://Ubuntu的IP:3847`

### 6. 開機自啟

`restart: unless-stopped` 已設定；開機後 Docker 會自動拉起容器（需 Docker 服務已啟用）。

```bash
sudo systemctl enable docker
```

### 7. 常用指令

```bash
docker compose restart
docker compose down
docker compose up -d --build   # 更新程式後重建
docker compose logs -f --tail=100
```

---

## 四、方式 B：原生 Node.js + systemd

### 1. 一鍵安裝腳本

將專案放到 Ubuntu 後：

```bash
cd /opt/approval-system   # 或你的專案路徑
chmod +x scripts/ubuntu-install.sh scripts/ubuntu-start.sh
sudo ./scripts/ubuntu-install.sh
```

腳本會：

- 安裝 Node.js 22（NodeSource）
- `npm install --omit=dev`
- 建立 `data/` 目錄
- 安裝 **systemd** 服務 `approval-system`
- 啟用開機自啟

### 2. 手動步驟（等同腳本）

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential

cd /opt/approval-system
npm install --omit=dev

mkdir -p data/uploads data/backups data/mail-outbox
# 複製舊 data 進來

# 環境變數
sudo tee /etc/default/approval-system <<'EOF'
PORT=3847
NODE_ENV=production
JWT_SECRET=請改成隨機長字串
TZ=Asia/Taipei
EOF

# systemd
sudo cp deploy/ubuntu/approval-system.service /etc/systemd/system/
# 若專案路徑不是 /opt/approval-system，請編輯 service 內 WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now approval-system
sudo systemctl status approval-system
```

### 3. 常用指令

```bash
sudo systemctl start approval-system
sudo systemctl stop approval-system
sudo systemctl restart approval-system
sudo journalctl -u approval-system -f
```

### 4. 防火牆（若有 ufw）

```bash
sudo ufw allow 3847/tcp
sudo ufw reload
```

---

## 五、從 Synology NAS 遷移範例

在 **Windows 或 Ubuntu** 上：

```bash
# 1. 停止 NAS 容器（SSH 進 NAS）
ssh tsuming@192.168.99.220
# sudo docker stop approval-system

# 2. 拉資料（在 Ubuntu 上）
mkdir -p /opt/approval-system/data
rsync -avz --progress tsuming@192.168.99.220:/volume1/docker/approval-system/data/ \
  /opt/approval-system/data/

# 3. 拉程式（或重新 git clone / 上傳）
rsync -avz --progress tsuming@192.168.99.220:/volume1/docker/approval-system/ \
  /opt/approval-system/ \
  --exclude data --exclude node_modules

# 4. 啟動（Docker）
cd /opt/approval-system
docker compose up -d --build
```

**注意：** Synology SFTP 路徑可能是 `/docker/approval-system/data/`（無 `volume1` 前綴），視連線方式而定。

---

## 六、從 Windows 遷移範例

```powershell
# Windows：先停止本機簽核服務
# 再打包 data
Compress-Archive -Path C:\Users\TsuMing\Documents\approval-system\data\* `
  -DestinationPath D:\approval-data-backup.zip
```

Ubuntu：

```bash
cd /opt/approval-system
unzip /path/to/approval-data-backup.zip -d data/
docker compose up -d --build
# 或 systemd: sudo systemctl restart approval-system
```

也可用本專案腳本（在專案根目錄）：

```bash
chmod +x scripts/export-data-bundle.sh   # 若在 Linux/WSL 打包
# 或 Windows: scripts\export-data-bundle.ps1
```

---

## 七、PDF 中文

- Docker 映像會帶入專案 `fonts/`（如 `kaiu.ttf`）
- 原生安裝請保留 `fonts/kaiu.ttf`，或安裝：

```bash
sudo apt install -y fonts-noto-cjk
# 系統仍優先使用專案 fonts/ 內單一 TTF/OTF
```

---

## 八、Nginx 反向代理 + HTTPS（選用）

```nginx
server {
    listen 443 ssl;
    server_name sign.example.com;
    # ssl_certificate ...;
    # ssl_certificate_key ...;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 九、檢查清單

- [ ] Ubuntu 已安裝 Docker 或 Node 22+
- [ ] 已停止舊主機服務
- [ ] 已完整複製 `data/`（含 db、uploads、backups）
- [ ] 已修改 `JWT_SECRET`
- [ ] 防火牆開放 3847（或僅內網 / Nginx）
- [ ] 用管理員帳號登入測試
- [ ] 測試 PDF／ZIP 下載、附件、備份

---

## 十、疑難排解

| 問題 | 處理 |
|------|------|
| 連不上 | `ss -lntp \| grep 3847`；檢查 ufw / 雲端安全組 |
| 登入失敗 | 確認 `data/approval.db` 有正確搬入 |
| 附件 404 | 確認 `data/uploads` 一併搬移 |
| PDF 亂碼 | 確認 `fonts/kaiu.ttf` 存在於映像／專案 |
| 權限錯誤 | `sudo chown -R 1000:1000 data`（Docker node 使用者）或 `chown` 給執行服務的帳號 |

---

## 相關檔案

| 檔案 | 說明 |
|------|------|
| `Dockerfile` / `docker-compose.yml` | Docker 部署 |
| `scripts/ubuntu-install.sh` | 原生一鍵安裝 |
| `scripts/ubuntu-start.sh` | 前景啟動（測試用） |
| `deploy/ubuntu/approval-system.service` | systemd 單元 |
| `scripts/export-data-bundle.ps1` | Windows 打包 data |
| `docs/SYNOLOGY.md` | NAS 部署（可當來源） |
