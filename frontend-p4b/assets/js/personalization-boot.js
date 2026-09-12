"use strict";
(() => {
  const start=async()=>{
    const load=(present,src)=>present?Promise.resolve():new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=src;script.onload=resolve;script.onerror=reject;document.head.append(script);});
    try {
      await load(window.AppConfig?.getGatewayConnection,"/assets/js/data.js?v=v79-p4b-sync3");
      await load(window.XinbanThemes,"/assets/js/theme-store.js?v=v79-p4b-sync3");
      await load(window.CompanionUserPreferences,"/storage/user-preference-store.js?v=v79-p4b");
      await load(window.CompanionVoice,"/assets/js/voice-adapter.js?v=v79-p4b-bg1");
      await load(window.CompanionAppearance,"/assets/js/appearance.js?v=v79-p4b");
      await load(window.XinbanThemeGateway?.uploadThemeAsset,"/assets/js/theme-gateway.js?v=v79-p4b-sync6");
      await load(window.CompanionAvatarMigration,"/assets/js/avatar-migration.js?v=v79-p4b-sync5");
      await load(window.CompanionAvatarBackup,"/assets/js/avatar-backup.js?v=v79-p4b-sync8");
      await load(window.CompanionPersonalization,"/assets/js/personalization-sync.js?v=v79-p4b-sync8");
    } catch {
      const status=document.querySelector("[data-sync-status]");if(status)status.textContent="当前使用本地设置，恢复网络后可同步。";
    }
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
