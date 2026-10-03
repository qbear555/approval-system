<template>
  <div class="user-settings-page">
    <!-- 1. 個人密碼修改 -->
    <div class="card section-card">
      <h3 class="section-title">修改登入密碼</h3>
      <p class="section-desc">建議定期更換密碼以確保帳號安全。</p>

      <form @submit.prevent="handleChangePassword" class="settings-form">
        <div class="form-group">
          <label>目前密碼</label>
          <input v-model="pwdForm.currentPassword" type="password" required class="form-control" />
        </div>
        <div class="form-row">
          <div class="form-group col">
            <label>新密碼</label>
            <input v-model="pwdForm.newPassword" type="password" required minlength="6" class="form-control" />
          </div>
          <div class="form-group col">
            <label>再次確認新密碼</label>
            <input v-model="pwdForm.confirmPassword" type="password" required class="form-control" />
          </div>
        </div>
        <button type="submit" class="btn primary sm" :disabled="pwdLoading">
          {{ pwdLoading ? '更新中...' : '更新密碼' }}
        </button>
      </form>
    </div>

    <!-- 2. 簽核代理人設定 (Delegation) -->
    <div class="card section-card">
      <h3 class="section-title">職務代理人設定</h3>
      <p class="section-desc">休假或出差期間，由指定代理人協助簽核指派給您的表單案件。</p>

      <form @submit.prevent="handleSaveDelegation" class="settings-form">
        <div class="form-group checkbox-group">
          <label class="check-label">
            <input v-model="delegation.enabled" type="checkbox" />
            <span><strong>啟用職務代理機制</strong></span>
          </label>
        </div>

        <div v-if="delegation.enabled" class="sub-form">
          <div class="form-group">
            <label>指定代理人</label>
            <select v-model="delegation.agentId" class="form-control" required>
              <option value="">請選擇代理同仁...</option>
              <option v-for="u in userList" :key="u.id" :value="u.id">
                {{ u.name }} ({{ u.department || '無部門' }})
              </option>
            </select>
          </div>

          <div class="form-row">
            <div class="form-group col">
              <label>代理開始日</label>
              <input v-model="delegation.startDate" type="date" class="form-control" required />
            </div>
            <div class="form-group col">
              <label>代理結束日</label>
              <input v-model="delegation.endDate" type="date" class="form-control" required />
            </div>
          </div>
        </div>

        <button type="submit" class="btn primary sm" :disabled="delLoading">
          {{ delLoading ? '儲存中...' : '儲存代理設定' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { apiRequest } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();

const pwdForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const pwdLoading = ref(false);

const delegation = ref({
  enabled: false,
  agentId: '',
  startDate: '',
  endDate: '',
});
const delLoading = ref(false);
const userList = ref([]);

onMounted(async () => {
  try {
    const [uRes, delRes] = await Promise.allSettled([
      apiRequest('/api/users'),
      apiRequest('/api/users/me/delegation'),
    ]);
    if (uRes.status === 'fulfilled') {
      userList.value = uRes.value?.users || [];
    }
    if (delRes.status === 'fulfilled' && delRes.value?.delegation) {
      const d = delRes.value.delegation;
      delegation.value = {
        enabled: !!d.enabled,
        agentId: d.agent_id || '',
        startDate: d.start_date ? d.start_date.split('T')[0] : '',
        endDate: d.end_date ? d.end_date.split('T')[0] : '',
      };
    }
  } catch (e) {
    console.warn(e);
  }
});

async function handleChangePassword() {
  if (pwdForm.value.newPassword !== pwdForm.value.confirmPassword) {
    return toast.error('兩次輸入的新密碼不一致');
  }
  pwdLoading.value = true;
  try {
    await apiRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: pwdForm.value.currentPassword,
        newPassword: pwdForm.value.newPassword,
      }),
    });
    toast.success('密碼修改成功！');
    pwdForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' };
  } catch (err) {
    toast.error('修改失敗: ' + err.message);
  } finally {
    pwdLoading.value = false;
  }
}

async function handleSaveDelegation() {
  delLoading.value = true;
  try {
    await apiRequest('/api/users/me/delegation', {
      method: 'POST',
      body: JSON.stringify(delegation.value),
    });
    toast.success('代理人設定已更新！');
  } catch (err) {
    toast.error('儲存代理失敗: ' + err.message);
  } finally {
    delLoading.value = false;
  }
}
</script>

<style scoped>
.user-settings-page {
  max-width: 720px;
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
}

.section-desc {
  font-size: 0.88rem;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.95rem;
}

.form-row {
  display: flex;
  gap: 16px;
}
.form-row .col {
  flex: 1;
}

.sub-form {
  padding: 16px;
  background: #f8fafc;
  border-radius: 6px;
  margin-bottom: 16px;
}

.checkbox-group {
  margin-bottom: 14px;
}
.check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
</style>
