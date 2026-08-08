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
  const slotLabels = Object.freeze({ pageBackground: "页面背景", chatHeaderDecor: "聊天顶栏装饰", userBubbleDecor: "用户气泡装饰", assistantBubbleDecor: "沉气泡装饰", avatarFrame: "头像框", inputDecor: "输入栏装饰", homeCardDecor: "首页卡片装饰", navAccent: "底栏点缀" });
  const kindDetails = Object.freeze({
    backgroundImage: ["页面背景", "background", "pageBackground"], headerDecoration: ["顶栏装饰", "header", "chatHeaderDecor"],
    bubbleUserDecoration: ["用户气泡装饰", "bubble", "userBubbleDecor"], bubbleAssistantDecoration: ["沉气泡装饰", "bubble", "assistantBubbleDecor"], bubbleDecoration: ["气泡装饰", "bubble", "assistantBubbleDecor"],
    avatarFrame: ["头像框", "avatar", "avatarFrame"], inputDecoration: ["输入栏装饰", "input", "inputDecor"], navIcon: ["底栏点缀", "nav", "navAccent"], decorativeAsset: ["其他素材", "other", "homeCardDecor"]
  });
  const safeAssetImage = value => /^\/api\/theme\/assets\/(?:preview\/)?[0-9a-f-]{36}$/iu.test(value || "") ? gateway.resolveGatewayUrl(value, { baseUrl: window.AppConfig?.getProviderConfig?.().baseUrl, locationRef: window.location }) : "";
  const assetDomain = asset => { try { return new URL(asset.sourceUrl).hostname; } catch { return "未知来源"; } };
  const shortSelector = value => { const text=String(value||"").replace(/\s+/gu," ").trim(); return text.length>64?`${text.slice(0,61)}…`:text||"未识别选择器"; };
  const previewFailureText = reason => ({ THEME_ASSET_CONTENT_TYPE_INVALID:"图片格式不支持",THEME_ASSET_MAGIC_INVALID:"图片格式不支持",THEME_ASSET_TOO_LARGE:"图片过大",THEME_ASSET_TOTAL_TOO_LARGE:"图片过大",THEME_ASSET_SSRF_BLOCKED:"来源不安全",THEME_ASSET_SCHEME_FORBIDDEN:"来源不安全",THEME_ASSET_TIMEOUT:"下载超时" }[reason]||"无法生成安全预览");
  const assignAssetSlot = (asset, slotKey) => {
    if (!asset.localUrl || !safeAssetImage(asset.localUrl)) { message("请先本地化后再放入槽位。"); return; }
    const next=editable(pendingImport?.theme||draft); next.visualSlots=next.visualSlots||editable(api.DEFAULT_THEME.visualSlots); next.visualSlots[slotKey].url=asset.localUrl; next.visualSlots[slotKey].enabled=false; next.visualSlots.enabledByUser=false;
    if(pendingImport) pendingImport.theme=api.normalizeTheme(next); draft=editable(api.normalizeTheme(next)); refreshForm(); render(); message(`已放入${slotLabels[slotKey]}，默认关闭；应用主题前可在装饰槽位设置中开启。`);
  };
  const openAssetPreview = asset => {
    const dialog=document.querySelector("[data-asset-preview-dialog]"),image=dialog?.querySelector("[data-asset-preview-image]"); const src=safeAssetImage(asset.localUrl||asset.previewUrl);
    if(!dialog||!image||!src){message("请先生成安全预览。");return;} image.src=src; dialog.dataset.assetId=asset.id;
    dialog.querySelector("[data-asset-preview-kind]").textContent=(kindDetails[asset.kind]||kindDetails.decorativeAsset)[0]; dialog.querySelector("[data-asset-preview-selector]").textContent=shortSelector(asset.selector); dialog.querySelector("[data-asset-preview-domain]").textContent=assetDomain(asset); dialog.querySelector("[data-asset-preview-localized]").textContent=asset.localUrl?"已本地化":"仅临时预览"; dialog.showModal();
  };
  const renderAssetCards = () => {
    const root=document.querySelector("[data-theme-asset-list]"); if(!root)return; root.replaceChildren(); const assets=pendingImport?.report?.assets||[];
    const filter=document.querySelector("[data-asset-filter]")?.value||"all",sort=document.querySelector("[data-asset-sort]")?.value||"kind";
    const filtered=assets.filter(asset=>filter==="all"||(filter==="auto"&&Boolean((kindDetails[asset.kind]||[])[2]))||(filter==="failed"&&asset.previewStatus==="failed")||(kindDetails[asset.kind]||kindDetails.decorativeAsset)[1]===filter);
    filtered.sort((a,b)=>sort==="preview"?Number(Boolean(b.previewUrl))-Number(Boolean(a.previewUrl)):sort==="selected"?Number(Boolean(b.selected))-Number(Boolean(a.selected)):sort==="source"?(a.sourceIndex||0)-(b.sourceIndex||0):String((kindDetails[a.kind]||kindDetails.decorativeAsset)[1]).localeCompare(String((kindDetails[b.kind]||kindDetails.decorativeAsset)[1])));
    let group="";
    for(const asset of filtered){const detail=kindDetails[asset.kind]||kindDetails.decorativeAsset;if(detail[0]!==group){group=detail[0];const heading=document.createElement("h4");heading.className="theme-asset-group";heading.textContent=group;root.append(heading);}
      const card=document.createElement("article");card.className="theme-asset-card";card.dataset.assetKind=detail[1];
      const thumb=document.createElement("button");thumb.type="button";thumb.className="theme-asset-thumb";thumb.setAttribute("aria-label","放大预览");const src=safeAssetImage(asset.localUrl||asset.previewUrl);if(src){const img=document.createElement("img");img.src=src;img.alt="安全素材缩略图";img.loading="lazy";thumb.append(img);thumb.addEventListener("click",()=>openAssetPreview(asset));}else{thumb.textContent=asset.previewStatus==="failed"?"预览失败":"待预览";}
      const copy=document.createElement("div");copy.className="theme-asset-copy";const title=document.createElement("strong");title.textContent=detail[0];const selector=document.createElement("span");selector.textContent=shortSelector(asset.selector);const domain=document.createElement("small");domain.textContent=assetDomain(asset);const state=document.createElement("em");state.textContent=asset.localUrl?"已本地化":asset.previewStatus==="failed"?`预览失败：${previewFailureText(asset.previewReason)}`:asset.previewUrl?"已预览":"待预览";copy.append(title,selector,domain,state);
      const choose=document.createElement("label");choose.className="theme-asset-check";const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=asset.selected!==false;checkbox.dataset.assetId=asset.id;checkbox.addEventListener("change",()=>{asset.selected=checkbox.checked;});choose.append(checkbox,document.createTextNode("选择"));
      const actions=document.createElement("div");actions.className="theme-asset-card-actions";const previewButton=document.createElement("button");previewButton.type="button";previewButton.textContent=src?"放大预览":"生成预览";previewButton.addEventListener("click",()=>src?openAssetPreview(asset):previewAssets([asset]));
      const slot=document.createElement("select");slot.setAttribute("aria-label","用于槽位");const empty=document.createElement("option");empty.value="";empty.textContent="用于槽位…";slot.append(empty);for(const [key,label] of Object.entries(slotLabels)){const option=document.createElement("option");option.value=key;option.textContent=label;slot.append(option);}slot.disabled=!asset.localUrl;slot.addEventListener("change",()=>{if(slot.value)assignAssetSlot(asset,slot.value);slot.value="";});actions.append(previewButton,slot);card.append(thumb,copy,choose,actions);root.append(card);
    }
    if(!filtered.length){const empty=document.createElement("p");empty.className="theme-asset-empty";empty.textContent="当前筛选下没有素材。";root.append(empty);}
  };
  const previewAssets = async assets => {
    if(!pendingImport||!assets.length)return; for(const asset of assets){asset.previewStatus="loading";} renderAssetCards(); message(`正在生成安全预览 0/${assets.length}…`);
    try{const payload=await gatewayRequest("/api/theme/assets/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({assets:assets.map(({id,sourceUrl,kind,selector,property})=>({id,sourceUrl,kind,selector,property}))})});
      for(const item of payload.data.items||[]){const asset=assets.find(candidate=>candidate.id===item.id);if(asset){asset.previewUrl=item.previewUrl;asset.previewStatus="ready";}}
      for(const item of payload.data.failed||[]){const asset=assets.find(candidate=>candidate.id===item.id);if(asset){asset.previewStatus="failed";asset.previewReason=item.reason;}}
      renderAssetCards();message(`安全预览完成：已生成 ${(payload.data.items||[]).length}/${assets.length}，失败 ${(payload.data.failed||[]).length}。`);
    }catch(error){for(const asset of assets)asset.previewStatus="failed";renderAssetCards();message(error.message||"安全预览请求失败");}
  };
  const renderSlotEditor = () => {
    const root = document.querySelector("[data-theme-slot-editor]"); if (!root) return;
    root.replaceChildren(); const assets = draft.assetLibrary || [];
    for (const [key, labelText] of Object.entries(slotLabels)) {
      const slot = draft.visualSlots?.[key] || {}; const row = document.createElement("div"); row.className = "theme-slot-row";
      const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = slot.enabled !== false; toggle.setAttribute("aria-label", `${labelText}显示`);
      const label = document.createElement("span"); label.textContent = labelText;
      const select = document.createElement("select"); const empty = document.createElement("option"); empty.value = ""; empty.textContent = "未选择"; select.append(empty);
      for (const asset of assets) { const option = document.createElement("option"); option.value = asset.url; option.textContent = asset.kind; option.selected = asset.url === slot.url; select.append(option); }
      const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "清除";
      toggle.addEventListener("change", () => update(next => { next.visualSlots.enabledByUser = true; next.visualSlots[key].enabled = toggle.checked; next.migratedVisualSlotsSafe = true; }));
      select.addEventListener("change", () => update(next => { next.visualSlots[key].url = select.value; }));
      clear.addEventListener("click", () => update(next => { next.visualSlots[key].url = ""; }));
      row.append(toggle, label, select, clear); root.append(row);
    }
  };
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
    renderSlotEditor();
  };
  const renderNow = () => {
    renderFrame = 0;
    try {
      draft = api.normalizeTheme(draft);
      for (const [key, value] of Object.entries(api.cssVariables(draft))) preview.style.setProperty(key, value);
      const bg = draft.assets.backgroundImage; preview.style.setProperty("--theme-background-image", bg ? `url(${JSON.stringify(bg)})` : "none");
      updateThemeNames();
      renderSlotEditor();
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
      const directBackground = draft.assets.backgroundImage || draft.assets.chatBackgroundImage || draft.assets.homeBackgroundImage;
      const needsBackgroundConfirmation = directBackground && !/^\/api\/theme\/assets\//u.test(directBackground);
      if (needsBackgroundConfirmation && !window.confirm("这个主题包含背景资源，要一起覆盖原背景吗？")) {
        const next=editable(draft); next.assets.backgroundImage=""; next.assets.chatBackgroundImage=""; next.assets.homeBackgroundImage=""; next.visualSlots.pageBackground.url=""; draft=next;
      }
      const selected = selectedThemeId === draft.id ? draft : store.getThemeById(selectedThemeId); if (!selected) throw new Error("当前预览主题不存在，请重新选择");
      draft = store.applyTheme(selected, { persist: true, applyBackground: true }); selectedThemeId=draft.id; updateThemeNames();
      const active=store.getActive(),variables=api.cssVariables(active),rootStyle=document.documentElement.style;
      const selfCheck=active.name===draft.name&&rootStyle.getPropertyValue("--xb-chat-assistant-bubble-bg")===variables["--xb-chat-assistant-bubble-bg"]&&rootStyle.getPropertyValue("--xb-chat-user-bubble-bg")===variables["--xb-chat-user-bubble-bg"];
      const slotCount=Object.values(draft.visualSlots||{}).filter(slot=>slot.enabled&&slot.url).length;
      message(selfCheck ? `已应用：${draft.name}（${slotCount} 个装饰槽位）。聊天页和首页会同步生效。` : "主题没有正确写入，请刷新重试。");
    } catch (error) { message(error.message || "主题应用失败"); }
  });
  document.querySelector("[data-theme-reset-soft]")?.addEventListener("click", () => {
    pendingImport = null; assetDecisionPending = false; draft = editable(api.DEFAULT_THEME); draft = store.applyTheme(draft, { persist: true, applyBackground: false }); selectedThemeId=draft.id;
    document.querySelector("[data-theme-import-review]").hidden = true; refreshForm(); render(); message("已恢复柔和紫雾默认，聊天页也会同步生效。");
  });
  document.querySelector("[data-theme-disable-slots]")?.addEventListener("click", () => {
    const next=editable(draft); next.visualSlots=next.visualSlots||editable(api.DEFAULT_THEME.visualSlots); next.visualSlots.enabledByUser=true;
    for(const key of Object.keys(slotLabels)) next.visualSlots[key].enabled=false;
    next.migratedVisualSlotsSafe=true; draft=store.applyTheme(next,{persist:true,applyBackground:false}); selectedThemeId=draft.id; refreshForm(); render(); message("已只保留颜色，并关闭全部图片装饰。聊天页会立即恢复安全主题层。");
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
      const assetPanel = document.querySelector("[data-theme-assets]"); const assets = converted.report.assets || []; assets.forEach((asset,index)=>{asset.selected=true;asset.sourceIndex=index;asset.previewStatus="pending";}); assetPanel.hidden = !assets.length; assetDecisionPending = Boolean(assets.length); renderAssetCards();
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
  document.querySelector("[data-assets-preview-selected]")?.addEventListener("click",()=>previewAssets((pendingImport?.report?.assets||[]).filter(asset=>asset.selected!==false&&!asset.previewUrl)));
  document.querySelector("[data-assets-preview-all]")?.addEventListener("click",()=>previewAssets((pendingImport?.report?.assets||[]).filter(asset=>!asset.previewUrl)));
  document.querySelector("[data-asset-filter]")?.addEventListener("change",renderAssetCards); document.querySelector("[data-asset-sort]")?.addEventListener("change",renderAssetCards);
  document.querySelector("[data-theme-assets-localize]")?.addEventListener("click", async () => {
    if (!pendingImport) return; const assets = (pendingImport.report.assets || []).filter(asset => asset.selected!==false); if (!assets.length) { message("请至少选择一张素材，或点击跳过图片。"); return; }
    try {
      const payload = await gatewayRequest("/api/theme/assets/localize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assets: assets.map(({ id, sourceUrl, kind }) => ({ id, sourceUrl, kind })) }) });
      const fields = { backgroundImage: "backgroundImage", bubbleUserDecoration: "userBubbleDecoration", bubbleAssistantDecoration: "assistantBubbleDecoration", bubbleDecoration: "assistantBubbleDecoration", avatarFrame: "avatarFrame", inputDecoration: "inputDecoration", headerDecoration: "headerDecoration", decorativeAsset: "decorativeAsset", navIcon: "navIcon" };
      const slots = { backgroundImage: "pageBackground", bubbleUserDecoration: "userBubbleDecor", bubbleAssistantDecoration: "assistantBubbleDecor", bubbleDecoration: "assistantBubbleDecor", avatarFrame: "avatarFrame", inputDecoration: "inputDecor", headerDecoration: "chatHeaderDecor", decorativeAsset: "homeCardDecor", navIcon: "navAccent" };
      const next = editable(pendingImport.theme); next.assetLibrary = Array.isArray(next.assetLibrary) ? next.assetLibrary : []; next.visualSlots = next.visualSlots || editable(api.DEFAULT_THEME.visualSlots); next.visualSlots.enabledByUser=false;
      const applied = new Set();
      for (const localized of payload.data.localized || []) {
        const field = fields[localized.kind]; if (field && !next.assets[field]) next.assets[field] = localized.localUrl;
        next.assetLibrary.push({ id: localized.id, kind: localized.kind, url: localized.localUrl });
        const slot = slots[localized.kind]; if (slot && !next.visualSlots[slot].url) { next.visualSlots[slot].url = localized.localUrl; next.visualSlots[slot].enabled=false; applied.add(slot); }
        const sourceAsset=assets.find(asset=>asset.id===localized.sourceId);if(sourceAsset){sourceAsset.localUrl=localized.localUrl;sourceAsset.status="localized";}
      }
      for(const failed of payload.data.failed||[]){const sourceAsset=assets.find(asset=>asset.id===failed.sourceId);if(sourceAsset){sourceAsset.status="failed";sourceAsset.previewReason=failed.reason;}}
      pendingImport.theme = api.normalizeTheme(next); pendingImport.report.appliedSlots = [...applied]; draft = editable(pendingImport.theme); assetDecisionPending = false; refreshForm(); render(); renderAssetCards();
      const names=[...applied].map(key=>slotLabels[key]).join("、")||"无"; const savedOnly=Math.max(0,(payload.data.localized?.length||0)-applied.size);
      message(`已本地化 ${payload.data.localized?.length || 0} 张；已放入视觉槽位（默认关闭）：${names}；另有 ${savedOnly} 张只保存到素材库。失败 ${payload.data.failed?.length || 0} 张。`);
    } catch (error) { message(error.message || "素材本地化失败，颜色主题仍可跳过图片后导入。"); }
  });
  document.querySelector("[data-asset-preview-close]")?.addEventListener("click",()=>document.querySelector("[data-asset-preview-dialog]")?.close());
  document.querySelector("[data-asset-preview-toggle]")?.addEventListener("click",()=>{const dialog=document.querySelector("[data-asset-preview-dialog]"),asset=(pendingImport?.report?.assets||[]).find(item=>item.id===dialog?.dataset.assetId);if(asset){asset.selected=asset.selected===false;renderAssetCards();dialog.close();}});
  document.querySelectorAll("[data-preview-slot]").forEach(button=>button.addEventListener("click",()=>{const dialog=document.querySelector("[data-asset-preview-dialog]"),asset=(pendingImport?.report?.assets||[]).find(item=>item.id===dialog?.dataset.assetId);if(asset)assignAssetSlot(asset,button.dataset.previewSlot);}));
  const tavernTemplate = { name: "我的酒馆美化", main_text_color: "rgba(52,43,69,1)", blur_tint_color: "rgba(255,255,255,0.72)", user_mes_blur_tint_color: "rgba(210,190,255,0.72)", bot_mes_blur_tint_color: "rgba(255,255,255,0.78)", shadow_color: "rgba(42,24,74,0.2)", shadow_width: 8, font_scale: 1, chat_width: 78, custom_css: "" };
  const templateText = `${JSON.stringify(tavernTemplate, null, 2)}\n`; const templateNode = document.querySelector("[data-tavern-template]"); if (templateNode) templateNode.textContent = templateText;
  document.querySelector("[data-template-copy]")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(templateText); message("酒馆 JSON 模板已复制。"); } catch { message("复制失败，请手动选择模板文本。"); } });
  document.querySelector("[data-template-download]")?.addEventListener("click", () => { const blob = new Blob([templateText], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "xinban-tavern-theme-template.json"; link.click(); URL.revokeObjectURL(link.href); });
  refreshForm(); render(); if(store.lastVisualSlotsMigration) message("已为旧导入主题关闭自动装饰，避免影响布局；可在装饰槽位设置中手动开启。");
});
