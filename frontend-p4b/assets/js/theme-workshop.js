"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const store = window.XinbanThemeStore;
  const api = window.XinbanThemes;
  const adapter = window.XinbanTavernThemes;
  const preview = document.querySelector("[data-theme-preview]");
  const status = document.querySelector("[data-theme-status]");
  if (!store || !api || !preview) return;
  let draft = store.getActive();
  let pendingImport = null;
  let renderFrame = 0;
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
      const value = draft.layout[input.dataset.themeLayout];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else if (input.tagName === "SELECT") input.value = value;
      else input.value = input.dataset.scale ? Number(value) * Number(input.dataset.scale) : parseFloat(value);
    });
    const custom = document.querySelector("[data-theme-custom-css]"); if (custom) custom.value = draft.customCss || "";
    const customFont = document.querySelector("[data-theme-custom-font]"); if (customFont) customFont.value = ["system","rounded","serif","sans"].includes(draft.tokens.fontFamily) ? "" : draft.tokens.fontFamily;
  };
  const renderNow = () => {
    renderFrame = 0;
    try {
      draft = api.normalizeTheme(draft);
      for (const [key, value] of Object.entries(api.cssVariables(draft))) preview.style.setProperty(key, value);
      const bg = draft.assets.backgroundImage; preview.style.setProperty("--theme-background-image", bg ? `url(${JSON.stringify(bg)})` : "none");
      document.querySelector("[data-theme-preview-name]").textContent = draft.name;
    } catch (error) { message(error.message || "主题预览失败"); }
  };
  const render = () => { if (!renderFrame) renderFrame = requestAnimationFrame(renderNow); };
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
  document.querySelectorAll("[data-theme-layout]").forEach(input => input.addEventListener("input", () => update(next => {
    next.layout[input.dataset.themeLayout] = input.type === "checkbox" ? input.checked : input.tagName === "SELECT" ? input.value : input.dataset.scale ? Number(input.value) / Number(input.dataset.scale) : `${input.value}${input.dataset.unit || ""}`;
  })));
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
  document.querySelector("[data-theme-fix-readability]")?.addEventListener("click", () => {
    draft = editable(api.guardReadability(api.normalizeTheme({ ...editable(draft), layout: { ...draft.layout, readabilityGuard: true } })));
    refreshForm(); render(); message("已修复低对比颜色。");
  });
  document.querySelector("[data-theme-apply]")?.addEventListener("click", () => {
    try {
      if (pendingImport) { message("请先确认“转换并加入主题库”，再应用这个外部主题。"); return; }
      const hasBackground = Object.values(draft.assets).some(Boolean);
      if (hasBackground && !window.confirm("这个主题包含背景或纹理资源，要一起覆盖主题背景吗？")) {
        draft = { ...editable(draft), assets: editable(api.DEFAULT_THEME.assets) };
      }
      draft = store.applyTheme(draft, { persist: true, applyBackground: true });
      message("主题已应用，聊天页也会同步生效；头像与原聊天背景配置保持不变。");
    } catch (error) { message(error.message || "主题应用失败"); }
  });
  document.querySelector("[data-theme-reset-soft]")?.addEventListener("click", () => {
    pendingImport = null; draft = editable(api.DEFAULT_THEME); draft = store.applyTheme(draft, { persist: true, applyBackground: false });
    document.querySelector("[data-theme-import-review]").hidden = true; refreshForm(); render(); message("已恢复柔和紫雾默认，聊天页也会同步生效。");
  });
  document.querySelector("[data-theme-export]")?.addEventListener("click", () => {
    const blob = new Blob([`${JSON.stringify(store.exportTheme(draft), null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${draft.name.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-") || "xinban-theme"}.json`; link.click(); URL.revokeObjectURL(link.href); message("主题 JSON 已导出");
  });
  document.querySelector("[data-theme-import]")?.addEventListener("change", async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      adapter.assertImportSize(file.size);
      const json = JSON.parse(await file.text()); const format = adapter.detectThemeFormat(json);
      let converted;
      if (format === "xinban") converted = { ok: true, theme: api.normalizeTheme(json.theme), report: { format, recognized: ["小窝主题 v1"], ignored: [], blocked: [], counts: { recognized: 1, ignored: 0, blocked: 0, externalImages: 0 } } };
      else if (format === "sillytavern") converted = adapter.convertSillyTavernTheme(json, { filename: file.name });
      else converted = adapter.convertExternalTheme(json, file.name);
      pendingImport = converted; draft = editable(converted.theme); refreshForm(); render();
      const labels = { xinban: "小窝主题 JSON", sillytavern: "酒馆美化 JSON", external: "外部主题 JSON", unknown: "未知外部 JSON" };
      const review = document.querySelector("[data-theme-import-review]"); review.hidden = false;
      document.querySelector("[data-theme-import-format]").textContent = `检测到：${labels[converted.report.format] || labels[format]}`;
      const counts = converted.report.counts; document.querySelector("[data-theme-import-report]").textContent = `已识别 ${counts.recognized || 0} 项；已忽略 ${counts.ignored || 0} 项（外部图片 ${counts.externalImages || 0}）；已拦截 ${counts.blocked || 0} 项。当前只在预览，尚未加入主题库。`;
      message(`正在预览转换结果「${draft.name}」。`);
    }
    catch (error) { message(error.message || "主题包导入失败"); }
    finally { event.target.value = ""; }
  });
  document.querySelector("[data-theme-import-confirm]")?.addEventListener("click", () => {
    if (!pendingImport) return;
    draft = editable(store.importTheme({ type: "xinban-theme", themeVersion: 1, theme: pendingImport.theme })); pendingImport = null;
    document.querySelector("[data-theme-import-review]").hidden = true; refreshForm(); render(); message(`已转换并加入主题库「${draft.name}」，尚未应用。`);
  });
  document.querySelector("[data-theme-import-cancel]")?.addEventListener("click", () => {
    pendingImport = null; draft = store.getActive(); document.querySelector("[data-theme-import-review]").hidden = true; refreshForm(); render(); message("已取消外部主题导入。");
  });
  const tavernTemplate = { name: "我的酒馆美化", main_text_color: "rgba(52,43,69,1)", blur_tint_color: "rgba(255,255,255,0.72)", user_mes_blur_tint_color: "rgba(210,190,255,0.72)", bot_mes_blur_tint_color: "rgba(255,255,255,0.78)", shadow_color: "rgba(42,24,74,0.2)", shadow_width: 8, font_scale: 1, chat_width: 78, custom_css: "" };
  const templateText = `${JSON.stringify(tavernTemplate, null, 2)}\n`; const templateNode = document.querySelector("[data-tavern-template]"); if (templateNode) templateNode.textContent = templateText;
  document.querySelector("[data-template-copy]")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(templateText); message("酒馆 JSON 模板已复制。"); } catch { message("复制失败，请手动选择模板文本。"); } });
  document.querySelector("[data-template-download]")?.addEventListener("click", () => { const blob = new Blob([templateText], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "xinban-tavern-theme-template.json"; link.click(); URL.revokeObjectURL(link.href); });
  refreshForm(); render();
});
