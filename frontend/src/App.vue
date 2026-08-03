<template>
  <div class="app-shell">
    <header class="topbar">
      <router-link class="brand" to="/list">Open Dashboard</router-link>
      <nav>
        <router-link to="/list">仪表盘</router-link>
        <router-link to="/editor/1">编辑器</router-link>
        <router-link to="/reports">报告</router-link>
        <router-link to="/preview/1">预览</router-link>
        <a href="http://127.0.0.1:8765/dashboard-commercial.html" target="_blank" rel="noreferrer">
          高保参照
        </a>
      </nav>
    </header>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>
