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
  let selectedSlotKey = "pageBackground";
  let assetPickerTarget = { type:"region" };
  let selectedDesignPage = "chat";
  let selectedDesignRegion = "chat.page";
  let designPreviewTab = "chat";
  const DESIGN_DRAFT_KEY = "xinban-theme-design-draft-v1";
  const designHistory=[];const designFuture=[];let pendingHistory=null;let designPreviewFrame=0;
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
  const safeAssetImage = value => api.resolveThemeAssetUrl(value, { baseUrl: window.AppConfig?.getProviderConfig?.().baseUrl, locationRef: window.location });
  const kindLabel = kind => (kindDetails[kind] || kindDetails.decorativeAsset)[0];
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
      const slot = draft.visualSlots?.[key] || {}; const row = document.createElement("div"); row.className = `theme-slot-row${selectedSlotKey===key?" is-selected":""}`; row.dataset.slotKey=key;
      const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = slot.enabled !== false; toggle.setAttribute("aria-label", `${labelText}显示`);
      const label = document.createElement("span"); label.textContent = labelText;
      const currentAsset=assets.find(asset=>asset.url===slot.url),thumb=document.createElement("span");thumb.className="theme-slot-thumb checkerboard";if(currentAsset){const image=document.createElement("img");image.src=safeAssetImage(currentAsset.url);image.alt=`${labelText}当前素材`;thumb.append(image);}else thumb.textContent="无";
      const select = document.createElement("select");select.hidden=true;select.setAttribute("aria-hidden","true");const empty = document.createElement("option");empty.value="";select.append(empty);for(const asset of assets){const option=document.createElement("option");option.value=asset.url;option.selected=asset.url===slot.url;select.append(option);}
      const choose=document.createElement("button");choose.type="button";choose.textContent="选择素材";choose.addEventListener("click",()=>{selectedSlotKey=key;assetPickerTarget={type:"slot",key};renderDesignAssets();document.querySelector("[data-design-asset-picker]")?.showModal();});
      const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "清除";
      const controls=document.createElement("div");controls.className="theme-slot-controls";
      const addControl=(text,field,{min,max,step=1,scale=1,type="range",wide=false}={})=>{const control=document.createElement("label");control.className=`theme-slot-control${wide?" theme-slot-control--wide":""}`;control.append(document.createTextNode(text));const input=document.createElement("input");input.type=type;if(type==="range"){input.min=min;input.max=max;input.step=step;input.value=Number(slot[field]??0)*scale;}else{input.value=slot[field]||"";}input.dataset.slotControl=field;input.addEventListener("input",()=>update(next=>{next.visualSlots[key][field]=type==="range"?Number(input.value)/scale:input.value;}));control.append(input);controls.append(control);};
      addControl("水平", "x", {min:-100,max:100});addControl("垂直", "y", {min:-100,max:100});addControl("缩放", "scale", {min:25,max:300,scale:100});addControl("旋转", "rotation", {min:-180,max:180});addControl("透明度", "opacity", {min:0,max:100,scale:100});addControl("圆角", "radius", {min:0,max:50});addControl("边框", "borderWidth", {min:0,max:12});addControl("边框色", "borderColor", {type:"color"});addControl("阴影", "shadow", {type:"text",wide:true});
      toggle.addEventListener("change", () => update(next => { next.visualSlots.enabledByUser = true; next.visualSlots[key].enabled = toggle.checked; next.migratedVisualSlotsSafe = true; }));
      select.addEventListener("change", () => update(next => { next.visualSlots[key].url = select.value; }));
      clear.addEventListener("click", () => update(next => { next.visualSlots[key].url = ""; }));
      row.addEventListener("click",event=>{if(event.target.closest("input,select,button"))return;selectedSlotKey=key;render();});
      row.append(toggle,label,thumb,choose,select,clear,controls);root.append(row);
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
  const designRegion = key => editable(draft.customDesign?.regions?.[key] || api.DESIGN_REGION_DEFAULT);
  const ensureDesignRegion = (next,key) => { next.customDesign=next.customDesign||{version:1,regions:{}};next.customDesign.regions=next.customDesign.regions||{};next.customDesign.regions[key]=editable(next.customDesign.regions[key]||api.DESIGN_REGION_DEFAULT);return next.customDesign.regions[key]; };
  const renderDesignNavigation = () => {
    const pages=document.querySelector("[data-design-pages]"),regions=document.querySelector("[data-design-regions]");if(!pages||!regions)return;pages.replaceChildren();regions.replaceChildren();
    for(const [key,label] of Object.entries(api.DESIGN_PAGES)){const button=document.createElement("button");button.type="button";button.textContent=label;button.classList.toggle("is-active",key===selectedDesignPage);button.addEventListener("click",()=>{selectedDesignPage=key;selectedDesignRegion=Object.keys(api.DESIGN_REGIONS).find(region=>region.startsWith(`${key}.`))||selectedDesignRegion;designPreviewTab=["chat","home"].includes(key)?key:"generic";render();});pages.append(button);}
    for(const [key,label] of Object.entries(api.DESIGN_REGIONS).filter(([key])=>key.startsWith(`${selectedDesignPage}.`))){const button=document.createElement("button");button.type="button";button.textContent=label.split(" · ")[1];button.classList.toggle("is-active",key===selectedDesignRegion);button.addEventListener("click",()=>{selectedDesignRegion=key;render();});regions.append(button);}
  };
  const renderDesignForm = () => {
    const region=designRegion(selectedDesignRegion),name=document.querySelector("[data-design-region-name]");if(name)name.textContent=api.DESIGN_REGIONS[selectedDesignRegion]||"区域属性";
    const enabled=document.querySelector("[data-design-enabled]");if(enabled)enabled.checked=region.enabled===true;
    document.querySelectorAll("[data-design-field]").forEach(input=>{const value=region[input.dataset.designField];input.value=input.dataset.designScale?Number(value)*Number(input.dataset.designScale):value;});
    const image=region.image||api.DESIGN_IMAGE_DEFAULT;document.querySelectorAll("[data-design-image-field]").forEach(input=>{const value=image[input.dataset.designImageField];if(input.type==="checkbox")input.checked=value===true;else input.value=input.dataset.designScale?Number(value)*Number(input.dataset.designScale):value;});
    const current=document.querySelector("[data-design-current-asset]"),imageStatus=document.querySelector("[data-design-image-status]");if(current){current.replaceChildren();const asset=(draft.assetLibrary||[]).find(item=>item.url===image.url),src=asset&&safeAssetImage(asset.url);if(src){const img=document.createElement("img");img.src=src;img.alt="当前本地素材";img.addEventListener("load",()=>{if(imageStatus)imageStatus.textContent=`图片状态：✓ 已加载 · ${img.naturalWidth}×${img.naturalHeight}`;});img.addEventListener("error",()=>{if(imageStatus)imageStatus.textContent="图片状态：× 加载失败";});const text=document.createElement("span");text.textContent=`${kindLabel(asset.kind)} · ${asset.id.slice(0,8)}`;current.append(img,text);if(imageStatus)imageStatus.textContent="图片状态：加载中…";}else{current.textContent="未选择素材";if(imageStatus)imageStatus.textContent="图片状态：等待选择素材";}}
    syncDesignValues();
  };
  const positionMap=Object.freeze({center:"center",top:"center top",bottom:"center bottom",left:"left center",right:"right center","top-left":"left top","top-right":"right top","bottom-left":"left bottom","bottom-right":"right bottom",custom:"center"});
  const syncDesignValues=()=>{document.querySelectorAll(".design-value-input").forEach(number=>{const range=document.querySelector(`[data-design-control-id="${number.dataset.designMirror}"]`);if(range)number.value=range.value;});document.querySelectorAll("[data-design-value-for]").forEach(output=>{const input=document.querySelector(`[data-design-control-id="${output.dataset.designValueFor}"]`);if(!input)return;const value=Number(input.value),field=input.dataset.designImageField||input.dataset.designField;output.textContent=field==="scale"?`${(value/100).toFixed(2)}×`:field?.includes("opacity")||["opacity","shadow","glassOpacity"].includes(field)?`${Math.round(value)}%`:field?.includes("offset")?`${value>0?"+":""}${Math.round(value)}`:`${Math.round(value)}px`;});};
  const renderDesignPreview = () => {
    document.querySelectorAll("[data-design-preview-page]").forEach(page=>{page.hidden=page.dataset.designPreviewPage!==designPreviewTab;});document.querySelectorAll("[data-design-preview-tab]").forEach(button=>button.classList.toggle("is-active",button.dataset.designPreviewTab===designPreviewTab));
    const normalized=api.normalizeCustomDesign(draft.customDesign);document.querySelectorAll("[data-design-preview-region]").forEach(node=>{node.classList.toggle("is-design-selected",node.dataset.designPreviewRegion===selectedDesignRegion);node.dataset.designLabel=api.DESIGN_REGIONS[node.dataset.designPreviewRegion]?.split(" · ")[1]||"区域";const region=normalized.regions[node.dataset.designPreviewRegion];let layer=node.querySelector(":scope > .advanced-preview__image-layer");if(!layer){layer=document.createElement("span");layer.className="advanced-preview__image-layer";layer.setAttribute("aria-hidden","true");node.prepend(layer);}for(const property of ["background-image","background-color","color","border-color","border-width","border-radius","box-shadow","backdrop-filter","opacity","overflow"])node.style.removeProperty(property);layer.removeAttribute("style");layer.replaceChildren();if(!region?.enabled)return;node.style.backgroundColor=region.backgroundColor;node.style.color=region.textColor;node.style.borderColor=region.borderColor;node.style.borderWidth=`${region.borderWidth}px`;node.style.borderRadius=`${region.radius}px`;node.style.boxShadow=region.shadow?`0 10px 28px rgba(25,30,38,${region.shadow})`:"none";node.style.backdropFilter=`blur(${region.blur}px)`;node.style.opacity=String(region.opacity);node.style.overflow=region.image.clip?"hidden":"visible";const imageUrl=safeAssetImage(region.image.url);if(region.image.enabled&&imageUrl){layer.style.backgroundImage=`url(${JSON.stringify(imageUrl)})`;layer.style.backgroundSize=region.image.size==="original"?"auto":region.image.size==="fill"?"100% 100%":region.image.size;layer.style.backgroundPosition=positionMap[region.image.position]||"center";layer.style.backgroundRepeat=region.image.repeat;layer.style.mixBlendMode=region.image.blendMode;layer.style.opacity=String(region.image.opacity);layer.style.filter=`blur(${region.image.blur}px)`;layer.style.transform=`translate(${region.image.offsetX}px, ${region.image.offsetY}px) scale(${region.image.scale})`;layer.dataset.layer=region.image.layer;layer.style.pointerEvents=node.dataset.designPreviewRegion===selectedDesignRegion?"auto":"none";}}
    );syncDesignValues();
  };
  const renderAdvancedEditor=()=>{renderDesignNavigation();renderDesignForm();renderDesignPreview();};
  const renderDesignPreviewLive=()=>{if(designPreviewFrame)return;designPreviewFrame=requestAnimationFrame(()=>{designPreviewFrame=0;draft=editable(api.normalizeTheme(draft));const variables=api.cssVariables(draft);for(const [key,value] of Object.entries(variables))document.querySelector("[data-design-preview]")?.style.setProperty(key,value);renderDesignPreview();});};
  const renderNow = () => {
    renderFrame = 0;
    try {
      draft = api.normalizeTheme(draft);
      const variables=api.cssVariables(draft);for (const [key, value] of Object.entries(variables)){preview.style.setProperty(key, value);document.querySelector("[data-design-preview]")?.style.setProperty(key,value);}
      const bg = draft.assets.backgroundImage; preview.style.setProperty("--theme-background-image", bg ? `url(${JSON.stringify(bg)})` : "none");
      updateThemeNames();
      const selectedName=document.querySelector("[data-theme-selected-slot]");if(selectedName)selectedName.textContent=slotLabels[selectedSlotKey];
      document.querySelectorAll("[data-preview-layer]").forEach(layer=>layer.classList.toggle("is-selected",layer.dataset.previewLayer===selectedSlotKey));
      renderSlotEditor();
      renderAdvancedEditor();
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
  document.querySelector("[data-theme-reset-slot]")?.addEventListener("click",()=>update(next=>{Object.assign(next.visualSlots[selectedSlotKey],{x:0,y:0,scale:1,rotation:0,opacity:api.DEFAULT_THEME.visualSlots[selectedSlotKey].opacity,radius:api.DEFAULT_THEME.visualSlots[selectedSlotKey].radius,borderWidth:0,borderColor:"transparent",shadow:"none"});}));
  document.querySelectorAll("[data-preview-layer]").forEach(layer=>{
    layer.addEventListener("pointerdown",event=>{selectedSlotKey=layer.dataset.previewLayer;const startX=event.clientX,startY=event.clientY,slot=draft.visualSlots[selectedSlotKey],originX=slot.x||0,originY=slot.y||0;layer.setPointerCapture?.(event.pointerId);const move=moveEvent=>{const x=Math.max(-100,Math.min(100,originX+moveEvent.clientX-startX)),y=Math.max(-100,Math.min(100,originY+moveEvent.clientY-startY));update(next=>{next.visualSlots[selectedSlotKey].x=Math.round(x);next.visualSlots[selectedSlotKey].y=Math.round(y);});};const end=()=>{layer.removeEventListener("pointermove",move);layer.removeEventListener("pointerup",end);layer.removeEventListener("pointercancel",end);};layer.addEventListener("pointermove",move);layer.addEventListener("pointerup",end);layer.addEventListener("pointercancel",end);render();});
  });
  document.querySelectorAll("[data-open-advanced-editor]").forEach(button=>button.addEventListener("click",()=>{const panel=document.querySelector("[data-advanced-editor]");if(panel){panel.hidden=false;render();panel.scrollIntoView?.({behavior:"smooth",block:"start"});}}));
  document.querySelector("[data-close-advanced-editor]")?.addEventListener("click",()=>{document.querySelector("[data-advanced-editor]").hidden=true;});
  document.querySelectorAll("[data-design-preview-tab]").forEach(button=>button.addEventListener("click",()=>{designPreviewTab=button.dataset.designPreviewTab;render();}));
  const historySnapshot=()=>JSON.stringify(api.normalizeCustomDesign(draft.customDesign));const refreshHistoryButtons=()=>{const undo=document.querySelector("[data-design-undo]"),redo=document.querySelector("[data-design-redo]");if(undo)undo.disabled=!designHistory.length;if(redo)redo.disabled=!designFuture.length;};const beginDesignHistory=()=>{if(pendingHistory===null)pendingHistory=historySnapshot();};const commitDesignHistory=()=>{if(pendingHistory===null)return;const current=historySnapshot();if(current!==pendingHistory){designHistory.push(pendingHistory);if(designHistory.length>30)designHistory.shift();designFuture.length=0;}pendingHistory=null;refreshHistoryButtons();};
  const restoreDesign=snapshot=>{const next=editable(draft);next.customDesign=JSON.parse(snapshot);draft=next;renderAdvancedEditor();renderDesignPreviewLive();refreshHistoryButtons();};const undoDesign=()=>{if(!designHistory.length)return;designFuture.push(historySnapshot());restoreDesign(designHistory.pop());};const redoDesign=()=>{if(!designFuture.length)return;designHistory.push(historySnapshot());restoreDesign(designFuture.pop());};document.querySelector("[data-design-undo]")?.addEventListener("click",undoDesign);document.querySelector("[data-design-redo]")?.addEventListener("click",redoDesign);document.addEventListener("keydown",event=>{if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=="z")return;if(document.querySelector("[data-advanced-editor]")?.hidden)return;event.preventDefault();event.shiftKey?redoDesign():undoDesign();});
  const updateDesignLive=mutator=>{const next=editable(draft);mutator(next);draft=next;renderDesignPreviewLive();};const designAction=mutator=>{beginDesignHistory();updateDesignLive(mutator);commitDesignHistory();renderDesignForm();};
  let controlIndex=0;document.querySelectorAll('.advanced-editor__properties input[type="range"]').forEach(range=>{const id=`design-control-${++controlIndex}`;range.dataset.designControlId=id;const number=document.createElement("input");number.type="number";number.className="design-value-input";number.min=range.min;number.max=range.max;number.step=range.step||"1";number.dataset.designMirror=id;const output=document.createElement("output");output.dataset.designValueFor=id;range.after(number,output);});
  const valueFromInput=input=>input.dataset.designScale?Number(input.value)/Number(input.dataset.designScale):input.type==="range"||input.type==="number"?Number(input.value):input.type==="checkbox"?input.checked:input.value;
  const applyDesignControl=input=>updateDesignLive(next=>{const region=ensureDesignRegion(next,selectedDesignRegion);if(input.dataset.designField)region[input.dataset.designField]=valueFromInput(input);else{region.image=region.image||editable(api.DESIGN_IMAGE_DEFAULT);const field=input.dataset.designImageField;region.image[field]=valueFromInput(input);if(["offsetX","offsetY"].includes(field))region.image.position="custom";}});
  const controls=[...document.querySelectorAll("[data-design-field],[data-design-image-field]")];for(const input of controls){input.addEventListener("pointerdown",beginDesignHistory);input.addEventListener("focus",beginDesignHistory);input.addEventListener("input",()=>applyDesignControl(input));input.addEventListener("change",()=>{applyDesignControl(input);commitDesignHistory();renderDesignForm();});}
  document.querySelectorAll(".design-value-input").forEach(number=>{number.addEventListener("focus",beginDesignHistory);number.addEventListener("input",()=>{const range=document.querySelector(`[data-design-control-id="${number.dataset.designMirror}"]`);const value=Math.max(Number(number.min),Math.min(Number(number.max),Number(number.value)));number.value=value;range.value=value;applyDesignControl(range);syncDesignValues();});number.addEventListener("change",()=>{commitDesignHistory();renderDesignForm();});});
  const designEnabled=document.querySelector("[data-design-enabled]");designEnabled?.addEventListener("pointerdown",beginDesignHistory);designEnabled?.addEventListener("input",event=>updateDesignLive(next=>{ensureDesignRegion(next,selectedDesignRegion).enabled=event.target.checked;}));designEnabled?.addEventListener("change",()=>{commitDesignHistory();renderDesignForm();});
  document.querySelector("[data-design-reset-region]")?.addEventListener("click",()=>designAction(next=>{next.customDesign=next.customDesign||{version:1,regions:{}};delete next.customDesign.regions[selectedDesignRegion];}));
  document.querySelector("[data-design-reset-all]")?.addEventListener("click",()=>designAction(next=>{next.customDesign={version:1,regions:{}};}));
  document.querySelector("[data-design-reset-image]")?.addEventListener("click",()=>designAction(next=>{const region=ensureDesignRegion(next,selectedDesignRegion),url=region.image?.url||"",enabled=region.image?.enabled===true;region.image={...editable(api.DESIGN_IMAGE_DEFAULT),url,enabled};}));
  document.querySelectorAll("[data-design-scale]").forEach(button=>button.addEventListener("click",()=>designAction(next=>{const region=ensureDesignRegion(next,selectedDesignRegion);region.image=region.image||editable(api.DESIGN_IMAGE_DEFAULT);const change=Number(button.dataset.designScale);region.image.scale=change===1?1:Math.max(.1,Math.min(4,Number(region.image.scale||1)+change));})));
  const disableDesignImages=()=>designAction(next=>{next.customDesign=next.customDesign||{version:1,regions:{}};for(const region of Object.values(next.customDesign.regions||{})){region.image=region.image||editable(api.DESIGN_IMAGE_DEFAULT);region.image.enabled=false;}});
  document.querySelector("[data-design-disable-images]")?.addEventListener("click",disableDesignImages);document.querySelector("[data-design-colors-only]")?.addEventListener("click",()=>{disableDesignImages();const next=editable(draft);next.visualSlots.enabledByUser=true;for(const key of Object.keys(slotLabels))next.visualSlots[key].enabled=false;draft=next;renderDesignPreviewLive();});
  document.querySelector("[data-design-save-draft]")?.addEventListener("click",()=>{localStorage.setItem(DESIGN_DRAFT_KEY,JSON.stringify(api.normalizeCustomDesign(draft.customDesign)));message("高级美化草稿已保存；当前主题未改变。");});
  document.querySelector("[data-design-apply]")?.addEventListener("click",()=>{draft=store.applyTheme(draft,{persist:true,applyBackground:true});selectedThemeId=draft.id;updateThemeNames();message("高级设计已应用到当前主题。");});
  document.querySelector("[data-design-save-as]")?.addEventListener("click",()=>{const name=window.prompt("新主题名称",`${draft.name} · 自定义`)?.trim();if(!name)return;const next=editable(draft);next.name=name;next.id=`theme_${Date.now().toString(36)}`;next.source="custom";const imported=store.importTheme({type:"xinban-theme",themeVersion:1,theme:next});setCurrentWorkshopTheme(imported);message(`已另存为「${imported.name}」，尚未应用。`);});
  document.querySelector("[data-design-image-preview]")?.addEventListener("click",()=>{const url=designRegion(selectedDesignRegion).image?.url,src=safeAssetImage(url),dialog=document.querySelector("[data-asset-preview-dialog]"),image=dialog?.querySelector("[data-asset-preview-image]");if(!src||!dialog||!image){message("请先选择已本地化素材。");return;}image.src=src;dialog.querySelector("[data-asset-preview-kind]").textContent="高级编辑器素材";dialog.querySelector("[data-asset-preview-selector]").textContent=api.DESIGN_REGIONS[selectedDesignRegion];dialog.querySelector("[data-asset-preview-domain]").textContent="本地素材库";dialog.querySelector("[data-asset-preview-localized]").textContent="已本地化";dialog.showModal();});
  const selectPreviewRegion=key=>{if(!api.DESIGN_REGIONS[key])return;selectedDesignRegion=key;selectedDesignPage=key.split(".")[0];designPreviewTab=["chat","home"].includes(selectedDesignPage)?selectedDesignPage:"generic";renderDesignNavigation();renderDesignForm();renderDesignPreview();};const designPreview=document.querySelector("[data-design-preview]");designPreview?.addEventListener("click",event=>{const regionNode=event.target.closest("[data-design-preview-region]");if(regionNode)selectPreviewRegion(regionNode.dataset.designPreviewRegion);});designPreview?.addEventListener("pointerdown",event=>{const layer=event.target.closest(".advanced-preview__image-layer");if(!layer)return;const regionNode=layer.parentElement,key=regionNode.dataset.designPreviewRegion;selectPreviewRegion(key);const image=designRegion(key).image;if(!image.enabled||!safeAssetImage(image.url))return;event.preventDefault();event.stopPropagation();beginDesignHistory();const startX=event.clientX,startY=event.clientY,originX=image.offsetX,originY=image.offsetY;layer.setPointerCapture?.(event.pointerId);const move=moveEvent=>{const x=Math.max(-100,Math.min(100,originX+moveEvent.clientX-startX)),y=Math.max(-100,Math.min(100,originY+moveEvent.clientY-startY));updateDesignLive(next=>{const target=ensureDesignRegion(next,key);target.image.position="custom";target.image.offsetX=Math.round(x);target.image.offsetY=Math.round(y);});const position=document.querySelector('[data-design-image-field="position"]');if(position)position.value="custom";for(const field of ["offsetX","offsetY"]){const input=document.querySelector(`[data-design-image-field="${field}"]`);if(input)input.value=field==="offsetX"?Math.round(x):Math.round(y);}syncDesignValues();};const end=()=>{layer.removeEventListener("pointermove",move);layer.removeEventListener("pointerup",end);layer.removeEventListener("pointercancel",end);commitDesignHistory();};layer.addEventListener("pointermove",move);layer.addEventListener("pointerup",end);layer.addEventListener("pointercancel",end);});
  const picker=document.querySelector("[data-design-asset-picker]"),assetGrid=document.querySelector("[data-design-asset-grid]");let assetFilter="all";
  const assetGroup=kind=>/background/iu.test(kind)?"background":/bubble/iu.test(kind)?"bubble":/avatar/iu.test(kind)?"avatar":/input/iu.test(kind)?"input":/header/iu.test(kind)?"header":/card/iu.test(kind)?"card":/nav/iu.test(kind)?"nav":"other";
  const assetUsage=url=>{const regions=Object.entries(draft.customDesign?.regions||{}).filter(([,region])=>region.image?.url===url).map(([key])=>api.DESIGN_REGIONS[key]);const slots=Object.entries(draft.visualSlots||{}).filter(([,slot])=>slot?.url===url).map(([key])=>slotLabels[key]);return [...regions,...slots].filter(Boolean);};
  const chooseLibraryAsset=asset=>{if(assetPickerTarget.type==="slot")update(next=>{next.visualSlots.enabledByUser=true;next.visualSlots[assetPickerTarget.key].url=asset.url;next.visualSlots[assetPickerTarget.key].enabled=true;next.migratedVisualSlotsSafe=true;});else designAction(next=>{const region=ensureDesignRegion(next,selectedDesignRegion);region.image=region.image||editable(api.DESIGN_IMAGE_DEFAULT);region.image.url=asset.url;region.image.enabled=true;});picker?.close();};
  const renderDesignAssets=()=>{if(!assetGrid)return;assetGrid.replaceChildren();const search=document.querySelector("[data-design-asset-search]")?.value.trim().toLowerCase()||"",unusedOnly=document.querySelector("[data-design-asset-unused]")?.checked,sort=document.querySelector("[data-design-asset-sort]")?.value||"kind",current=assetPickerTarget.type==="slot"?draft.visualSlots?.[assetPickerTarget.key]?.url:designRegion(selectedDesignRegion).image?.url;let assets=(draft.assetLibrary||[]).filter(asset=>{const used=assetUsage(asset.url);return safeAssetImage(asset.url)&&(assetFilter==="all"||assetGroup(asset.kind)===assetFilter)&&(!search||`${asset.kind} ${kindLabel(asset.kind)} ${asset.id}`.toLowerCase().includes(search))&&(!unusedOnly||!used.length);});assets.sort((a,b)=>sort==="newest"?String(b.id).localeCompare(String(a.id)):sort==="unused"?assetUsage(a.url).length-assetUsage(b.url).length:kindLabel(a.kind).localeCompare(kindLabel(b.kind)));for(const asset of assets){const src=safeAssetImage(asset.url),used=assetUsage(asset.url),card=document.createElement("article");card.className=`design-asset-choice${asset.url===current?" is-active":""}`;const thumb=document.createElement("button");thumb.type="button";thumb.className="design-asset-thumb checkerboard";thumb.setAttribute("aria-label","放大查看素材");const img=document.createElement("img");img.src=src;img.alt=`${kindLabel(asset.kind)} ${asset.id.slice(0,8)}`;img.loading="lazy";const dimensions=document.createElement("small");img.addEventListener("load",()=>{dimensions.textContent=`${img.naturalWidth}×${img.naturalHeight}`;});thumb.append(img);thumb.addEventListener("click",()=>openAssetPreview({...asset,localUrl:asset.url,selector:used.join("、")||"未使用",sourceUrl:"本地素材库"}));const label=document.createElement("strong");label.textContent=kindLabel(asset.kind);const id=document.createElement("span");id.textContent=asset.id.slice(0,8);const usage=document.createElement("small");usage.textContent=used.length?`使用中：${used.join("、")}`:"未使用";const choose=document.createElement("button");choose.type="button";choose.textContent="选择";choose.addEventListener("click",()=>chooseLibraryAsset(asset));card.append(thumb,label,id,dimensions,usage,choose);assetGrid.append(card);}if(!assetGrid.children.length)assetGrid.textContent="没有符合条件的已本地化素材。";};
  document.querySelector("[data-design-open-picker]")?.addEventListener("click",()=>{assetPickerTarget={type:"region"};renderDesignAssets();picker?.showModal();});document.querySelector("[data-design-picker-close]")?.addEventListener("click",()=>picker?.close());document.querySelectorAll("[data-design-asset-filters] [data-filter]").forEach(button=>button.addEventListener("click",()=>{assetFilter=button.dataset.filter;renderDesignAssets();}));for(const selector of ["[data-design-asset-search]","[data-design-asset-sort]","[data-design-asset-unused]","[data-design-asset-theme]"])document.querySelector(selector)?.addEventListener("input",renderDesignAssets);
  const urlDialog=document.querySelector("[data-design-url-import]"),urlInput=document.querySelector("[data-design-url-input]"),urlPreview=document.querySelector("[data-design-url-preview]"),urlStatus=document.querySelector("[data-design-url-status]"),urlSave=document.querySelector("[data-design-url-save]");let pendingUrlImport=null;
  const closeUrlImport=()=>{urlDialog?.close();pendingUrlImport=null;if(urlSave)urlSave.disabled=true;};document.querySelector("[data-design-import-url]")?.addEventListener("click",()=>{picker?.close();urlDialog?.showModal();});document.querySelector("[data-design-url-close]")?.addEventListener("click",closeUrlImport);document.querySelector("[data-design-url-cancel]")?.addEventListener("click",closeUrlImport);
  document.querySelector("[data-design-url-preview-button]")?.addEventListener("click",async()=>{const sourceUrl=urlInput?.value.trim();pendingUrlImport=null;if(urlSave)urlSave.disabled=true;if(urlStatus)urlStatus.textContent="正在生成安全预览…";try{const parsed=new URL(sourceUrl);const id=crypto.randomUUID(),payload=await gatewayRequest("/api/theme/assets/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({assets:[{id,sourceUrl,kind:"decorativeAsset",selector:"visual asset library"}]})}),item=payload.data.items?.[0];if(!item)throw new Error(previewFailureText(payload.data.failed?.[0]?.reason));const src=safeAssetImage(item.previewUrl),img=document.createElement("img");img.src=src;img.alt="安全外链预览";img.addEventListener("load",()=>{document.querySelector("[data-design-url-meta]").textContent=`${img.naturalWidth}×${img.naturalHeight} · PNG/JPEG/WebP`;});urlPreview.replaceChildren(img);document.querySelector("[data-design-url-domain]").textContent=parsed.hostname;pendingUrlImport={id,sourceUrl,previewUrl:item.previewUrl};urlSave.disabled=false;urlStatus.textContent="预览已通过安全检查；保存后才可用于主题。";}catch(error){urlPreview.textContent="无法生成预览";urlStatus.textContent=error.message||"地址不是支持的图片";}});
  urlSave?.addEventListener("click",async()=>{if(!pendingUrlImport)return;urlSave.disabled=true;if(urlStatus)urlStatus.textContent="正在保存到本地素材库…";try{const payload=await gatewayRequest("/api/theme/assets/localize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({assets:[{id:pendingUrlImport.id,sourceUrl:pendingUrlImport.sourceUrl,kind:"decorativeAsset"}]})}),item=payload.data.localized?.[0];if(!item)throw new Error(previewFailureText(payload.data.failed?.[0]?.reason));const asset={id:item.id,kind:item.kind||"decorativeAsset",url:item.localUrl};const next=editable(draft);next.assetLibrary=next.assetLibrary||[];next.assetLibrary.push(asset);draft=editable(api.normalizeTheme(next));chooseLibraryAsset(asset);closeUrlImport();message("已保存到本地素材库，并应用到当前区域。");}catch(error){urlSave.disabled=false;urlStatus.textContent=error.message||"保存到素材库失败";}});
  const designPresets={glass:{backgroundColor:"rgba(255,255,255,.12)",borderColor:"rgba(255,255,255,.28)",shadow:.08,blur:14,glassOpacity:.7},light:{backgroundColor:"rgba(255,255,255,.72)",borderColor:"rgba(80,110,130,.14)",shadow:.12,blur:8,glassOpacity:.82},image:{backgroundColor:"rgba(255,255,255,.32)",borderColor:"rgba(255,255,255,.22)",shadow:.1,blur:12,glassOpacity:.62},minimal:{backgroundColor:"transparent",borderColor:"rgba(80,110,130,.22)",accentColor:"transparent",shadow:0,blur:0,glassOpacity:1}};
  document.querySelectorAll("[data-design-preset]").forEach(button=>button.addEventListener("click",()=>designAction(next=>{const region=ensureDesignRegion(next,selectedDesignRegion);Object.assign(region,designPresets[button.dataset.designPreset],{enabled:true});if(button.dataset.designPreset!=="image")region.image.enabled=false;})));
  document.querySelectorAll("[data-theme-export]").forEach(button=>button.addEventListener("click", () => {
    const blob = new Blob([`${JSON.stringify(store.exportTheme(draft), null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${draft.name.replace(/[^\p{Letter}\p{Number}_-]+/gu, "-") || "xinban-theme"}.json`; link.click(); URL.revokeObjectURL(link.href); message("主题 JSON 已导出");
  }));
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
  try{const savedDesign=JSON.parse(localStorage.getItem(DESIGN_DRAFT_KEY)||"null");if(savedDesign){const next=editable(draft);next.customDesign=api.normalizeCustomDesign(savedDesign);draft=editable(api.normalizeTheme(next));message("已恢复上次保存的高级美化草稿；当前主题未改变。");}}catch{}
  refreshForm(); render(); if(store.lastVisualSlotsMigration) message("已为旧导入主题关闭自动装饰，避免影响布局；可在装饰槽位设置中手动开启。");
});
