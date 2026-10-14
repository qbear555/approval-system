<template>
  <div v-if="!auth.isBuiltinAdmin" class="error-msg">僅系統內建 Admin 帳號可進入 LINE 通知設定</div>
  <div v-else-if="loadError" class="error-msg">{{ loadError }}</div>
  <div v-else-if="loading" class="card muted" style="padding:28px;text-align:center">載入 LINE 設定中…</div>
  <div v-else class="card">
    <p class="muted" style="margin-top:0;line-height:1.55">
      透過獨立服務 <code>line-notify</code>（預設埠 3850）推播 Messaging API。
      Channel Token 只放在 LINE 專案 <code>.env</code>；此處只填<strong>服務網址</strong>與<strong>內部 API 金鑰</strong>。
      目前<strong>僅內建 Admin</strong>可設定與收推播；其他人即使已綁定也不會收到。
      Admin 請對官方帳號傳送 <code>綁定 Admin</code>。
      LINE Developers 的 Webhook 必須是<strong>公網 HTTPS</strong>，例如 <code>https://catshome.tw:3848/line/webhook</code>。
      解除可傳 <code>解除綁定</code>，或在下方列表按「解除」。
    </p>
    <p style="margin:0 0 12px">
      狀態：
      <strong :style="{ color: cfg.ready ? '#15803d' : '#b45309' }">{{ statusText }}</strong>
      <span v-if="cfg.updatedAt" class="muted" style="margin-left:8px;font-size:0.85rem">更新：{{ updatedText }}</span>
    </p>
    <form class="form-grid" @submit.prevent="save">
      <div class="field check-row-box">
        <label class="check-row">
          <input v-model="form.enabled" type="checkbox" />
          <span><strong>啟用 LINE 推播通知</strong></span>
        </label>
      </div>
      <div class="field">
        <label>LINE 服務網址</label>
        <input v-model="form.serviceUrl" placeholder="http://192.168.99.220:3850" autocomplete="off" />
        <span class="field-hint" style="color:#6b7280;font-size:0.82rem">正式 NAS 建議：http://192.168.99.220:3850（容器內可用 http://line-notify:3850）</span>
      </div>
      <div class="field">
        <label>內部 API 金鑰（= line-notify 的 INTERNAL_API_KEY）</label>
        <input
          v-model="form.apiKey"
          type="password"
          autocomplete="new-password"
          :placeholder="cfg.hasApiKey ? '已設定（留空則不變更）' : '尚未設定'"
        />
      </div>
      <div v-if="showAccess" class="field">
        <label>誰可以設定 LINE</label>
        <select v-model="form.configAccess">
          <option value="builtin_admin">僅內建 Admin</option>
          <option value="any_admin">所有系統管理員</option>
          <option value="permission">具備「LINE 通知設定」權限者</option>
        </select>
        <span class="field-hint" style="color:#6b7280;font-size:0.82rem">僅內建 Admin 可變更此項</span>
      </div>
      <div class="field">
        <strong class="check-group-title" style="display:block;margin-bottom:8px">通知事件</strong>
        <div class="check-group-box" style="background:#f8fafc">
          <label class="check-row"><input v-model="form.events.pending" type="checkbox" /><span>待簽核（通知簽核人）</span></label>
          <label class="check-row"><input v-model="form.events.submitted" type="checkbox" /><span>申請已送出（通知申請人）</span></label>
          <label class="check-row"><input v-model="form.events.approved" type="checkbox" /><span>已核准</span></label>
          <label class="check-row"><input v-model="form.events.rejected" type="checkbox" /><span>已駁回</span></label>
          <label class="check-row"><input v-model="form.events.step" type="checkbox" /><span>關卡進度更新</span></label>
          <label class="check-row"><input v-model="form.events.remind" type="checkbox" /><span>催辦</span></label>
        </div>
      </div>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="submit" class="btn primary" :disabled="saving">{{ saving ? '儲存中…' : '儲存 LINE 設定' }}</button>
        <button type="button" class="btn outline" :disabled="checking" @click="checkHealth">{{ checking ? '檢查中…' : '檢查服務' }}</button>
        <button type="button" class="btn outline" :disabled="testing" @click="sendTest">{{ testing ? '送出中…' : '測試推播給自己' }}</button>
      </div>
    </form>
    <div style="margin-top:14px;font-size:0.88rem;line-height:1.5">
      <div v-if="bindingsError" class="muted">無法載入綁定列表（服務未就緒或 API 金鑰不符）</div>
      <div v-else-if="!bindings.length" class="muted">
        尚無綁定紀錄。請成員對 LINE 官方帳號傳送：<code>綁定 您的簽核帳號</code>
      </div>
      <template v-else>
        <strong>已綁定帳號（{{ bindings.length }} 筆）</strong>
        <table class="data" style="margin-top:8px;font-size:0.85rem;width:100%">
          <thead>
            <tr><th>簽核帳號</th><th>LINE userId</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="b in bindings.slice(0, 50)" :key="b.username + (b.lineUserId || b.userId || '')">
              <td>{{ b.username || '—' }}</td>
              <td style="font-family:monospace;font-size:0.8rem">{{ String(b.lineUserId || b.userId || '').slice(0, 24) }}</td>
              <td>
                <button type="button" class="btn ghost sm" @click="unbind(b.username)">解除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="muted" style="margin:8px 0 0;font-size:0.82rem">成員也可在 LINE 傳「解除綁定」自行取消。</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiRequest } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

const auth = useAuthStore();
const toast = useToastStore();

const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const checking = ref(false);
const testing = ref(false);
const bindingsError = ref(false);
const bindings = ref([]);
const cfg = ref({});

const form = reactive({
  enabled: false,
  serviceUrl: 'http://192.168.99.220:3850',
  apiKey: '',
  configAccess: 'builtin_admin',
  events: {
    pending: true,
    submitted: true,
    approved: true,
    rejected: true,
    step: true,
    remind: true,
  },
});

const showAccess = computed(() => cfg.value.adminOnly === false && auth.isBuiltinAdmin);

const statusText = computed(() =>
  cfg.value.ready
    ? '已就緒（啟用且已設定服務網址與 API 金鑰）'
    : cfg.value.enabled
      ? '已啟用但尚未就緒（請檢查服務網址／API 金鑰）'
      : '未啟用'
);

const updatedText = computed(() =>
  String(cfg.value.updatedAt || '').replace('T', ' ').replace(/\.\d+Z$/, '')
);

function applyCfg(next) {
  const c = next || {};
  cfg.value = c;
  const ev = c.events || {};
  form.enabled = !!c.enabled;
  form.serviceUrl = c.serviceUrl || 'http://192.168.99.220:3850';
  form.apiKey = '';
  form.configAccess = c.configAccess || 'builtin_admin';
  form.events.pending = ev.pending !== false;
  form.events.submitted = ev.submitted !== false;
  form.events.approved = ev.approved !== false;
  form.events.rejected = ev.rejected !== false;
  form.events.step = ev.step !== false;
  form.events.remind = ev.remind !== false;
}

async function loadBindings() {
  bindingsError.value = false;
  try {
    const data = await apiRequest('/api/line/bindings');
    bindings.value = data.bindings || [];
  } catch {
    bindings.value = [];
    bindingsError.value = true;
  }
}

async function load() {
  if (!auth.isBuiltinAdmin) {
    loading.value = false;
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    const data = await apiRequest('/api/line/config');
    applyCfg(data.config || data || {});
    await loadBindings();
  } catch (err) {
    loadError.value = err.message || '無法載入 LINE 設定';
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const body = {
      enabled: !!form.enabled,
      serviceUrl: String(form.serviceUrl || '').trim(),
      apiKey: String(form.apiKey || ''),
      events: { ...form.events },
    };
    if (auth.isBuiltinAdmin && form.configAccess) body.configAccess = form.configAccess;
    const data = await apiRequest('/api/line/config', { method: 'PUT', body });
    applyCfg(data.config || data || {});
    toast.success('LINE 設定已儲存');
    await loadBindings();
  } catch (err) {
    toast.error(err.message || '儲存失敗');
  } finally {
    saving.value = false;
  }
}

async function checkHealth() {
  checking.value = true;
  try {
    const h = await apiRequest('/api/line/health');
    if (h.ok) {
      toast.success(
        `服務正常${h.data?.version ? ' v' + h.data.version : ''}${h.data?.lineConfigured === false ? '（Channel 尚未設定）' : ''}`
      );
    } else {
      toast.error(h.error || `服務異常 HTTP ${h.status || ''}`);
    }
  } catch (err) {
    toast.error(err.message || '無法連線 LINE 服務');
  } finally {
    checking.value = false;
  }
}

async function sendTest() {
  testing.value = true;
  try {
    await apiRequest('/api/line/test', {
      method: 'POST',
      body: { username: auth.user?.username || '' },
    });
    toast.success('已送出測試推播（請確認 LINE 已綁定簽核帳號）');
  } catch (err) {
    toast.error(err.message || '測試推播失敗');
  } finally {
    testing.value = false;
  }
}

async function unbind(username) {
  const uname = String(username || '');
  if (!uname || !confirm(`確定解除「${uname}」的 LINE 綁定？`)) return;
  try {
    await apiRequest(`/api/line/bindings/${encodeURIComponent(uname)}`, { method: 'DELETE' });
    toast.success(`已解除 ${uname} 的 LINE 綁定`);
    bindings.value = bindings.value.filter((b) => b.username !== uname);
  } catch (err) {
    toast.error(err.message || '解除失敗');
  }
}

onMounted(load);
</script>
