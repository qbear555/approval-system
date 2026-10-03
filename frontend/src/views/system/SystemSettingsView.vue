<template>
  <div class="settings-page">
    <div v-if="loading" class="card text-center p-4">載入系統設定中...</div>

    <form v-else @submit.prevent="saveSettings" class="settings-form">
      <!-- 1. 基本資訊與公司名稱 -->
      <div class="card section-card">
        <h3 class="section-title">基本資訊與品牌</h3>
        <p class="section-desc">設定系統顯示的公司全銜，此名稱將用於頂部品牌列與 PDF 結案匯出抬頭。</p>

        <div class="form-group">
          <label>公司全銜名稱</label>
          <input v-model="form.companyName" type="text" class="form-control" required />
        </div>

        <div class="form-group">
          <label>公司 Logo 圖檔</label>
          <div class="logo-preview-box">
            <div class="logo-preview">
              <img :src="systemStore.logoUrl" alt="Current Logo" class="preview-img" />
            </div>
            <div class="logo-actions">
              <label class="btn outline sm">
                更換 Logo
                <input type="file" accept="image/*" class="hidden-input" @change="handleLogoUpload" />
              </label>
              <button v-if="hasCustomLogo" type="button" class="btn danger sm" @click="handleClearLogo">
                恢復預設 Logo
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. PDF 數位簽署憑證設定 -->
      <div class="card section-card">
        <h3 class="section-title">PDF 數位簽章與保全</h3>
        <p class="section-desc">簽核結案匯出 PDF 時，以 X.509 PKCS#12 憑證施加電子簽章防竄改。</p>

        <div class="form-group checkbox-group">
          <label class="check-label">
            <input v-model="form.pdfSignEnabled" type="checkbox" />
            <span><strong>啟用 PDF 數位簽章</strong></span>
          </label>
        </div>

        <div v-if="form.pdfSignEnabled" class="sub-form">
          <div class="form-group">
            <label>憑證檔案狀態</label>
            <div class="cert-status">
              <span :class="['badge', certReady ? 'success' : 'warning']">
                {{ certReady ? '憑證已就緒 (' + certFile + ')' : '尚未上傳憑證檔 (.p12)' }}
              </span>
            </div>
          </div>

          <div class="form-group">
            <label>簽署單位 / 簽署人名稱</label>
            <input v-model="form.pdfSignSignerName" type="text" class="form-control" placeholder="如：雅士博科技股份有限公司" />
          </div>

          <div class="form-row">
            <div class="form-group col">
              <label>簽署原因 / 依據</label>
              <input v-model="form.pdfSignReason" type="text" class="form-control" />
            </div>
            <div class="form-group col">
              <label>簽署地點 / 區域</label>
              <input v-model="form.pdfSignLocation" type="text" class="form-control" />
            </div>
          </div>

          <div class="form-group">
            <label>聯絡信箱</label>
            <input v-model="form.pdfSignContact" type="email" class="form-control" />
          </div>
        </div>
      </div>

      <!-- 3. 資料庫備份加密設定 -->
      <div class="card section-card">
        <h3 class="section-title">備份檔案 AES-256 加密</h3>
        <p class="section-desc">自動或手動匯出資料庫備份 ZIP 檔時，是否施加 AES 密碼加密保護。</p>

        <div class="form-group checkbox-group">
          <label class="check-label">
            <input v-model="form.backupEncryptEnabled" type="checkbox" />
            <span><strong>啟用備份 ZIP 加密</strong></span>
          </label>
        </div>

        <div v-if="form.backupEncryptEnabled" class="form-group">
          <label>備份加密密碼</label>
          <input v-model="form.backupEncryptPass" type="password" class="form-control" placeholder="留空則保持原密碼不變" />
        </div>
      </div>

      <!-- 儲存按鈕 -->
      <div class="submit-bar">
        <button type="submit" class="btn primary" :disabled="saving">
          {{ saving ? '儲存中...' : '儲存系統設定' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { apiRequest } from '@/api/client';
import { useSystemStore } from '@/stores/system';
import { useToastStore } from '@/stores/toast';

const systemStore = useSystemStore();
const toast = useToastStore();

const loading = ref(true);
const saving = ref(false);
const hasCustomLogo = ref(false);
const certReady = ref(false);
const certFile = ref('');

const form = ref({
  companyName: '',
  pdfSignEnabled: false,
  pdfSignSignerName: '',
  pdfSignReason: '',
  pdfSignLocation: '',
  pdfSignContact: '',
  backupEncryptEnabled: false,
  backupEncryptPass: '',
});

onMounted(async () => {
  await loadSettings();
});

async function loadSettings() {
  loading.value = true;
  try {
    const res = await apiRequest('/api/system/settings/admin');
    if (res) {
      form.value.companyName = res.companyName || '';
      form.value.pdfSignEnabled = !!res.pdfSignEnabled;
      form.value.pdfSignSignerName = res.pdfSignSignerName || '';
      form.value.pdfSignReason = res.pdfSignReason || '線上簽核系統正式產出文件';
      form.value.pdfSignLocation = res.pdfSignLocation || 'Taiwan';
      form.value.pdfSignContact = res.pdfSignContact || '';
      form.value.backupEncryptEnabled = !!res.backupEncryptEnabled;

      hasCustomLogo.value = !!res.logoFile;
      certReady.value = !!(res.pdfSign && res.pdfSign.configured);
      certFile.value = res.pdfSignFile || '';
    }
  } catch (err) {
    toast.error('載入設定失敗: ' + err.message);
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  try {
    const payload = { ...form.value };
    if (!payload.backupEncryptPass) {
      delete payload.backupEncryptPass;
    }
    await apiRequest('/api/system/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    toast.success('系統設定已成功儲存！');
    systemStore.fetchPublicSettings();
    await loadSettings();
  } catch (err) {
    toast.error('儲存失敗: ' + err.message);
  } finally {
    saving.value = false;
  }
}

async function handleLogoUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('logo', file);

  try {
    await apiRequest('/api/system/logo', {
      method: 'POST',
      body: fd,
    });
    toast.success('Logo 已成功上傳更新');
    systemStore.fetchPublicSettings();
    await loadSettings();
  } catch (err) {
    toast.error('Logo 上傳失敗: ' + err.message);
  }
}

async function handleClearLogo() {
  if (!confirm('確定要清除自訂 Logo 並恢復預設嗎？')) return;
  try {
    await apiRequest('/api/system/logo', { method: 'DELETE' });
    toast.success('已恢復預設 Logo');
    systemStore.fetchPublicSettings();
    await loadSettings();
  } catch (err) {
    toast.error('清除失敗: ' + err.message);
  }
}
</script>

<style scoped>
.settings-page {
  max-width: 800px;
  margin: 0 auto;
}

.section-card {
  margin-bottom: 24px;
  padding: 24px;
}

.section-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 4px;
  color: var(--text-main);
}

.section-desc {
  font-size: 0.88rem;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 18px;
}

.form-group label {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 6px;
}

.form-control {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
  outline: none;
  background: #ffffff;
}
.form-control:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.form-row {
  display: flex;
  gap: 16px;
}
.form-row .col {
  flex: 1;
}

.checkbox-group {
  margin-bottom: 12px;
}
.check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.95rem;
}

.sub-form {
  margin-top: 14px;
  padding: 16px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px dashed var(--border);
}

.logo-preview-box {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px;
  background: #f8fafc;
  border-radius: 6px;
}

.preview-img {
  height: 48px;
  max-width: 160px;
  object-fit: contain;
}

.logo-actions {
  display: flex;
  gap: 10px;
}

.hidden-input {
  display: none;
}

.submit-bar {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}
</style>
