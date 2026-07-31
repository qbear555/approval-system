# 在 Synology NAS 上部署「線上簽核系統」

適用：**DSM 7** + **Container Manager**（舊稱 Docker）

---

## 一、NAS 前置準備

1. **套件中心** → 安裝 **Container Manager**
2. 在 File Station 建立資料夾，例如：
   ```
   /docker/approval-system/
   /docker/approval-system/data/
   ```
   （對應路徑多為 `/volume1/docker/approval-system/`）
3. 建議：NAS 固定 IP，或 DHCP 保留位址

---

## 二、把專案放到 NAS

### 方式 A：用電腦上傳（最簡單）

1. 在本機準備好專案資料夾（含 `Dockerfile`、`docker-compose.yml`、`server/`、`public/`、`package.json`）
2. 用 **File Station** 或 **SMB** 上傳到：
   ```
   \\你的NAS\docker\approval-system\
   ```
3. 若要沿用現有帳號／簽核資料，把本機的 `approval.db` 放到：
   ```
   \\你的NAS\docker\approval-system\data\approval.db
   ```
   （也可用 `D:\電子簽核\approval.db`）

### 方式 B：Git（若 NAS 有 Git Server）

```bash
cd /volume1/docker
git clone <你的倉庫> approval-system
```

---

## 三、用 Container Manager 啟動

### 建議：專案設定（Project）

1. 開啟 **Container Manager** → **專案** → **新增**
2. 路徑選：`/docker/approval-system`（有 `docker-compose.yml` 的那層）
3. 專案名稱：`approval-system`
4. 來源：選既有的 `docker-compose.yml`
5. 建立並啟動

首次會 **build 映像**（需能連外網下載 Node 與字型），可能 5–15 分鐘。

### 或用 SSH（進階）

```bash
# 啟用 DSM 控制台 → 終端機與 SNMP → SSH
ssh admin@你的NAS_IP

sudo -i
cd /volume1/docker/approval-system
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f
```

---

## 四、存取網址

| 位置 | 網址 |
|------|------|
| 區網 HTTP | `http://NAS的IP:3847` |
| 區網 **HTTPS** | `https://NAS的IP:3848`（自簽憑證，瀏覽器會提示不受信任，選繼續即可） |
| 本機（若有） | `http://localhost:3847` / `https://localhost:3848` |

**預設管理員（全新資料庫時）**

- 帳號：`admin`
- 密碼：`admin123`  
請立刻修改。

若已放入備份的 `approval.db`，請用原本的帳號密碼。

---

## 五、重要設定

### 1. 修改 JWT 密鑰

編輯 `docker-compose.yml`：

```yaml
- JWT_SECRET=請改成很長的隨機英數
```

改完後在 Container Manager 重新建置／重啟專案。

### 2. 資料持久化

`./data` 已掛載到容器 `/app/data`，包含：

- `approval.db`（使用者、流程、簽核）
- `uploads/`（附件）
- `backups/`（備份 PDF）

**請定期備份整個 `data` 資料夾。**

### 3. 防火牆 / 埠號

- DSM **控制台 → 安全性 → 防火牆**：允許 **TCP 3847**、**TCP 3848**（若有開防火牆）
- 若要改埠，修改 `docker-compose.yml`：
  ```yaml
  ports:
    - "8080:3847"   # HTTP 外面用 8080
    - "8443:3848"   # HTTPS 外面用 8443
  ```
- HTTPS 自簽憑證存放於 `data/certs/`（首次啟動自動產生）；若 NAS IP 變更，可刪除該資料夾後重啟容器以重新產生（並更新 `SSL_SAN`）

### 4. 外網存取（選用，請謹慎）

- **不建議**直接把 3847 對應到路由器對外埠
- 較安全：使用 **Synology 反向代理 + HTTPS**（控制台 → 登入入口 → 進階 → 反向代理伺服器）
  - 來源：`https://sign.你的網域`
  - 目的地：`http://localhost:3847`
- 或僅在 **VPN / 區網** 使用

---

## 六、更新系統

1. 上傳新的 `server/`、`public/`、`package.json` 等（**不要覆蓋** `data/`）
2. Container Manager → 專案 → **建置** → **重新啟動**  
   或 SSH：
   ```bash
   cd /volume1/docker/approval-system
   docker compose build --no-cache
   docker compose up -d
   ```

---

## 七、常見問題

| 問題 | 處理 |
|------|------|
| 建置失敗、抓不到映像 | 檢查 NAS 能否上網；必要時設 Docker 代理 |
| 頁面打不開 | 看容器是否 Running；埠 3847 是否衝突；防火牆 |
| PDF 中文亂碼 | 映像已內建 Noto 繁中 OTF；請用本專案 Dockerfile 重建 |
| 資料不見 | 確認 volume `./data` 有掛載，且未刪除該資料夾 |
| 權限錯誤 | `data` 資料夾權限允許 Docker 寫入；必要時對資料夾設 777 測試後再收斂權限 |

---

## 八、從 Windows 遷移現有資料

1. 停止本機簽核服務  
2. 複製：
   - `approval.db`
   - 若有：`data/uploads`、`data/backups`、`data/mail-config.json`
3. 放到 NAS：`/docker/approval-system/data/`
4. 再啟動容器

備份來源也可使用：`D:\電子簽核\approval.db`

---

## 九、檔案清單（部署需要）

```
approval-system/
  Dockerfile
  docker-compose.yml
  package.json
  package-lock.json
  server/
  public/
  data/          ← 執行後產生 / 自行放入 DB
  docs/SYNOLOGY.md
```

不需要上傳：`node_modules`、`dist`、本機 Windows 安裝包。
