"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const store = window.XinbanThemeStore;
  const api = window.XinbanThemes;
  const preview = document.querySelector("[data-theme-preview]");
  const status = document.querySelector("[data-theme-status]");
  if (!store || !api || !preview) return;
  let draft = store.getActive();
  const message = value => { if (status) status.textContent = value; };
  const editable = theme => JSON.parse(JSON.stringify(theme));
  const hex = value => /^#[0-9a-f]{6}$/iu.test(value || "") ? value : "#8b6bb8";
  const refreshForm = () => {
    document.querySelectorAll("[data-theme-token]").forEach(input => {
      const value = draft.tokens[input.dataset.themeToken]; input.value = input.type === "color" ? hex(value) : value;
    });
    document.querySelectorAll("[data-theme-asset]").forEach(input => { input.value = draft.assets[input.dataset.themeAsset] || ""; });
    document.querySelectorAll("[data-theme-range]").forEach(input => { input.value = parseFloat(draft.tokens[input.dataset.themeRange]) || 0; });
    document.querySelectorAll("[data-theme-layout]").forEach(input => {
      const value = draft.layout[input.dataset.themeLayout]; input.value = input.dataset.scale ? Number(value) * Number(input.dataset.scale) : parseFloat(value);
    });
    const custom = document.querySelector("[data-theme-custom-css]"); if (custom) custom.value = draft.customCss || "";
    const customFont = document.querySelector("[data-theme-custom-font]"); if (customFont) customFont.value = ["system","rounded","serif","sans"].includes(draft.tokens.fontFamily) ? "" : draft.tokens.fontFamily;
  };
  const render = () => {
    try {
      draft = api.normalizeTheme(draft);
      for (const [key, value] of Object.entries(api.cssVariables(draft))) preview.style.setProperty(key, value);
      const bg = draft.assets.backgroundImage; preview.style.setProperty("--theme-background-image", bg ? `url(${JSON.stringify(bg)})` : "none");
      document.querySelector("[data-theme-preview-name]").textContent = draft.name;
    } catch (error) { message(error.message || "主题预览失败"); }
  };
  const update = mutator => { const next = editable(draft); mutator(next); draft = next; render(); };
  const presets = store.getPresets();
  const presetRoot = document.querySelector("[data-theme-presets]");
  presets.forEach(theme => {
    const button = document.createElement("button"); button.type = "button"; button.className = "theme-preset";
    button.textContent = theme.name; button.style.setProperty("--preset-a", theme.tokens.colorPrimary); button.style.setProperty("--preset-b", theme.tokens.colorBg);
    button.addEventListener("click", () => { draft = editable(theme); refreshForm(); render(); message(`正在预览「${theme.name}」`); }); presetRoot.append(button);
  });
  document.querySelectorAll("[data-theme-token]").forEach(input => input.addEventListener("input", () => update(next => { next.tokens[input.dataset.themeToken] = input.value; })));
  document.querySelectorAll("[data-theme-range]").forEach(input => input.addEventListener("input", () => update(next => { next.tokens[input.dataset.themeRange] = `${input.value}${input.dataset.unit || ""}`; })));
  document.querySelectorAll("[data-theme-layout]").forEach(input => input.addEventListener("input", () => update(next => { next.layout[input.dataset.themeLayout] = input.dataset.scale ? Number(input.value) / Number(input.dataset.scale) : `${input.value}${input.dataset.unit || ""}`; })));
  document.querySelectorAll("[data-theme-asset]").forEach(input => input.addEventListener("change", () => update(next => { next.assets[input.dataset.themeAsset] = input.value.trim(); })));
  document.querySelector("[data-theme-custom-font]")?.addEventListener("change", event => { if (event.target.value.trim()) update(next => { next.tokens.fontFamily = event.target.value.trim(); }); });
  document.querySelector("[data-theme-background-file]")?.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(?:png|jpeg|webp)$/u.test(file.type) || file.size > 2 * 1024 * 1024) {
      message("背景图仅支持 PNG、JPEG、WebP，且不能超过 2 MB。", true);
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => update(next => { next.assets.backgroundImage = String(reader.result || ""); }));
    reader.addEventListener("error", () => message("背景图读取失败。", true));
    reader.readAsDataURL(file);
  });
  document.querySelector("[data-theme-custom-css]")?.addEventListener("change", event => update(next => { next.customCss = event.target.value; }));
  document.querySelector("[data-theme-apply]")?.addEventListener("click", () => {
    try {
      const hasBackground = Object.values(draft.assets).some(Boolean);
      if (hasBackground && !window.confirm("这个主题包含背景或纹理资源，要一起覆盖主题背景吗？")) {
        draft = { ...editable(draft), assets: editable(api.DEFAULT_THEME.assets) };
      }
      draft = store.applyTheme(draft, { persist: true, applyBackground: true });
      message("主题已应用到本设备；头像与原聊天背景配置保持不变。");
    } catch (error) { message(error.message || "主题应用失败"); }
  });
  document.querySelector("[data-theme-export]")?.addEventListener("click", () => {
    const blob = new Blob([`${JSON.stringify(store.exportTheme(draft), null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${draft.name.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-") || "xinban-theme"}.json`; link.click(); URL.revokeObjectURL(link.href); message("主题 JSON 已导出");
  });
  document.querySelector("[data-theme-import]")?.addEventListener("change", async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { draft = editable(store.importTheme(JSON.parse(await file.text()))); refreshForm(); render(); message(`已导入「${draft.name}」并进入预览，尚未应用。`); }
    catch (error) { message(error.message || "主题包导入失败"); }
    finally { event.target.value = ""; }
  });
  refreshForm(); render();
});
