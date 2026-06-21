<template>
  <section class="jenn-admin-status">
    <header class="jenn-admin-status__header">
      <span class="material-symbols-outlined" aria-hidden="true">monitor_heart</span>
      <div>
        <h2>Jenn Admin Status</h2>
        <p>Persistent extension skeleton, default off.</p>
      </div>
    </header>

    <dl class="jenn-admin-status__facts">
      <div>
        <dt>Extension</dt>
        <dd>jenn.admin.status</dd>
      </div>
      <div>
        <dt>Runtime</dt>
        <dd>not registered</dd>
      </div>
      <div>
        <dt>Writes</dt>
        <dd>disabled</dd>
      </div>
    </dl>
  </section>
</template>

<script setup>
defineOptions({
  name: 'JennAdminStatusView'
});
</script>

<style scoped>
.jenn-admin-status {
  display: grid;
  gap: 16px;
}

.jenn-admin-status__header {
  align-items: center;
  display: flex;
  gap: 12px;
}

.jenn-admin-status__facts {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.jenn-admin-status__facts div {
  border: 1px solid var(--border-color, #d8dee8);
  border-radius: 6px;
  padding: 12px;
}

.jenn-admin-status__facts dt {
  color: var(--text-muted, #657083);
  font-size: 12px;
}

.jenn-admin-status__facts dd {
  margin: 4px 0 0;
}
</style>
