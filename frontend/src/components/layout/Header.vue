<template>
  <header class="app-header">
    <div class="header-left">
      <h1 class="page-title">{{ title }}</h1>
    </div>
    <div class="header-right">
      <slot name="actions"></slot>
    </div>
  </header>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: '',
  },
});
</script>

<style scoped>
.app-header {
  height: 60px;
  border-bottom: 1px solid var(--border);
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  position: sticky;
  top: 0;
  z-index: 40;
}

.page-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-main);
}
</style>
