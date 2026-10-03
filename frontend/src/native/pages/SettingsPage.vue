<template>
  <div class="card" style="max-width:560px">
    <h3>我的資料</h3>
    <p class="muted" style="margin-top:0">{{ identityHelpText }}</p>
    <form id="profile-form" class="form-grid" @submit.prevent="onSaveProfile">
      <div class="field">
        <label>帳號</label>
        <input type="text" :value="user.username || ''" disabled class="input-readonly" />
      </div>
      <div class="field">
        <label>部門</label>
        <input type="text" :value="deptLabel" disabled class="input-readonly" />
      </div>
      <div class="field">
        <label>角色</label>
        <input type="text" :value="user.role === 'admin' ? '系統管理員' : '使用者'" disabled class="input-readonly" />
      </div>
      <div class="field">
        <label>姓名{{ canEditIdentity ? ' *' : '' }}</label>
        <input
          name="name"
          maxlength="80"
          v-model="profileForm.name"
          placeholder="顯示名稱"
          :required="canEditIdentity"
          :readonly="!canEditIdentity"
          :disabled="!canEditIdentity"
          :tabindex="!canEditIdentity ? -1 : undefined"
          :class="{ 'input-readonly': !canEditIdentity }"
        />
        <div v-if="!canEditIdentity" class="muted" style="font-size:0.82rem;margin-top:4px">
          僅供檢視；如需更正請聯絡系統管理員
        </div>
      </div>
      <div class="field">
        <label>Email</label>
        <input
          name="email"
          type="email"
          maxlength="120"
          v-model="profileForm.email"
          placeholder="選填，例：name@company.com"
          :readonly="!canEditIdentity"
          :disabled="!canEditIdentity"
          :tabindex="!canEditIdentity ? -1 : undefined"
          :class="{ 'input-readonly': !canEditIdentity }"
        />
        <div class="muted" style="font-size:0.82rem;margin-top:4px">
          {{ canEditIdentity ? '用於接收簽核結果與待簽核提醒' : '僅供檢視；用於通知。如需變更請聯絡系統管理員' }}
        </div>
      </div>
      <div class="field">
        <label>到職日</label>
        <input type="text" :value="hireDate" disabled />
        <div class="muted" style="font-size:0.82rem;margin-top:4px">
          {{ hireDateHelper }}
        </div>
      </div>
      <div class="field">
        <label>分機</label>
        <input name="extension" maxlength="20" v-model="profileForm.extension" placeholder="選填，例：123" />
      </div>
      <div class="field">
        <label>電話</label>
        <input name="phone" maxlength="40" v-model="profileForm.phone" placeholder="選填，例：0912-345-678" />
      </div>
      <div class="field" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0">
          <input
            type="checkbox"
            name="email_notify"
            id="email-notify-pref"
            value="1"
            v-model="profileForm.email_notify"
            style="margin-top:3px"
          />
          <span>
            <strong>預設以 Email 通知我的申請進度</strong>
            <div class="muted" style="font-size:0.85rem;margin-top:4px">送出申請時可再單次調整；需先填寫上方 Email。</div>
          </span>
        </label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存資料</button>
      </div>
    </form>
  </div>

  <div class="card" style="max-width:560px">
    <h3>🎨 客製化佈景主題</h3>
    <p class="muted" style="margin-top:0">點選下方主題即可即時預覽畫面效果，儲存後於此裝置自動持久化套用。</p>
    <div id="theme-selector-grid" class="theme-grid">
      <button
        v-for="t in THEMES"
        :key="t.id"
        type="button"
        class="btn theme-card"
        :class="{ 'primary active': t.id === selectedThemeId }"
        :data-theme-id="t.id"
        :style="getThemeCardStyle(t)"
        @click="onSelectTheme(t.id)"
      >
        <span
          class="theme-color-dot"
          :style="{
            display: 'inline-block',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: t.id === selectedThemeId ? '#ffffff' : t.vars['--primary'],
            boxShadow: '0 0 0 1.5px rgba(255,255,255,0.6)'
          }"
        ></span>
        <span>{{ t.name }}</span>
      </button>
    </div>
    <div class="form-actions" style="margin-top:14px">
      <button type="button" class="btn primary" id="btn-save-theme" @click="onSaveTheme">🎨 儲存並套用主題</button>
      <button type="button" class="btn outline" id="btn-reset-theme" @click="onResetTheme">還原預設藍調</button>
    </div>
  </div>

  <div class="card" style="max-width:560px" id="agent-settings-card">
    <h3 style="margin-top:0">我的代理人</h3>
    <p class="muted" style="margin-top:0;font-size:0.9rem">
      此設定用於<strong>可代簽您的待辦</strong>。
      <strong>代簽不含財務部發出的簽核</strong>（申請人或代申請人隸屬財務部者，代理人看不到、也不能代簽；仍須您本人處理）。
      另：請假單表單「代理人」即<strong>職務代理人</strong>，於您請假起迄期間可代您簽核（同樣不含財務部發出的單）。
      「代申請請假」無需此授權（任何人皆可於請假流程代同仁送出）。
      不會更動已在簽核中的舊單據。
    </p>
    <div id="agent-settings-body" class="muted">
      <div v-if="loadingAgent">載入中…</div>
      <div v-else-if="agentError" class="error-msg">{{ agentError }}</div>
      <template v-else>
        <form id="agent-form" class="form-grid" @submit.prevent="onSaveAgent">
          <div class="field">
            <label>代理人</label>
            <select name="agent_id" id="agent-select" v-model="agentForm.agent_id">
              <option value="">（不設定）</option>
              <option v-for="x in availableAgents" :key="x.id" :value="x.id">
                {{ x.name }}{{ x.department ? `（${x.department}）` : '' }}
              </option>
            </select>
          </div>
          <div class="field">
            <label>生效起（選填）</label>
            <input type="datetime-local" name="start_at" v-model="agentForm.start_at" />
          </div>
          <div class="field">
            <label>生效迄（選填）</label>
            <input type="datetime-local" name="end_at" v-model="agentForm.end_at" />
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="can_approve" v-model="agentForm.can_approve" />
              可代簽（處理我的待簽核；不含財務部發出的簽核）
            </label>
          </div>
          <div class="field hidden">
            <input type="checkbox" name="can_submit_leave" v-model="agentForm.can_submit_leave" />
          </div>
          <div class="field">
            <label>備註</label>
            <input name="note" maxlength="200" v-model="agentForm.note" placeholder="選填" />
          </div>
          <div class="form-actions" style="gap:8px">
            <button type="submit" class="btn primary">儲存代理人</button>
            <button type="button" class="btn outline" id="btn-clear-agent" @click="onClearAgent">清除</button>
          </div>
        </form>
        <div v-if="asForList.length" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <strong style="font-size:0.92rem">我目前可代理</strong>
          <ul style="margin:8px 0 0;padding-left:18px">
            <li v-for="a in asForList" :key="a.id" style="margin:4px 0">
              {{ a.principal?.name || '#' + a.principal_id }}
              <span class="muted" style="font-size:0.82rem">
                {{ formatAsForRole(a) }}
                {{ formatAsForRange(a) }}
              </span>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </div>

  <div v-if="SIGNATURE_SETTINGS_ENABLED" class="card" style="max-width:560px">
    <h3>✍️ 個人電子簽名檔</h3>
    <p class="muted" style="margin-top:0">
      可先設定個人手寫簽名。核准時預設套用此簽名；亦可選擇現場手寫。簽名會出現在簽核歷程與 PDF。
    </p>
    <div style="border:1px dashed #cbd5e1;border-radius:10px;padding:16px;background:#f8fafc;text-align:center;margin-bottom:14px">
      <div id="sig-preview-box">
        <img
          v-if="userSig"
          :src="userSig"
          style="max-height:90px;max-width:100%;object-fit:contain;background:#fff;padding:4px;border:1px solid #e2e8f0;border-radius:6px"
          alt="個人電子簽名"
        />
        <div v-else class="muted" style="padding:20px 0">尚未設定個人電子簽名檔</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button type="button" class="btn primary sm" id="btn-draw-signature" @click="onDrawSignature">✍️ 白板手寫簽名</button>
      <button type="button" class="btn outline sm" id="btn-upload-sig-file" @click="triggerSigUpload">📁 上傳簽名圖檔</button>
      <input type="file" id="sig-file-input" ref="sigFileInput" accept="image/*" class="hidden" @change="onSigFileChange" />
      <button v-if="userSig" type="button" class="btn danger outline sm" id="btn-clear-signature" @click="onClearSignature">🗑️ 清除預設簽名</button>
    </div>
  </div>

  <div class="card" style="max-width:560px">
    <h3>變更密碼</h3>
    <form id="pw-form" class="form-grid" @submit.prevent="onChangePassword">
      <div class="field">
        <label>目前密碼</label>
        <input type="password" name="currentPassword" v-model="pwForm.currentPassword" required autocomplete="current-password" />
      </div>
      <div class="field">
        <label>新密碼（至少 6 字元）</label>
        <input type="password" name="newPassword" v-model="pwForm.newPassword" required minlength="6" autocomplete="new-password" />
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">更新密碼</button>
      </div>
    </form>
  </div>

  <div class="card" style="max-width:560px">
    <h3>Email 提醒</h3>
    <p class="muted" style="margin:0">系統 Email 功能目前：
      <strong>{{ mailCfg.enabled ? '已啟用' : '未啟用' }}</strong>
      <template v-if="mailCfg.enabled && !mailCfg.ready">（管理員尚未完成 SMTP）</template>
    </p>
    <p class="muted" style="margin:8px 0 0;font-size:0.9rem;line-height:1.5" v-html="emailHintHtml"></p>
  </div>

  <div class="card" style="max-width:560px">
    <h3>桌面通知設定</h3>
    <p class="muted" style="margin-top:0;line-height:1.5">
      登入後系統會定期檢查「待我簽核」。有新件時可透過瀏覽器桌面通知提醒（本機偏好，不跟著帳號同步）。
    </p>
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#f8fafc;margin-bottom:12px">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
        <span>瀏覽器權限：</span>
        <span class="tag" :class="dnPerm.cls">{{ dnPerm.text }}</span>
        <template v-if="dnSupported">
          <button type="button" class="btn outline sm" id="btn-dn-permission" @click="onRequestDnPerm">允許桌面通知</button>
          <button type="button" class="btn outline sm" id="btn-dn-test" @click="onTestDn">發送測試通知</button>
        </template>
      </div>
    </div>
    <form id="desktop-notify-form" class="form-grid" @submit.prevent="onSaveDnPrefs">
      <div class="field dn-check-field">
        <label>
          <input type="checkbox" id="dn-enabled" v-model="dnForm.enabled" />
          <span>
            <strong>啟用桌面通知</strong>
            <div class="muted" style="font-size:0.85rem;margin-top:4px">待簽核件數增加時推送系統通知</div>
          </span>
        </label>
      </div>
      <div class="field dn-check-field">
        <label>
          <input type="checkbox" id="dn-foreground" v-model="dnForm.foreground" />
          <span>
            <strong>分頁在前景也顯示通知</strong>
            <div class="muted" style="font-size:0.85rem;margin-top:4px">關閉後僅在瀏覽器縮到背景／其他分頁時推送</div>
          </span>
        </label>
      </div>
      <div class="field dn-check-field">
        <label>
          <input type="checkbox" id="dn-title-flash" v-model="dnForm.titleFlash" />
          <span>
            <strong>背景時閃爍分頁標題</strong>
            <div class="muted" style="font-size:0.85rem;margin-top:4px">標題交替顯示「【待簽核】…」提醒</div>
          </span>
        </label>
      </div>
      <div class="field">
        <label>檢查間隔（秒）</label>
        <input type="number" id="dn-poll-sec" min="10" max="120" step="5" v-model.number="dnForm.pollSec" />
        <div class="muted" style="font-size:0.82rem;margin-top:4px">建議 15～30 秒；過短會增加伺服器負擔</div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary">儲存桌面通知設定</button>
      </div>
    </form>
    <p class="muted" style="font-size:0.82rem;margin:12px 0 0;line-height:1.5">
      • 需使用 <strong>Chrome / Edge</strong>。完整步驟見文件 <strong>docs/桌面通知使用說明.md</strong>。<br/>
      • 顯示<strong>已封鎖</strong>：網址列左側圖示 → 通知 → 允許；或 Edge 開啟
        <code style="font-size:0.78rem">edge://settings/content/notifications</code> 把本站改允許後重新整理。<br/>
      • 網站為 <strong>http://</strong>（非 HTTPS）時，瀏覽器可能強制封鎖。暫用：
        <code style="font-size:0.78rem">edge://flags</code> 搜尋
        <em>Insecure origins treated as secure</em>，填入本站完整網址 → Enabled → 重啟瀏覽器後再按「允許」。長期建議改 HTTPS。<br/>
      • 仍無通知：Windows 設定 → 系統 → 通知 → Microsoft Edge 須開啟，並關閉勿擾模式後測試。
    </p>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { L } from '@/native/bridge';

const user = computed(() => L.state?.user || {});
const canEditIdentity = computed(() => L.isAdmin());
const isBuiltinAdmin = computed(() => {
  if (typeof L.isBuiltinAdmin === 'function') return L.isBuiltinAdmin();
  return user.value.is_builtin_admin || user.value.username === 'admin';
});

const SIGNATURE_SETTINGS_ENABLED = Boolean(L.SIGNATURE_SETTINGS_ENABLED);

const THEMES = [
  {
    id: 'navy',
    name: '🌊 經典藍調',
    vars: {
      '--primary': '#2563eb',
      '--primary-hover': '#1d4ed8',
      '--sidebar': '#0b192c',
      '--sidebar-2': '#1e3e62',
      '--bg': '#f1f5f9',
      '--surface': '#ffffff',
      '--text': '#0f172a',
      '--text-heading': '#0f172a',
      '--muted': '#64748b',
      '--border': '#cbd5e1',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'dark',
    name: '🌙 暗黑夜空',
    vars: {
      '--primary': '#3b82f6',
      '--primary-hover': '#60a5fa',
      '--sidebar': '#0f172a',
      '--sidebar-2': '#1e293b',
      '--bg': '#090d16',
      '--surface': '#151d2a',
      '--text': '#e2e8f0',
      '--text-heading': '#f8fafc',
      '--muted': '#94a3b8',
      '--border': '#2a3649',
      '--input-bg': '#1e293b',
    },
  },
  {
    id: 'emerald',
    name: '🌲 翡翠森林',
    vars: {
      '--primary': '#059669',
      '--primary-hover': '#047857',
      '--sidebar': '#064e3b',
      '--sidebar-2': '#047857',
      '--bg': '#f0fdf4',
      '--surface': '#ffffff',
      '--text': '#064e3b',
      '--text-heading': '#022c22',
      '--muted': '#374151',
      '--border': '#a7f3d0',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'violet',
    name: '💜 皇家紫羅蘭',
    vars: {
      '--primary': '#7c3aed',
      '--primary-hover': '#6d28d9',
      '--sidebar': '#2e1065',
      '--sidebar-2': '#4c1d95',
      '--bg': '#f5f3ff',
      '--surface': '#ffffff',
      '--text': '#2e1065',
      '--text-heading': '#1e1b4b',
      '--muted': '#6b7280',
      '--border': '#ddd6fe',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'amber',
    name: '🌅 暖陽日暮',
    vars: {
      '--primary': '#d97706',
      '--primary-hover': '#b45309',
      '--sidebar': '#451a03',
      '--sidebar-2': '#78350f',
      '--bg': '#fffbeb',
      '--surface': '#ffffff',
      '--text': '#451a03',
      '--text-heading': '#292524',
      '--muted': '#57534e',
      '--border': '#fde68a',
      '--input-bg': '#ffffff',
    },
  },
  {
    id: 'rose',
    name: '🌸 櫻花石榴',
    vars: {
      '--primary': '#e11d48',
      '--primary-hover': '#be123c',
      '--sidebar': '#4c0519',
      '--sidebar-2': '#881337',
      '--bg': '#fff1f2',
      '--surface': '#ffffff',
      '--text': '#4c0519',
      '--text-heading': '#881337',
      '--muted': '#64748b',
      '--border': '#fecdd3',
      '--input-bg': '#ffffff',
    },
  },
];

const selectedThemeId = ref(localStorage.getItem('approval_user_theme') || 'navy');

function getThemeCardStyle(t) {
  if (t.id === selectedThemeId.value) {
    return `background: linear-gradient(135deg, ${t.vars['--primary']} 0%, ${t.vars['--primary-hover']} 100%) !important; color: #ffffff !important; border-color: ${t.vars['--primary-hover']} !important; box-shadow: 0 4px 14px ${t.vars['--primary']}55 !important;`;
  }
  return '';
}

function onSelectTheme(themeId) {
  selectedThemeId.value = themeId;
  if (typeof L.applyUserTheme === 'function') {
    L.applyUserTheme(themeId, false);
  }
}

function onSaveTheme() {
  if (typeof L.applyUserTheme === 'function') {
    L.applyUserTheme(selectedThemeId.value, true);
  }
  const cur = THEMES.find((t) => t.id === selectedThemeId.value) || THEMES[0];
  L.toast(`已成功套用「${cur.name}」客製化主題！`, 'success');
}

function onResetTheme() {
  selectedThemeId.value = 'navy';
  if (typeof L.applyUserTheme === 'function') {
    L.applyUserTheme('navy', true);
  }
  L.toast('已還原為預設經典藍調主題！', 'success');
}

// 我的資料
const u = L.state?.user || {};
const deptLabel = computed(() => {
  const depts = u.departments;
  if (Array.isArray(depts) && depts.length) return depts.join('、');
  return u.department || '—';
});

const identityHelpText = computed(() =>
  canEditIdentity.value
    ? '管理員可修改姓名、Email、分機與電話。帳號與部門請於「成員名單」管理。'
    : '一般使用者無法修改姓名與 Email（由系統管理員設定）。您可更新分機、電話、通知偏好與密碼。'
);

const hireDate = computed(() => u.hire_date || u.labor?.hireDate || '未設定');
const hireDateHelper = computed(() => {
  if (u.labor?.specialLeave) {
    const sl = u.labor.specialLeave;
    const seniority = u.labor?.seniority?.label ? `；年資 ${u.labor.seniority.label}（僅顯示）` : '';
    return `特休可休 ${sl.entitled ?? 0} 日（手動）· 剩餘 ${sl.remaining ?? '—'} 日${seniority}`;
  }
  return '特休可休由管理員於「成員名單」手動設定（不依年資）';
});

const profileForm = reactive({
  name: u.name || '',
  email: u.email || '',
  extension: u.extension || '',
  phone: u.phone || '',
  email_notify: u.email_notify !== 0,
});

async function onSaveProfile() {
  const payload = {
    extension: profileForm.extension || '',
    phone: profileForm.phone || '',
    email_notify: profileForm.email_notify ? 1 : 0,
    name: canEditIdentity.value ? profileForm.name : u.name || '',
    email: canEditIdentity.value ? (profileForm.email || '') : (u.email || ''),
  };
  try {
    const data = await L.api('/api/auth/profile', {
      method: 'PUT',
      body: payload,
    });
    if (data.user && L.state) {
      L.state.user = { ...L.state.user, ...data.user };
      const nameEl = document.getElementById('user-name');
      if (nameEl) nameEl.textContent = data.user.name;
      const avatarEl = document.getElementById('user-avatar');
      if (avatarEl) avatarEl.textContent = (data.user.name || 'U').slice(0, 1);
    }
    L.toast('個人資料已更新', 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

// 密碼表單
const pwForm = reactive({
  currentPassword: '',
  newPassword: '',
});

async function onChangePassword() {
  try {
    await L.api('/api/auth/password', {
      method: 'PUT',
      body: {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      },
    });
    pwForm.currentPassword = '';
    pwForm.newPassword = '';
    L.toast('密碼已更新', 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

// Email 提醒狀態
const mailCfg = ref({ enabled: false, ready: false });
try {
  mailCfg.value = await L.api('/api/mail/config');
} catch {
  mailCfg.value = { enabled: false, ready: false };
}

const emailHintHtml = computed(() => {
  const intro = canEditIdentity.value
    ? '請在上方填寫 Email 並勾選通知偏好。'
    : 'Email 由管理員設定；請確認上方信箱正確並勾選通知偏好。';
  const adminHint = isBuiltinAdmin.value
    ? 'SMTP 與公司品牌請至<strong>系統設定</strong>管理（僅內建 Admin）。'
    : '';
  return `
        ${intro}
        申請送出後，可在簽核詳情點「Email 催辦簽核人」。
        ${adminHint}
      `;
});

// 個人電子簽名檔
const userSig = ref(u.signature_image || null);
if (SIGNATURE_SETTINGS_ENABLED) {
  try {
    const sigRes = await L.api('/api/users/me/signature');
    if (sigRes.signature_image) {
      userSig.value = sigRes.signature_image;
      if (L.state && L.state.user) {
        L.state.user.signature_image = userSig.value;
        L.state.user.has_signature = true;
      }
    }
  } catch {
    /* ignore */
  }
}

const sigFileInput = ref(null);
function triggerSigUpload() {
  sigFileInput.value?.click();
}

function onSigFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    L.toast('請上傳圖檔（PNG / JPG）', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (evt) => {
    const dataUrl = evt.target.result;
    try {
      const res = await L.api('/api/users/me/signature', {
        method: 'POST',
        body: { signature_image: dataUrl },
      });
      userSig.value = dataUrl;
      if (L.state && L.state.user) {
        L.state.user.signature_image = dataUrl;
        L.state.user.has_signature = true;
      }
      L.toast(res.message || '簽名圖檔上傳成功', 'success');
    } catch (err) {
      L.toast(err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
}

function onDrawSignature() {
  if (typeof L.openSignaturePadModal === 'function') {
    L.openSignaturePadModal({
      title: '手寫個人電子簽名檔',
      initialImage: userSig.value,
      onSave: async (dataUrl) => {
        try {
          const res = await L.api('/api/users/me/signature', {
            method: 'POST',
            body: { signature_image: dataUrl },
          });
          userSig.value = dataUrl;
          if (L.state && L.state.user) {
            L.state.user.signature_image = dataUrl;
            L.state.user.has_signature = true;
          }
          L.toast(res.message || '手寫電子簽名已儲存', 'success');
        } catch (err) {
          L.toast(err.message, 'error');
        }
      },
    });
  }
}

async function onClearSignature() {
  if (!confirm('確定清除預設電子簽名檔？')) return;
  try {
    const res = await L.api('/api/users/me/signature', { method: 'DELETE' });
    userSig.value = null;
    if (L.state && L.state.user) {
      L.state.user.signature_image = null;
      L.state.user.has_signature = false;
    }
    L.toast(res.message || '簽名檔已清除', 'success');
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

// 我的代理人
const loadingAgent = ref(false);
const agentError = ref('');
const availableAgents = ref([]);
const asForList = ref([]);
const agentForm = reactive({
  agent_id: '',
  start_at: '',
  end_at: '',
  can_approve: true,
  can_submit_leave: true,
  note: '',
});

async function loadAgentData() {
  loadingAgent.value = true;
  agentError.value = '';
  try {
    let allUsers = L.state?.users || [];
    if (!allUsers.length) {
      const udata = await L.api('/api/users');
      allUsers = udata.users || [];
      if (L.state) L.state.users = allUsers;
    }
    const myId = L.state?.user?.id;
    availableAgents.value = allUsers.filter((x) => x.active !== 0 && x.id !== myId);

    const data = await L.api('/api/agents/me');
    const cur = data.myAgent;
    asForList.value = data.asAgentFor || [];

    if (cur) {
      agentForm.agent_id = cur.agent_id || '';
      agentForm.start_at = cur.start_at ? String(cur.start_at).replace(' ', 'T').slice(0, 16) : '';
      agentForm.end_at = cur.end_at ? String(cur.end_at).replace(' ', 'T').slice(0, 16) : '';
      agentForm.can_approve = cur.can_approve !== false && cur.can_approve !== 0;
      agentForm.can_submit_leave = true;
      agentForm.note = cur.note || '';
    } else {
      agentForm.agent_id = '';
      agentForm.start_at = '';
      agentForm.end_at = '';
      agentForm.can_approve = true;
      agentForm.can_submit_leave = true;
      agentForm.note = '';
    }
  } catch (err) {
    agentError.value = err.message || '載入失敗';
  } finally {
    loadingAgent.value = false;
  }
}

function formatAsForRole(a) {
  if (a.source === 'leave_duty') return '·請假職務代理';
  const parts = [];
  if (a.can_approve) parts.push('·代簽');
  if (a.can_submit_leave) parts.push('·代請假');
  return parts.join('');
}

function formatAsForRange(a) {
  if (!a.start_at && !a.end_at) return '';
  const range = [a.start_at, a.end_at].filter(Boolean).map((x) => String(x).slice(0, 16)).join('～');
  return `（${range}）`;
}

async function onSaveAgent() {
  if (!agentForm.agent_id) {
    L.toast('請選擇代理人，或按「清除」', 'error');
    return;
  }
  try {
    await L.api('/api/agents/me', {
      method: 'PUT',
      body: {
        agent_id: Number(agentForm.agent_id),
        start_at: agentForm.start_at || null,
        end_at: agentForm.end_at || null,
        can_approve: Boolean(agentForm.can_approve),
        can_submit_leave: Boolean(agentForm.can_submit_leave),
        note: agentForm.note || '',
      },
    });
    L.toast('代理人已儲存', 'success');
    await loadAgentData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

async function onClearAgent() {
  if (!confirm('確定清除代理人設定？')) return;
  try {
    await L.api('/api/agents/me', { method: 'DELETE' });
    L.toast('已清除代理人', 'success');
    await loadAgentData();
  } catch (err) {
    L.toast(err.message, 'error');
  }
}

await loadAgentData();

// 桌面通知設定
const dnSupported = typeof window !== 'undefined' && 'Notification' in window;
const dnPerm = computed(() => {
  if (typeof L.desktopNotifyPermissionLabel === 'function') {
    return L.desktopNotifyPermissionLabel();
  }
  if (!dnSupported) return { text: '不支援', cls: 'danger' };
  const p = Notification.permission;
  if (p === 'granted') return { text: '已允許', cls: 'approved' };
  if (p === 'denied') return { text: '已封鎖', cls: 'rejected' };
  return { text: '尚未詢問', cls: 'pending' };
});

const dnPrefs = typeof L.getDesktopNotifyPrefs === 'function' ? L.getDesktopNotifyPrefs() : {
  enabled: false,
  foreground: false,
  titleFlash: true,
  pollSec: 20,
};

const dnForm = reactive({
  enabled: dnPrefs.enabled,
  foreground: dnPrefs.foreground,
  titleFlash: dnPrefs.titleFlash,
  pollSec: dnPrefs.pollSec,
});

function onSaveDnPrefs() {
  if (typeof L.saveDesktopNotifyPrefs === 'function') {
    const prefs = L.saveDesktopNotifyPrefs({
      enabled: Boolean(dnForm.enabled),
      foreground: Boolean(dnForm.foreground),
      titleFlash: Boolean(dnForm.titleFlash),
      pollSec: Number(dnForm.pollSec) || 20,
    });
    if (L.state?.token && typeof L.startPendingWatcher === 'function') {
      L.startPendingWatcher({ requestPermission: false });
    }
    L.toast(
      prefs.enabled
        ? `桌面通知已儲存（每 ${prefs.pollSec} 秒檢查）`
        : '已關閉桌面通知（仍顯示角標與站內提示）',
      'success'
    );
  }
}

async function onRequestDnPerm() {
  if (typeof L.ensureNotifyPermission === 'function') {
    const ok = await L.ensureNotifyPermission(true);
    if (ok) {
      if (typeof L.saveDesktopNotifyPrefs === 'function') {
        L.saveDesktopNotifyPrefs({ enabled: true });
      }
      dnForm.enabled = true;
      L.toast('已允許桌面通知', 'success');
    } else if (!('Notification' in window)) {
      L.toast('此瀏覽器不支援桌面通知', 'error');
    } else if (Notification.permission === 'denied') {
      L.toast('通知已被封鎖，請至瀏覽器網站設定改為「允許」', 'error');
    } else {
      L.toast('未取得通知權限', 'error');
    }
  }
}

function onTestDn() {
  if (typeof L.ensureNotifyPermission === 'function') {
    L.ensureNotifyPermission(true).then((ok) => {
      if (!ok) {
        L.toast('請先允許桌面通知權限', 'error');
        return;
      }
      if (!dnForm.enabled) {
        L.toast('請先勾選「啟用桌面通知」並儲存', 'error');
        return;
      }
      if (typeof L.showDesktopNotification === 'function') {
        L.showDesktopNotification(
          '線上簽核系統 · 測試',
          '這是一則測試桌面通知。點擊可回到待簽核列表。',
          () => {
            if (typeof L.navigate === 'function') L.navigate('inbox');
          }
        );
        L.toast('已發送測試通知（若沒看到請檢查系統勿擾模式）', 'success');
      }
    });
  }
}
</script>
