# HTTPS 憑證自動續期（Synology NAS + Let's Encrypt）

> 適用：NAS 正式站 `https://catshome.tw:3848`
> 相關腳本：`fix-cert.sh`（NAS 上）、[`scripts/fix-https-le-nas.js`](../scripts/fix-https-le-nas.js)

## 問題背景

簽核系統跑在 Docker 容器裡，HTTPS 憑證讀的是 `data/certs/cert.pem` 與 `data/certs/key.pem`。

DSM 自己的 Let's Encrypt 憑證存在 `/usr/syno/etc/certificate/_archive/<代號>/`，**DSM 續期時只會更新自己那份，不會動到容器的 `data/certs/`**。兩者之間沒有任何自動連結。

結果就是：DSM 顯示憑證正常，但簽核系統 `:3848` 仍在用舊憑證，直到過期後使用者瀏覽器開始跳警告。

### 實際發生過的案例（2026-08-07 發現）

| 來源 | 有效期 | serial |
|------|--------|--------|
| DSM `:5001` | ~2026-10-27 | `0680F872…` |
| 簽核系統 `:3848` | ~2026-08-24 | `05299CEA…` |

DSM 已於 **7/29 自動續期成功**，但簽核系統的 `data/certs/cert.pem` 還停在 **7/24 手動複製**的舊檔，兩者差了近兩個月效期。距離到期僅剩 17 天才被發現。

## 檢查目前狀態

任何一台電腦都能查，不需登入 NAS：

```bash
echo | openssl s_client -connect catshome.tw:3848 -servername catshome.tw 2>/dev/null | openssl x509 -noout -dates -serial
```

跟 DSM 自己的比對：

```bash
echo | openssl s_client -connect 192.168.99.220:5001 -servername catshome.tw 2>/dev/null | openssl x509 -noout -dates -serial
```

**兩者的 serial 應該相同。** 不同就代表同步斷了。

## 手動修復

NAS 上的 `fix-cert.sh`（位於 `/volume1/docker/approval-system/fix-cert.sh`）：

```bash
ssh -t nas "sudo sh /volume1/docker/approval-system/fix-cert.sh"
```

需要 sudo（讀 `/usr/syno/etc/certificate/` 與操作 Docker 都要 root）。腳本流程：

1. 掃描整個 DSM 憑證庫，列出每份憑證的到期日與 serial
2. 自動挑出**含目標網域且效期最新**的那份（ECC 優先，其次 RSA）
3. 比對目前 `:3848` 的 serial，**相同就直接結束**（可安全重複執行）
4. 備份舊 `cert.pem` / `key.pem`（檔名帶時間戳）
5. 複製新憑證、設定權限（`cert.pem` 644、`key.pem` 600、擁有者 `1000:1000`）
6. 重啟 `approval-system` 容器
7. 連 `127.0.0.1:3848` 驗證實際提供的憑證

> **不要**改用 [`scripts/fix-https-le-nas.js`](../scripts/fix-https-le-nas.js) 的寫死路徑。該腳本第 17 行把憑證資料夾代號硬編成 `Bpqtwj`，DSM 重新簽發時代號可能改變，會複製到錯的憑證。`fix-cert.sh` 是自動偵測的，沒這個問題。

## 設定自動排程（建議，避免重複發生）

`fix-cert.sh` 有「已是最新就跳過」的判斷，每天跑不會有副作用。

DSM → **控制台 → 工作排程器 → 新增 → 排定的工作 → 使用者定義的指令碼**

| 欄位 | 設定 |
|------|------|
| 工作名稱 | 同步 LE 憑證到簽核系統 |
| 使用者 | `root` |
| 排程 | 每日（時間任選，建議凌晨） |
| 指令碼 | `sh /volume1/docker/approval-system/fix-cert.sh` |

排程建立後，建議手動執行一次確認輸出正常。

## 疑難排解

**腳本跑完憑證沒變？**
先看 `data/certs/` 有沒有產生新的 `cert.pem.bak-<時間戳>`。

- **沒有備份檔** → 腳本根本沒執行到複製那步，是 SSH 認證或 sudo 的問題
- **有備份檔但 serial 沒變** → 腳本判定「已是最新」，代表 DSM 那份也是舊的，要先在 DSM 端處理續期

**憑證到期日正確，但瀏覽器仍顯示不受信任？**
確認網址是用網域 `catshome.tw:3848` 而非 IP。LE 憑證只簽 `catshome.tw`，直接用 `192.168.99.220:3848` 會出現名稱不符（`ERR_CERT_COMMON_NAME_INVALID`）。

**容器重啟後服務沒起來？**

```bash
ssh -t nas "sudo /usr/local/bin/docker logs --tail 50 approval-system"
```

舊憑證的備份都在 `data/certs/*.bak-*`，需要時可複製回去再重啟。
