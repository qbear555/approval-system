<template>
  <div v-if="!isBuiltinAdmin" class="error-msg">
    僅系統內建 Admin 帳號可進入系統設定（其他最高權限使用者亦無法存取）
  </div>
  <div v-else class="system-settings-page">
    <div class="card" style="background:#eff6ff;border-color:#bfdbfe">
      <h3>系統版本（自動）</h3>
      <p style="margin:0;font-size:1.35rem;font-weight:700;color:#1d4ed8;letter-spacing:0.04em">{{ verLabel }}</p>
      <p class="muted" style="margin:8px 0 0;line-height:1.55;font-size:0.9rem" v-html="versionInfoHtml"></p>
    </div>

    <div class="card" v-html="deployCardHtml"></div>

    <div class="card">
      <h3>公司品牌</h3>
      <p class="muted" style="margin-top:0">設定後將顯示於登入頁、側欄與 PDF 抬頭。僅系統管理員可修改。</p>
      <form id="brand-form" class="form-grid" @submit.prevent="onSaveBrand">
        <div class="field">
          <label>公司名稱 *</label>
          <input
            name="companyName"
            required
            maxlength="80"
            v-model="brandForm.companyName"
            placeholder="顯示於系統標題與 PDF"
          />
        </div>
        <div class="field">
          <label>公司 Logo</label>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px">
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:12px;padding:12px 16px">
              <img
                id="brand-logo-preview"
                :src="logoUrl"
                alt="Logo 預覽"
                style="display:block;max-width:220px;max-height:64px;width:auto;height:auto;object-fit:contain"
              />
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex;align-items:center">
                上傳 Logo
                <input
                  type="file"
                  id="brand-logo-file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  class="hidden"
                  @change="onLogoChange"
                />
              </label>
              <button
                type="button"
                class="btn sm outline"
                id="btn-logo-reset"
                :disabled="!brand.hasCustomLogo"
                @click="onResetLogo"
              >
                還原預設 Logo
              </button>
              <span class="muted" style="font-size:0.78rem">PNG／JPG／GIF／WEBP，建議 2MB 以內；依比例縮放</span>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">儲存公司名稱</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>總覽公告（最多兩則）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        可同時設定<strong>兩則</strong>公司公告，啟用且在公布期間內者會一併顯示於總覽（第一則琥珀底、第二則藍底）。
        可各別上傳附件；同仁點「查看」可讀全文並開啟附件。
        部署不覆蓋 <code>data/</code> 內公告內容與附件。
      </p>
      <div
        v-for="(a, slot) in announcementsAdmin"
        :key="slot"
        :style="{
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '14px 16px',
          marginBottom: slot === 0 ? '16px' : '0',
          background: slot === 0 ? '#fffbeb' : '#eff6ff'
        }"
      >
        <h4 :style="{ margin: '0 0 8px', color: slot === 0 ? '#b45309' : '#1d4ed8' }">公告 {{ slot + 1 }}</h4>
        <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
          狀態：
          <strong :style="{ color: a.active ? '#15803d' : a.enabled ? '#b45309' : 'inherit' }">
            {{ formatAnnouncementStatus(a) }}
          </strong>
          <template v-if="a.updatedAt"> · 更新 {{ formatTaiwanDateTime(a.updatedAt) }}</template>
        </p>
        <form class="form-grid two announcement-form" :data-ann-slot="slot" @submit.prevent="onSaveAnnouncement(slot)">
          <div class="field check-row-box" style="grid-column:1/-1">
            <label class="check-row">
              <input type="checkbox" name="enabled" class="announcement-enabled" v-model="a.enabled" />
              <span><strong>啟用此則公告</strong>（須同時在公布期間內才會顯示於總覽）</span>
            </label>
          </div>
          <div class="field">
            <label>公布開始時間</label>
            <input type="datetime-local" name="startAt" v-model="a.startAtLocal" />
            <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝立即（不限制開始）</span>
          </div>
          <div class="field">
            <label>公布結束時間</label>
            <input type="datetime-local" name="endAt" v-model="a.endAtLocal" />
            <span class="muted" style="font-size:0.78rem;display:block;margin-top:4px">留空＝不自動下架</span>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>公告標題</label>
            <input name="title" maxlength="120" v-model="a.title" placeholder="例如：系統維護通知" />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>公告內容</label>
            <textarea name="body" rows="5" maxlength="8000" v-model="a.body" placeholder="支援多行文字…"></textarea>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>附件（選填）</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
              <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
                上傳附件
                <input
                  type="file"
                  class="announcement-file hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip,.7z"
                  @change="onUploadAnnFile(slot, $event)"
                />
              </label>
              <button
                type="button"
                class="btn sm outline btn-announcement-file-clear"
                :disabled="!a.hasFile"
                @click="onClearAnnFile(slot)"
              >
                移除附件
              </button>
              <button type="button" class="btn sm outline btn-announcement-preview" @click="onPreviewAnnouncement(slot)">
                預覽查看
              </button>
            </div>
            <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
              {{ a.hasFile ? `目前附件：${a.originalName || ''}` : '尚未上傳。允許 PDF／Office／圖片／TXT／CSV／ZIP，最大 15MB。' }}
            </span>
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="submit" class="btn primary">儲存公告 {{ slot + 1 }}</button>
          </div>
        </form>
      </div>
    </div>

    <div class="card">
      <h3>PDF 數位簽章（公司憑證）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        使用公司 <strong>PKCS#12（.p12／.pfx）</strong> 憑證對下載／備份的 PDF 做數位簽章，
        可用 Acrobat 等軟體驗證並偵測竄改。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong :style="{ color: pdfSign.ready ? '#15803d' : '#b45309' }">{{ signStatusText }}</strong>
        <template v-if="pdfSign.certFileName"> · 憑證檔：{{ pdfSign.certFileName }}</template>
        <template v-if="!pdfSign.libsReady && pdfSign.libsError">
          <br /><span style="color:#b45309">套件：{{ pdfSign.libsError }}</span>
        </template>
      </p>

      <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <h4 style="margin:0 0 8px;color:#1e40af">製作數位簽章（自簽憑證）</h4>
        <p class="muted" style="margin:0 0 12px;font-size:0.85rem;line-height:1.5">
          無正式公司憑證時，可在此<strong>產生自簽 .p12</strong>並立即用於 PDF 簽章（僅供內部）。
          標示 <strong style="color:#b45309">*</strong> 為必填。
          <br />CN／O 可填中文公司名稱；密碼請妥善保管。
        </p>
        <form id="pdf-sign-create-form" class="form-grid two" @submit.prevent="onCreatePdfCert">
          <div class="field">
            <label>通用名稱 CN *</label>
            <input
              name="commonName"
              required
              maxlength="64"
              v-model="createCertForm.commonName"
              placeholder="例如：CatsHome Inc. 或公司全名"
            />
          </div>
          <div class="field">
            <label>組織／公司名稱 O *</label>
            <input
              name="organization"
              required
              maxlength="64"
              v-model="createCertForm.organization"
              placeholder="與營業登記或對外名稱一致"
            />
          </div>
          <div class="field">
            <label>單位／部門 OU（選填）</label>
            <input name="organizationalUnit" maxlength="64" v-model="createCertForm.organizationalUnit" placeholder="例如：資訊部" />
          </div>
          <div class="field">
            <label>國家代碼 C *</label>
            <input
              name="country"
              required
              maxlength="2"
              v-model="createCertForm.country"
              placeholder="TW"
              style="text-transform:uppercase"
            />
          </div>
          <div class="field">
            <label>縣市／省 ST（選填）</label>
            <input name="province" maxlength="64" v-model="createCertForm.province" placeholder="例如：Taipei" />
          </div>
          <div class="field">
            <label>地區 L（選填）</label>
            <input name="locality" maxlength="64" v-model="createCertForm.locality" placeholder="例如：Taipei City" />
          </div>
          <div class="field">
            <label>聯絡 Email（選填）</label>
            <input name="email" type="email" maxlength="80" v-model="createCertForm.email" placeholder="admin@example.com" />
          </div>
          <div class="field">
            <label>有效年數 *</label>
            <input name="validYears" type="number" required min="1" max="30" v-model.number="createCertForm.validYears" />
          </div>
          <div class="field">
            <label>憑證密碼 *</label>
            <input
              name="passphrase"
              type="password"
              required
              minlength="4"
              autocomplete="new-password"
              v-model="createCertForm.passphrase"
              placeholder="至少 4 字元（請妥善保管）"
            />
          </div>
          <div class="field">
            <label>確認憑證密碼 *</label>
            <input
              name="passphraseConfirm"
              type="password"
              required
              minlength="4"
              autocomplete="new-password"
              v-model="createCertForm.passphraseConfirm"
              placeholder="再輸入一次"
            />
          </div>
          <div class="field">
            <label>簽署者顯示名稱（選填）</label>
            <input
              name="signerName"
              maxlength="80"
              v-model="createCertForm.signerName"
              placeholder="預設＝通用名稱 CN"
            />
          </div>
          <div class="field">
            <label>簽署原因（選填）</label>
            <input name="reason" maxlength="200" v-model="createCertForm.reason" />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="enableAfterCreate" v-model="createCertForm.enableAfterCreate" />
              <span>製作完成後<strong>自動啟用</strong> PDF 數位簽章</span>
            </label>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="check-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="onlyApproved" v-model="createCertForm.onlyApproved" />
              <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
            </label>
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button type="submit" class="btn primary" id="btn-pdf-sign-create" :disabled="creatingCert">
              {{ creatingCert ? '製作中…' : '製作並儲存憑證' }}
            </button>
          </div>
        </form>
        <p class="muted" style="font-size:0.78rem;margin:10px 0 0;line-height:1.45">
          注意：若已有憑證，製作新憑證會<strong>覆蓋</strong>現有 .p12。自簽憑證在 Acrobat 可能顯示「簽發者不被信任」，內部防竄改仍有效。
        </p>
      </div>

      <form id="pdf-sign-form" class="form-grid" @submit.prevent="onSavePdfSign">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignEnabled" id="pdf-sign-enabled" v-model="pdfSign.enabled" />
            <span><strong>啟用 PDF 數位簽章</strong></span>
          </label>
        </div>
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="pdfSignOnlyApproved" id="pdf-sign-only-approved" v-model="pdfSign.onlyApproved" />
            <span>僅對<strong>已核准</strong>單據加簽（建議勾選）</span>
          </label>
        </div>
        <div class="field">
          <label>或上傳既有公司憑證（.p12 / .pfx）</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
            <label class="btn outline sm" style="cursor:pointer;margin:0;display:inline-flex">
              上傳憑證
              <input type="file" id="pdf-sign-cert-file" accept=".p12,.pfx,application/x-pkcs12" class="hidden" @change="onUploadCert" />
            </label>
            <button
              type="button"
              class="btn sm outline"
              id="btn-pdf-sign-cert-clear"
              :disabled="!pdfSign.hasCert"
              @click="onClearCert"
            >
              移除憑證
            </button>
          </div>
          <span class="muted" style="font-size:0.78rem;display:block;margin-top:6px">
            若已由 IT 核發正式 PKCS#12，可直接上傳；私鑰勿外流。
          </span>
        </div>
        <div class="field">
          <label>憑證密碼</label>
          <input
            name="pdfSignPass"
            type="password"
            v-model="pdfSignPass"
            autocomplete="new-password"
            :placeholder="pdfSign.hasPass ? '已設定（留空則不變更）' : 'PKCS#12 密碼（可為空）'"
          />
        </div>
        <div class="field">
          <label>簽署者顯示名稱</label>
          <input
            name="pdfSignSignerName"
            maxlength="80"
            v-model="pdfSign.signerName"
            placeholder="預設＝公司名稱"
          />
        </div>
        <div class="field">
          <label>簽署原因</label>
          <input name="pdfSignReason" maxlength="200" v-model="pdfSign.reason" />
        </div>
        <div class="field">
          <label>地點</label>
          <input name="pdfSignLocation" maxlength="80" v-model="pdfSign.location" />
        </div>
        <div class="field">
          <label>聯絡資訊（選填）</label>
          <input
            name="pdfSignContact"
            maxlength="120"
            v-model="pdfSign.contactInfo"
            placeholder="例如公司 Email"
          />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存簽章設定</button>
          <button type="button" class="btn outline" id="btn-pdf-sign-test" @click="onTestPdfSign">下載測試簽章 PDF</button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        驗章方式：以 Adobe Acrobat 開啟 PDF → 簽名面板應顯示簽章資訊。
      </p>
    </div>

    <div class="card">
      <h3>備份加密（AES-256）</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        啟用後，<strong>備份資料</strong>一律以 <strong>AES-256 加密 ZIP</strong> 儲存（含僅 PDF、無附件的單據）。
        解壓時請使用支援 AES-256 的工具（如 7-Zip、WinZip、Bandizip）。
        Windows 檔案總管可能無法直接開啟 AES ZIP。
      </p>
      <p class="muted" style="margin:0 0 12px;font-size:0.9rem">
        狀態：<strong :style="{ color: backupEncrypt.ready ? '#15803d' : backupEncrypt.enabled ? '#b45309' : 'inherit' }">{{ backupEncryptStatusText }}</strong>
      </p>
      <form id="backup-encrypt-form" class="form-grid" @submit.prevent="onSaveBackupEncrypt">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="backupEncryptEnabled" id="backup-encrypt-enabled" v-model="backupEncrypt.enabled" />
            <span><strong>啟用備份 ZIP 加密</strong></span>
          </label>
        </div>
        <div class="field">
          <label>備份密碼</label>
          <input
            name="backupEncryptPass"
            type="password"
            v-model="backupEncryptPass"
            autocomplete="new-password"
            :placeholder="backupEncrypt.hasPass ? '已設定（留空則不變更）' : '設定加密密碼（請妥善保存）'"
          />
        </div>
        <div class="field">
          <label>確認密碼</label>
          <input
            name="backupEncryptPassConfirm"
            type="password"
            v-model="backupEncryptPassConfirm"
            autocomplete="new-password"
            placeholder="再次輸入新密碼（僅在變更時）"
          />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存備份加密設定</button>
          <button
            type="button"
            class="btn outline"
            id="btn-backup-encrypt-clear-pass"
            :disabled="!backupEncrypt.hasPass"
            @click="onClearBackupPass"
          >
            清除密碼
          </button>
        </div>
      </form>
      <p class="muted" style="font-size:0.8rem;margin:12px 0 0;line-height:1.5">
        密碼僅存於伺服器端，介面不會顯示。若遺失密碼，已加密的舊備份將無法解壓。<br />
        變更密碼後，請勾選「強制覆寫」重新備份，既有檔案不會自動重加密。
      </p>
    </div>

    <div class="card">
      <h3>Email 設定（SMTP）</h3>
      <p class="muted" style="margin-top:0">設定 SMTP 後，申請人可收到進度通知，並可對簽核人寄送催辦信。</p>
      <form id="mail-form" class="form-grid" @submit.prevent="onSaveMail">
        <div class="field check-row-box">
          <label class="check-row">
            <input type="checkbox" name="enabled" id="mail-enabled" v-model="mailCfg.enabled" />
            <span><strong>啟用 Email 提醒</strong>
              <span class="muted" style="margin-left:8px;font-size:0.85rem">{{ mailCfg.ready ? 'SMTP 已就緒' : '尚未完成 SMTP 設定' }}</span>
            </span>
          </label>
        </div>
        <div class="field">
          <label>SMTP 主機</label>
          <input name="host" v-model="mailCfg.host" placeholder="例如 smtp.gmail.com 或 mail.公司網域" />
        </div>
        <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label>連接埠</label>
            <input name="port" type="number" id="mail-port" v-model.number="mailCfg.port" @change="onMailPortChange" />
          </div>
          <div class="check-row-stack">
            <label class="check-row">
              <input type="checkbox" name="secure" id="mail-secure" v-model="mailCfg.secure" />
              <span>SSL（埠 465）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="ignoreTLS" id="mail-ignore-tls" v-model="mailCfg.ignoreTLS" />
              <span>略過 TLS（埠 25 明文請勾選）</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="requireTLS" id="mail-require-tls" v-model="mailCfg.requireTLS" />
              <span>要求 STARTTLS（埠 587）</span>
            </label>
          </div>
        </div>
        <p class="muted" style="font-size:0.82rem;margin:0 0 8px;line-height:1.45">
          常見設定：<strong>587</strong>＋STARTTLS（不勾 SSL）；<strong>465</strong>＋SSL；
          內網 <strong>25</strong>＋略過 TLS。
        </p>
        <div class="field">
          <label>SMTP 帳號</label>
          <input name="user" v-model="mailCfg.user" placeholder="完整信箱" autocomplete="off" />
        </div>
        <div class="field">
          <label>SMTP 密碼</label>
          <input
            name="pass"
            type="password"
            v-model="mailPass"
            :placeholder="mailCfg.hasPass ? '已設定（留空則不變更）' : '尚未設定'"
            autocomplete="new-password"
          />
        </div>
        <div class="field">
          <label>寄件者 Email</label>
          <input name="from" type="email" v-model="mailCfg.from" placeholder="顯示的寄件信箱" />
        </div>
        <div class="field">
          <label>寄件者名稱</label>
          <input name="fromName" v-model="mailCfg.fromName" />
        </div>
        <div class="field">
          <label>系統網址（信內連結）</label>
          <input name="baseUrl" v-model="mailCfg.baseUrl" placeholder="http://公司IP:端口" />
        </div>
        <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">儲存 Email 設定</button>
          <button type="button" class="btn outline" id="btn-mail-test" @click="onTestMail">寄送測試信</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3>系統設定完整包</h3>
      <p class="muted" style="margin-top:0;line-height:1.55">
        一次匯出／匯入：部門、成員、簽核流程與申請表、Email 設定。
      </p>
      <div class="check-group-box" style="margin-bottom:12px;background:#f8fafc">
        <strong class="check-group-title">匯出</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-history" v-model="pkgExportHistory" />
          <span>包含歷史申請單、簽核歷程與附件</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-export-mail-pass" v-model="pkgExportMailPass" />
          <span>包含 SMTP 密碼</span>
        </label>
        <button type="button" class="btn primary" id="btn-pkg-export" style="margin-top:4px" @click="onPkgExport">
          下載設定完整包（JSON）
        </button>
      </div>
      <div class="check-group-box" style="background:#fff">
        <strong class="check-group-title">匯入</strong>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-mail" v-model="pkgImportMail" />
          <span>套用 Email／SMTP 設定</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="pkg-import-history" v-model="pkgImportHistory" />
          <span>匯入歷史申請</span>
        </label>
        <button type="button" class="btn outline" id="btn-pkg-import" style="margin-top:4px" @click="triggerPkgImport">
          選擇 JSON 並匯入…
        </button>
        <input
          type="file"
          id="pkg-import-file"
          ref="pkgImportFileInput"
          accept=".json,application/json"
          class="hidden"
          @change="onPkgImportFileChange"
        />
        <div id="pkg-import-result" class="muted" style="margin-top:10px;font-size:0.9rem;white-space:pre-wrap">{{ pkgImportResult }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { L } from '@/native/bridge';

const isBuiltinAdmin = computed(() => {
  if (typeof L.isBuiltinAdmin === 'function') return L.isBuiltinAdmin();
  return String(L.state?.user?.username || '').toLowerCase() === 'admin';
});

const emptyAnn = () => ({
  slot: 0,
  enabled: false,
  active: false,
  title: '',
  body: '',
  hasFile: false,
  originalName: null,
  startAt: null,
  endAt: null,
  startAtLocal: '',
  endAtLocal: '',
  withinPeriod: true,
  scheduleStatus: 'open',
  updatedAt: null,
});

const brand = ref({});
const brandForm = reactive({ companyName: '' });
const pdfSign = ref({
  enabled: false,
  hasCert: false,
  hasPass: false,
  onlyApproved: true,
  ready: false,
  reason: '線上簽核系統正式產出文件',
  location: 'Taiwan',
  contactInfo: '',
  signerName: '',
  libsReady: true,
  certFileName: '',
});
const pdfSignPass = ref('');

const backupEncrypt = ref({
  enabled: false,
  hasPass: false,
  ready: false,
});
const backupEncryptPass = ref('');
const backupEncryptPassConfirm = ref('');

const mailCfg = ref({
  enabled: false,
  ready: false,
  host: '',
  port: 587,
  secure: false,
  ignoreTLS: false,
  requireTLS: true,
  user: '',
  from: '',
  fromName: '',
  baseUrl: 'http://127.0.0.1:8080',
});
const mailPass = ref('');

const announcementsAdmin = ref([emptyAnn(), { ...emptyAnn(), slot: 1 }]);
const deployLogHtml = ref('<p class="muted" style="margin:0">載入自動部署紀錄中…</p>');
const deployCardHtml = computed(() => `<h3>自動部署修改紀錄</h3>${deployLogHtml.value}`);

function toDatetimeLocal(iso) {
  if (typeof L.toDatetimeLocalValue === 'function') return L.toDatetimeLocalValue(iso);
  if (!iso) return '';
  return String(iso).replace(' ', 'T').slice(0, 16);
}

function formatAnnouncementStatus(a) {
  if (typeof L.formatAnnouncementStatus === 'function') return L.formatAnnouncementStatus(a);
  if (!a) return '未設定';
  if (!a.enabled) return '未啟用';
  if (a.active) return '公布中，顯示於總覽';
  return '已啟用';
}

function formatTaiwanDateTime(iso) {
  if (typeof L.formatTaiwanDateTime === 'function') return L.formatTaiwanDateTime(iso);
  return String(iso || '');
}

async function loadData() {
  if (!isBuiltinAdmin.value) return;
  try {
    const adminCfg = await L.api('/api/system/settings/admin');
    brand.value = adminCfg;
    if (L.state) L.state.systemSettings = adminCfg;
    brandForm.companyName = adminCfg.companyName || '線上簽核系統';
    pdfSign.value = { ...pdfSign.value, ...(adminCfg.pdfSign || {}) };
    backupEncrypt.value = { ...backupEncrypt.value, ...(adminCfg.backupEncrypt || {}) };

    if (Array.isArray(adminCfg.announcements) && adminCfg.announcements.length) {
      announcementsAdmin.value = [0, 1].map((i) => {
        const item = adminCfg.announcements[i] || {};
        return {
          ...emptyAnn(),
          slot: i,
          ...item,
          startAtLocal: toDatetimeLocal(item.startAt),
          endAtLocal: toDatetimeLocal(item.endAt),
        };
      });
    } else if (adminCfg.announcement) {
      announcementsAdmin.value[0] = {
        ...emptyAnn(),
        ...adminCfg.announcement,
        slot: 0,
        startAtLocal: toDatetimeLocal(adminCfg.announcement.startAt),
        endAtLocal: toDatetimeLocal(adminCfg.announcement.endAt),
      };
    }
  } catch {
    try {
      const b = await L.api('/api/system/settings');
      brand.value = b;
      brandForm.companyName = b.companyName || '線上簽核系統';
      if (L.state) L.state.systemSettings = b;
    } catch {
      /* ignore */
    }
  }

  try {
    const m = await L.api('/api/mail/config');
    mailCfg.value = { ...mailCfg.value, ...m };
    if (!mailCfg.value.fromName) mailCfg.value.fromName = brandForm.companyName || '線上簽核系統';
  } catch {
    mailCfg.value = { enabled: false, ready: false };
  }

  // Deploy logs
  try {
    const logData = await L.api('/api/system/deploy-log?limit=15');
    const entries = logData.entries || [];
    if (!entries.length) {
      deployLogHtml.value = '<p class="muted" style="margin:0">尚無部署紀錄（下次有程式變更並重啟後會自動寫入）。</p>';
    } else {
      deployLogHtml.value = `
        <p class="muted" style="margin:0 0 10px;font-size:0.85rem;line-height:1.45">
          伺服器每次啟動會比對程式指紋；有變更時寫入
          <code>data/修改紀錄-自動.md</code> 與 <code>data/deploy-history.json</code>。
          純重啟（檔案未改）不重複記一筆。
        </p>
        <div style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:10px">
          <table class="data" style="margin:0;font-size:0.85rem">
            <thead>
              <tr>
                <th>時間</th><th>版本</th><th>類型</th><th>變更檔</th>
              </tr>
            </thead>
            <tbody>
              ${entries
                .map((e) => {
                  const ch = e.changes || {};
                  const cnt = `改${ch.modifiedCount || 0}/新${ch.addedCount || 0}/刪${ch.removedCount || 0}`;
                  const files = [
                    ...(ch.modified || []).slice(0, 3),
                    ...(ch.added || []).slice(0, 2),
                  ]
                    .map((f) => f.replace(/^server\//, 's/').replace(/^public\//, 'p/'))
                    .join(', ');
                  const tip = [
                    ...(ch.modified || []).map((f) => `改 ${f}`),
                    ...(ch.added || []).map((f) => `新 ${f}`),
                    ...(ch.removed || []).map((f) => `刪 ${f}`),
                  ]
                    .slice(0, 20)
                    .join('\n');
                  return `<tr title="${L.esc(tip)}">
                    <td style="white-space:nowrap">${L.esc(e.atLocal || e.at || '')}</td>
                    <td><code>${L.esc(e.label || '')}</code></td>
                    <td>${L.esc(e.typeLabel || e.type || '')}</td>
                    <td>${L.esc(cnt)}${files ? `<div class="muted" style="font-size:0.78rem">${L.esc(files)}</div>` : ''}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`;
    }
  } catch {
    deployLogHtml.value = '<p class="muted" style="margin:0">無法載入部署紀錄（需內建 Admin）。</p>';
  }
}

const logoUrl = computed(() => brand.value.logoUrl || '/img/argo-logo.png');

const verLabel = computed(() => brand.value.versionLabel || (brand.value.version ? `v${brand.value.version}` : '—'));
const verFull = computed(() => brand.value.versionLabelFull || (brand.value.fullVersion ? `v${brand.value.fullVersion}` : verLabel.value));
const verBanner = computed(() => brand.value.versionBanner || `線上簽核系統 ${verLabel.value}`);
const builtAt = computed(() => (brand.value.versionBuiltAt ? formatTaiwanDateTime(brand.value.versionBuiltAt) : '—'));

const versionInfoHtml = computed(() => {
  return `
        完整版號：<strong style="color:#1e3a5f">${L.esc(verFull.value)}</strong><br/>
        建置指紋：<code>${L.esc(brand.value.versionBuild || '—')}</code>
        　·　原始檔時間：${L.esc(builtAt.value)}<br/>
        ${L.esc(verBanner.value)}<br/>
        <span style="color:#0369a1">主版號來自 package.json；掃描 server／public 產生指紋，
        <strong>修改並重新部署／重啟後會自動變更</strong>，並寫入部署修改紀錄。</span>
      `;
});

const signStatusText = computed(() => {
  if (pdfSign.value.ready) return '已就緒（下載／備份 PDF 將加蓋公司數位簽章）';
  if (!pdfSign.value.libsReady) return `套件未就緒${pdfSign.value.libsError ? '：' + pdfSign.value.libsError : ''}`;
  if (!pdfSign.value.hasCert) return '尚未上傳憑證';
  if (!pdfSign.value.enabled) return '已上傳憑證，尚未啟用';
  return '尚未就緒';
});

const backupEncryptStatusText = computed(() => {
  if (backupEncrypt.value.ready) return '已就緒（備份將以 AES-256 加密 ZIP 儲存）';
  if (backupEncrypt.value.enabled && !backupEncrypt.value.hasPass) return '已啟用但尚未設定密碼（無法執行備份）';
  if (!backupEncrypt.value.enabled) return '未啟用（備份為一般 PDF／ZIP）';
  return '尚未就緒';
});

// 公司品牌
async function onSaveBrand() {
  try {
    const data = await L.api('/api/system/settings', {
      method: 'PUT',
      body: { companyName: brandForm.companyName },
    });
    brand.value = data.settings || data;
    if (L.state) L.state.systemSettings = brand.value;
    if (typeof L.applySystemBranding === 'function') L.applySystemBranding(brand.value);
    L.toast('公司名稱已儲存', 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onLogoChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('logo', file);
  try {
    const data = await L.api('/api/system/logo', { method: 'POST', body: fd });
    brand.value = data.settings || data;
    if (L.state) L.state.systemSettings = brand.value;
    if (typeof L.applySystemBranding === 'function') L.applySystemBranding(brand.value);
    L.toast('Logo 已更新', 'success');
  } catch (err) {
    L.toast(err.message || '上傳失敗', 'error');
  }
}

async function onResetLogo() {
  if (!confirm('確定還原為預設 Logo？')) return;
  try {
    const data = await L.api('/api/system/logo', { method: 'DELETE' });
    brand.value = data.settings || data;
    if (L.state) L.state.systemSettings = brand.value;
    if (typeof L.applySystemBranding === 'function') L.applySystemBranding(brand.value);
    L.toast('已還原預設 Logo', 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

// 公告
async function onSaveAnnouncement(slot) {
  const a = announcementsAdmin.value[slot];
  if (a.startAtLocal && a.endAtLocal && new Date(a.startAtLocal) > new Date(a.endAtLocal)) {
    L.toast('公布開始時間不可晚於結束時間', 'error');
    return;
  }
  try {
    const data = await L.api('/api/system/announcement', {
      method: 'PUT',
      body: {
        slot,
        enabled: Boolean(a.enabled),
        title: String(a.title || '').trim(),
        body: String(a.body || ''),
        startAt: a.startAtLocal || null,
        endAt: a.endAtLocal || null,
      },
    });
    if (L.state) L.state.systemSettings = data.settings || L.state.systemSettings;
    L.toast(`公告 ${slot + 1} 已儲存`, 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '儲存失敗', 'error');
  }
}

async function onUploadAnnFile(slot, e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('slot', String(slot));
  try {
    await L.api('/api/system/announcement/file', { method: 'POST', body: fd });
    L.toast(`公告 ${slot + 1} 附件已上傳`, 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '上傳失敗', 'error');
  }
}

async function onClearAnnFile(slot) {
  if (!confirm(`確定移除公告 ${slot + 1} 的附件？`)) return;
  try {
    await L.api(`/api/system/announcement/file?slot=${slot}`, { method: 'DELETE' });
    L.toast('已移除附件', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '移除失敗', 'error');
  }
}

function onPreviewAnnouncement(slot) {
  const a = announcementsAdmin.value[slot];
  const snap = {
    ...a,
    slot,
    active: true,
    _forcePreview: true,
  };
  if (!snap.title && !snap.body && !snap.hasFile) {
    L.toast('請先填寫公告或上傳附件', 'error');
    return;
  }
  if (typeof L.openAnnouncementModal === 'function') {
    L.openAnnouncementModal(snap);
  }
}

// 自簽憑證
const createCertForm = reactive({
  commonName: '',
  organization: '',
  organizationalUnit: '',
  country: 'TW',
  province: '',
  locality: '',
  email: '',
  validYears: 5,
  passphrase: '',
  passphraseConfirm: '',
  signerName: '',
  reason: '線上簽核系統正式產出文件',
  enableAfterCreate: true,
  onlyApproved: true,
});
const creatingCert = ref(false);

async function onCreatePdfCert() {
  if (!String(createCertForm.commonName || '').trim()) {
    L.toast('請填寫通用名稱（CN）', 'error');
    return;
  }
  if (!String(createCertForm.organization || '').trim()) {
    L.toast('請填寫組織／公司名稱（O）', 'error');
    return;
  }
  if (!String(createCertForm.country || '').trim()) {
    L.toast('請填寫國家代碼（C）', 'error');
    return;
  }
  if (createCertForm.passphrase.length < 4) {
    L.toast('憑證密碼至少 4 個字元', 'error');
    return;
  }
  if (createCertForm.passphrase !== createCertForm.passphraseConfirm) {
    L.toast('兩次輸入的憑證密碼不一致', 'error');
    return;
  }
  if (pdfSign.value.hasCert && !confirm('已有公司憑證，確定以新製作的憑證覆蓋？')) {
    return;
  }
  creatingCert.value = true;
  try {
    const data = await L.api('/api/system/pdf-sign/create', {
      method: 'POST',
      body: {
        commonName: String(createCertForm.commonName || '').trim(),
        organization: String(createCertForm.organization || '').trim(),
        organizationalUnit: String(createCertForm.organizationalUnit || '').trim(),
        country: String(createCertForm.country || 'TW').trim(),
        province: String(createCertForm.province || '').trim(),
        locality: String(createCertForm.locality || '').trim(),
        email: String(createCertForm.email || '').trim(),
        validYears: Number(createCertForm.validYears || 5),
        passphrase: createCertForm.passphrase,
        passphraseConfirm: createCertForm.passphraseConfirm,
        signerName: String(createCertForm.signerName || '').trim(),
        reason: String(createCertForm.reason || '').trim(),
        enableAfterCreate: Boolean(createCertForm.enableAfterCreate),
        onlyApproved: Boolean(createCertForm.onlyApproved),
      },
    });
    const until = data.meta?.notAfter ? String(data.meta.notAfter).slice(0, 10) : '';
    L.toast(
      until ? `已製作憑證（有效至 ${until}），可下載測試 PDF 驗證` : '已製作並儲存自簽憑證',
      'success'
    );
    await loadData();
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '製作失敗';
    L.toast(msg.length > 120 ? msg.slice(0, 120) + '…' : msg, 'error');
  } finally {
    creatingCert.value = false;
  }
}

async function onSavePdfSign() {
  try {
    await L.api('/api/system/settings', {
      method: 'PUT',
      body: {
        pdfSignEnabled: Boolean(pdfSign.value.enabled),
        pdfSignOnlyApproved: Boolean(pdfSign.value.onlyApproved),
        pdfSignReason: pdfSign.value.reason || '',
        pdfSignLocation: pdfSign.value.location || '',
        pdfSignContact: pdfSign.value.contactInfo || '',
        pdfSignSignerName: pdfSign.value.signerName || '',
        pdfSignPass: pdfSignPass.value || '',
      },
    });
    L.toast('PDF 簽章設定已儲存', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '儲存失敗', 'error');
  }
}

async function onUploadCert(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('cert', file);
  if (pdfSignPass.value) fd.append('passphrase', pdfSignPass.value);
  try {
    await L.api('/api/system/pdf-sign/cert', { method: 'POST', body: fd });
    L.toast('憑證已上傳', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '憑證上傳失敗', 'error');
  }
}

async function onClearCert() {
  if (!confirm('確定移除公司簽章憑證？')) return;
  try {
    await L.api('/api/system/pdf-sign/cert', { method: 'DELETE' });
    L.toast('已移除憑證', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '移除失敗', 'error');
  }
}

async function onTestPdfSign() {
  try {
    const blob = await L.api('/api/system/pdf-sign/test', {
      method: 'POST',
      body: {},
      expectBlob: true,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '簽章測試.pdf';
    a.click();
    URL.revokeObjectURL(url);
    L.toast('已下載測試 PDF，請用 Acrobat 檢查簽章', 'success');
  } catch (err) {
    L.toast(err.message || '測試失敗', 'error');
  }
}

// 備份加密
async function onSaveBackupEncrypt() {
  if (backupEncryptPass.value || backupEncryptPassConfirm.value) {
    if (backupEncryptPass.value !== backupEncryptPassConfirm.value) {
      L.toast('兩次輸入的備份密碼不一致', 'error');
      return;
    }
    if (backupEncryptPass.value.length < 4) {
      L.toast('備份密碼至少 4 個字元', 'error');
      return;
    }
  }
  if (backupEncrypt.value.enabled && !backupEncrypt.value.hasPass && !backupEncryptPass.value) {
    L.toast('啟用加密時請設定備份密碼', 'error');
    return;
  }
  try {
    await L.api('/api/system/settings', {
      method: 'PUT',
      body: {
        backupEncryptEnabled: Boolean(backupEncrypt.value.enabled),
        backupEncryptPass: backupEncryptPass.value || '',
      },
    });
    L.toast('備份加密設定已儲存', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '儲存失敗', 'error');
  }
}

async function onClearBackupPass() {
  if (!confirm('確定清除備份密碼？\n若仍啟用加密，將無法執行新備份；已加密的舊檔仍需原密碼才能解壓。')) {
    return;
  }
  try {
    await L.api('/api/system/settings', {
      method: 'PUT',
      body: {
        backupEncryptPassClear: true,
        backupEncryptEnabled: false,
      },
    });
    L.toast('已清除備份密碼並關閉加密', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message || '清除失敗', 'error');
  }
}

// Email
function onMailPortChange() {
  const p = Number(mailCfg.value.port) || 587;
  if (p === 465) mailCfg.value.secure = true;
  if (p === 25) {
    mailCfg.value.secure = false;
    mailCfg.value.ignoreTLS = true;
    mailCfg.value.requireTLS = false;
  }
  if (p === 587) {
    mailCfg.value.secure = false;
    mailCfg.value.ignoreTLS = false;
    mailCfg.value.requireTLS = true;
  }
}

async function onSaveMail() {
  try {
    await L.api('/api/mail/config', {
      method: 'PUT',
      body: {
        enabled: Boolean(mailCfg.value.enabled),
        host: mailCfg.value.host || '',
        port: Number(mailCfg.value.port) || 587,
        secure: Boolean(mailCfg.value.secure),
        ignoreTLS: Boolean(mailCfg.value.ignoreTLS),
        requireTLS: Boolean(mailCfg.value.requireTLS),
        user: mailCfg.value.user || '',
        pass: mailPass.value || '',
        from: mailCfg.value.from || '',
        fromName: mailCfg.value.fromName || brandForm.companyName || '線上簽核系統',
        baseUrl: mailCfg.value.baseUrl || 'http://127.0.0.1:8080',
      },
    });
    L.toast('Email 設定已儲存', 'success');
    await loadData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onTestMail() {
  try {
    const data = await L.api('/api/mail/test', { method: 'POST', body: {} });
    const mode = data.result?.mode === 'outbox' ? '（僅寫入 outbox，未真正寄出）' : '';
    L.toast(`測試信已寄出${mode}`, 'success');
  } catch (err) {
    L.toast(err.message || '測試信寄送失敗', 'error');
  }
}

// Package
const pkgExportHistory = ref(false);
const pkgExportMailPass = ref(true);
const pkgImportMail = ref(true);
const pkgImportHistory = ref(false);
const pkgImportFileInput = ref(null);
const pkgImportResult = ref('');

async function onPkgExport() {
  const history = pkgExportHistory.value ? '1' : '0';
  const mailSecrets = pkgExportMailPass.value ? '1' : '0';
  try {
    const blob = await L.api(
      `/api/system/package/export?includeHistory=${history}&includeMailSecrets=${mailSecrets}`,
      { expectBlob: true }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `簽核系統_${history === '1' ? '完整含歷史' : '設定'}包_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    L.toast('設定完整包已下載', 'success');
  } catch (err) {
    L.toast(err.message || '匯出失敗', 'error');
  }
}

function triggerPkgImport() {
  pkgImportFileInput.value?.click();
}

async function onPkgImportFileChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const impMail = pkgImportMail.value;
  const impHist = pkgImportHistory.value;
  if (
    !confirm(
      `確定匯入「${file.name}」？\n將合併更新部門、成員、流程` +
        (impMail ? '、Email' : '') +
        (impHist ? '，並匯入歷史' : '')
    )
  ) {
    return;
  }
  const fd = new FormData();
  fd.append('package', file);
  fd.append('importMail', impMail ? '1' : '0');
  fd.append('importHistory', impHist ? '1' : '0');
  pkgImportResult.value = '匯入中…';
  try {
    const data = await L.api('/api/system/package/import', { method: 'POST', body: fd });
    L.toast(data.message || '匯入完成', 'success');
    pkgImportResult.value = JSON.stringify(data.result || data, null, 2);
    await loadData();
  } catch (err) {
    L.toast(err.message || '匯入失敗', 'error');
    pkgImportResult.value = err.message || '匯入失敗';
  }
}

await loadData();
</script>
