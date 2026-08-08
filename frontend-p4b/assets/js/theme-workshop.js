"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const store = window.XinbanThemeStore;
  const api = window.XinbanThemes;
  const adapter = window.XinbanTavernThemes;
  const gateway = window.XinbanThemeGateway;
  const preview = document.querySelector("[data-theme-preview]");
  const status = document.querySelector("[data-theme-status]");
  if (!store || !api || !adapter || !gateway || !preview) return;
  let draft = store.getActive();
  let selectedThemeId = draft.id;
  let pendingImport = null;
  let assetDecisionPending = false;
  let renderFrame = 0;
  const message = value => { if (status) status.textContent = value; };
  const editable = theme => JSON.parse(JSON.stringify(theme));
  const updateThemeNames = () => { const previewName=document.querySelector("[data-theme-preview-name]"),activeName=document.querySelector("[data-theme-active-name]"); if(previewName)previewName.textContent=draft.name; if(activeName)activeName.textContent=store.getActive().name; };
  const gatewayHeaders = () => { const token = window.AppConfig?.getProviderConfig?.().auth?.token; return token ? { Authorization: `Bearer ${token}` } : {}; };
  const gatewayRequest = async (path, options = {}) => { const config = window.AppConfig?.getProviderConfig?.() || {}; const url = gateway.resolveGatewayUrl(path, { baseUrl: config.baseUrl, locationRef: window.location }); const response = await fetch(url, { ...options, headers: { ...gatewayHeaders(), ...(options.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error?.message || `请求失败（${response.status}）`); return payload; };
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
      updateThemeNames();
    } catch (error) { message(error.message || "主题预览失败"); }
  };
  const render = () => { if (!renderFrame) renderFrame = requestAnimationFrame(renderNow); };
  const setCurrentWorkshopTheme = theme => { draft=editable(theme); selectedThemeId=draft.id; refreshForm(); render(); };
  const update = mutator => { const next = editable(draft); mutator(next); draft = next; render(); };
  const showImportDifference = converted => {
    const before = store.getActive(), after = converted.theme; const beforeSwatch = document.querySelector("[data-theme-before-swatch]"), afterSwatch = document.querySelector("[data-theme-after-swatch]");
    const paint = (node, theme) => { if (!node) return; node.style.setProperty("--diff-bg",theme.tokens.colorBg); node.style.setProperty("--diff-card",theme.tokens.cardBg); node.style.setProperty("--diff-user",theme.tokens.chatUserBubbleBg); node.style.setProperty("--diff-assistant",theme.tokens.chatAssistantBubbleBg); };
    paint(beforeSwatch,before); paint(afterSwatch,after); const modules=converted.report.modules||[]; const count=converted.report.counts.changedTokens||0;
    document.querySelector("[data-theme-import-changes]").textContent = modules.length ? `即将改变：${modules.join("、")}（${count} 个主题变量）${count < 3 ? "。可识别内容较少，应用后变化可能不明显。" : "。"}` : "可识别内容较少，应用后变化可能不明显。";
  };
  const presets = store.getPresets();
  const presetRoot = document.querySelector("[data-theme-presets]");
  presets.forEach(theme => {
    const button = document.createElement("button"); button.type = "button"; button.className = "theme-preset";
    button.textContent = theme.name; button.style.setProperty("--preset-a", theme.tokens.colorPrimary); button.style.setProperty("--preset-b", theme.tokens.colorBg);
    button.addEventListener("click", () => { setCurrentWorkshopTheme(theme); message(`正在预览「${theme.name}」`); }); presetRoot.append(button);
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
      const selected = selectedThemeId === draft.id ? draft : store.getThemeById(selectedThemeId); if (!selected) throw new Error("当前预览主题不存在，请重新选择");
      draft = store.applyTheme(selected, { persist: true, applyBackground: true }); selectedThemeId=draft.id; updateThemeNames();
      const active=store.getActive(),variables=api.cssVariables(active),rootStyle=document.documentElement.style;
      const selfCheck=active.name===draft.name&&rootStyle.getPropertyValue("--xb-chat-assistant-bubble-bg")===variables["--xb-chat-assistant-bubble-bg"]&&rootStyle.getPropertyValue("--xb-chat-user-bubble-bg")===variables["--xb-chat-user-bubble-bg"];
      message(selfCheck ? `已应用：${draft.name}。聊天页也会同步生效。` : "主题没有正确写入，请刷新重试。");
    } catch (error) { message(error.message || "主题应用失败"); }
  });
  document.querySelector("[data-theme-reset-soft]")?.addEventListener("click", () => {
    pendingImport = null; assetDecisionPending = false; draft = editable(api.DEFAULT_THEME); draft = store.applyTheme(draft, { persist: true, applyBackground: false }); selectedThemeId=draft.id;
    document.querySelector("[data-theme-import-review]").hidden = true; refreshForm(); render(); message("已恢复柔和紫雾默认，聊天页也会同步生效。");
  });
  document.querySelector("[data-theme-export]")?.addEventListener("click", () => {
    const blob = new Blob([`${JSON.stringify(store.exportTheme(draft), null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${draft.name.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-") || "xinban-theme"}.json`; link.click(); URL.revokeObjectURL(link.href); message("主题 JSON 已导出");
  });
  document.querySelector("[data-theme-import]")?.addEventListener("change", async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      adapter.assertImportSize(file.size); const kind = adapter.detectImportFileKind(file.name,file.type); const extension = kind === "unknown" ? "" : `.${kind}`;
      let converted;
      let format;
      if (extension === ".json") {
        const json = JSON.parse(await file.text()); format = adapter.detectThemeFormat(json);
        if (format === "xinban") converted = { ok: true, theme: api.normalizeTheme(json.theme), report: { format, recognized: ["小窝主题 v1"], ignored: [], blocked: [], assets: [], counts: { recognized: 1, ignored: 0, blocked: 0, externalImages: 0 } } };
        else if (format === "sillytavern") converted = adapter.convertSillyTavernTheme(json, { filename: file.name });
        else converted = adapter.convertExternalTheme(json, file.name);
      } else {
        let text;
        if (extension === ".docx") { const body = new FormData(); body.append("file", file); text = (await gatewayRequest("/api/theme/import/extract", { method: "POST", body })).data.text; }
        else if ([".txt", ".css"].includes(extension)) text = await file.text();
        else throw new Error("只支持 JSON、DOCX、TXT、CSS 美化文件");
        converted = adapter.convertStyleText(text, file.name); format = converted.report.format;
      }
      pendingImport = converted; setCurrentWorkshopTheme(converted.theme);
      const labels = { xinban: "小窝主题 JSON", sillytavern: "酒馆美化 JSON", external: "外部主题 JSON", unknown: "未知外部 JSON", "echoes-css": "Echoes 美化 CSS", css: "CSS/TXT 美化" };
      const review = document.querySelector("[data-theme-import-review]"); review.hidden = false;
      document.querySelector("[data-theme-import-format]").textContent = `检测到：${labels[converted.report.format] || labels[format]}`;
      const counts = converted.report.counts; document.querySelector("[data-theme-import-report]").textContent = `已识别 ${counts.recognized || 0} 项；已转换 ${counts.changedTokens || counts.recognized || 0} 个变量；已忽略 ${counts.ignored || 0} 项（外部图片 ${counts.externalImages || 0}）；已拦截 ${counts.blocked || 0} 项。当前只在预览，尚未加入主题库。`;
      showImportDifference(converted);
      const assetPanel = document.querySelector("[data-theme-assets]"); const assetList = document.querySelector("[data-theme-asset-list]"); assetList.replaceChildren();
      const assets = converted.report.assets || []; assetPanel.hidden = !assets.length; assetDecisionPending = Boolean(assets.length);
      for (const asset of assets) { const label = document.createElement("label"); label.className = "theme-asset-item"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = true; checkbox.dataset.assetId = asset.id; const copy = document.createElement("span"); const title = document.createElement("strong"); title.textContent = asset.kind; let domain = "外部地址"; try { domain = new URL(asset.sourceUrl).hostname; } catch {} copy.append(title, document.createTextNode(`${domain} · ${asset.selector}`)); label.append(checkbox, copy); assetList.append(label); }
      message(`正在预览转换结果「${draft.name}」。`);
    }
    catch (error) { const extension=file.name.toLowerCase().match(/\.[^.]+$/u)?.[0]||"未知"; let details=""; try { if([".txt",".css"].includes(extension)){const text=await file.text();const info=adapter.inspectStyleText(text);details=` 类型 ${extension}，读取 ${info.textLength} 字，Echoes=${info.echoes?"是":"否"}，CSS块=${info.hasBraces?"是":"否"}。`;}} catch {} message(`${error.message || "主题包导入失败"}。${details}`); }
    finally { event.target.value = ""; }
  });
  document.querySelector("[data-theme-import-confirm]")?.addEventListener("click", () => {
    if (!pendingImport) return;
    if (assetDecisionPending) { message("请先选择“本地化导入选中素材”或“跳过图片”。"); return; }
    const importedTheme=store.importTheme({ type: "xinban-theme", themeVersion: 1, theme: pendingImport.theme }); pendingImport = null; assetDecisionPending = false; setCurrentWorkshopTheme(importedTheme);
    document.querySelector("[data-theme-import-review]").hidden = true; message(`已加入主题库，当前正在预览：${draft.name}`);
  });
  document.querySelector("[data-theme-import-cancel]")?.addEventListener("click", () => {
    pendingImport = null; assetDecisionPending = false; setCurrentWorkshopTheme(store.getActive()); document.querySelector("[data-theme-import-review]").hidden = true; message("已取消外部主题导入。");
  });
  document.querySelector("[data-theme-assets-skip]")?.addEventListener("click", () => { if (!pendingImport) return; assetDecisionPending = false; document.querySelector("[data-theme-assets]").hidden = true; message("已跳过外部图片，只保留颜色与安全样式。"); });
  document.querySelector("[data-theme-assets-localize]")?.addEventListener("click", async () => {
    if (!pendingImport) return; const selected = new Set([...document.querySelectorAll("[data-asset-id]:checked")].map(input => input.dataset.assetId));
    const assets = (pendingImport.report.assets || []).filter(asset => selected.has(asset.id)); if (!assets.length) { message("请至少选择一张素材，或点击跳过图片。"); return; }
    try {
      const payload = await gatewayRequest("/api/theme/assets/localize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assets: assets.map(({ id, sourceUrl, kind }) => ({ id, sourceUrl, kind })) }) });
      const fields = { backgroundImage: "backgroundImage", bubbleUserDecoration: "userBubbleDecoration", bubbleAssistantDecoration: "assistantBubbleDecoration", bubbleDecoration: "assistantBubbleDecoration", avatarFrame: "avatarFrame", inputDecoration: "inputDecoration", headerDecoration: "headerDecoration", decorativeAsset: "decorativeAsset", navIcon: "navIcon" };
      const next = editable(pendingImport.theme); for (const localized of payload.data.localized || []) { const field = fields[localized.kind]; if (field && !next.assets[field]) next.assets[field] = localized.localUrl; }
      pendingImport.theme = api.normalizeTheme(next); draft = editable(pendingImport.theme); assetDecisionPending = false; document.querySelector("[data-theme-assets]").hidden = true; refreshForm(); render(); message(`已本地化 ${payload.data.localized?.length || 0} 张；失败 ${payload.data.failed?.length || 0} 张。失败素材不会应用。`);
    } catch (error) { message(error.message || "素材本地化失败，颜色主题仍可跳过图片后导入。"); }
  });
  const tavernTemplate = { name: "我的酒馆美化", main_text_color: "rgba(52,43,69,1)", blur_tint_color: "rgba(255,255,255,0.72)", user_mes_blur_tint_color: "rgba(210,190,255,0.72)", bot_mes_blur_tint_color: "rgba(255,255,255,0.78)", shadow_color: "rgba(42,24,74,0.2)", shadow_width: 8, font_scale: 1, chat_width: 78, custom_css: "" };
  const templateText = `${JSON.stringify(tavernTemplate, null, 2)}\n`; const templateNode = document.querySelector("[data-tavern-template]"); if (templateNode) templateNode.textContent = templateText;
  document.querySelector("[data-template-copy]")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(templateText); message("酒馆 JSON 模板已复制。"); } catch { message("复制失败，请手动选择模板文本。"); } });
  document.querySelector("[data-template-download]")?.addEventListener("click", () => { const blob = new Blob([templateText], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "xinban-tavern-theme-template.json"; link.click(); URL.revokeObjectURL(link.href); });
  refreshForm(); render();
});
