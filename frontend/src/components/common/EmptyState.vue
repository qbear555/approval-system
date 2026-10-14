<template>
  <div class="empty empty-state">
    <div class="empty-icon" aria-hidden="true">◇</div>
    <div class="empty-title">{{ title }}</div>
    <div v-if="desc" class="empty-desc">{{ desc }}</div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '暫無資料' },
  desc: { type: String, default: '' },
});
</script>
