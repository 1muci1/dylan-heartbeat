// 第一阶段仅保留页面级基础行为，不连接任何远程服务。
document.addEventListener("DOMContentLoaded", () => {
  const currentPage = document.body.dataset.page;
  document.querySelector(`[data-nav="${currentPage}"]`)?.classList.add("is-active");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // 本地 file:// 预览时可能无法注册，静默跳过即可。
    });
  }
});
