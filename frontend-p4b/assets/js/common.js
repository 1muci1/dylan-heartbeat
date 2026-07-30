"use strict";

((windowRef, documentRef, navigatorRef) => {
  const APP_VERSION = "v37";
  const SW_CACHE_NAME = "xinban-shell-v38-p4b";
  const CONTROLLER_REFRESH_GUARD = "p4b-sw-controller-refresh-v37";

  const refreshOnceForController = () => {
    try {
      if (windowRef.sessionStorage.getItem(CONTROLLER_REFRESH_GUARD) === "1") return false;
      windowRef.sessionStorage.setItem(CONTROLLER_REFRESH_GUARD, "1");
    } catch {
      if (windowRef.__p4bControllerRefreshDone) return false;
      windowRef.__p4bControllerRefreshDone = true;
    }
    windowRef.location.reload();
    return true;
  };

  const registerServiceWorker = () => {
    if (!navigatorRef?.serviceWorker) return Promise.resolve(null);
    navigatorRef.serviceWorker.addEventListener("controllerchange", refreshOnceForController);
    return navigatorRef.serviceWorker.register("./sw.js")
      .then(registration => {
        registration.update().catch(() => {});
        return registration;
      })
      .catch(() => null);
  };

  // 脚本加载后立即检查更新，避免等页面其他模块初始化完成才注册。
  registerServiceWorker();

  documentRef.addEventListener("DOMContentLoaded", () => {
    const currentPage = documentRef.body?.dataset.page;
    documentRef.querySelector(`[data-nav="${currentPage}"]`)?.classList.add("is-active");
  });

  windowRef.CompanionP4BShell = Object.freeze({
    APP_VERSION,
    SW_CACHE_NAME,
    CONTROLLER_REFRESH_GUARD,
    refreshOnceForController,
    registerServiceWorker
  });
})(window, document, navigator);
