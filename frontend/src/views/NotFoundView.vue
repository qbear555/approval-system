<template>
  <div class="empty empty-state">
    <div class="empty-icon" aria-hidden="true">◇</div>
    <div class="empty-title">找不到這個頁面</div>
    <div class="empty-desc">網址沒有對應的功能。請從左側選單進入。</div>
    <div class="empty-actions form-actions" style="justify-content:center;margin-top:14px">
      <router-link to="/dashboard" class="btn primary">回總覽</router-link>
    </div>
  </div>
</template>
