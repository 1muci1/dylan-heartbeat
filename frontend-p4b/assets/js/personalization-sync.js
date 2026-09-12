"use strict";
((root,factory)=>{const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root){root.CompanionPersonalization=api;api.mount(root);}})(typeof window!=="undefined"?window:null,()=>{
  const KEY="personalization-sync-v1",SECTIONS=["identity","appearance","voicePortable"];
  const ASSET=/^\/api\/theme\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  const privateField=/^(?:.*(?:credential|token|password|secret)|authorization|bearer|api[_-]?key|key|gatewayConnection|providerConnection|voiceURI|voiceName|voiceLang|browserPermission.*)$/iu;
  const copy=value=>JSON.parse(JSON.stringify(value,(key,item)=>privateField.test(key)?undefined:item));
  const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>value?.[key]!==undefined).map(key=>[key,copy(value[key])]));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const errorStatus = (error, pending = false) => {
    if (error.code === "GATEWAY_NOT_CONNECTED") return "disconnected";
    if (error.status === 401) return "auth";
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "unavailable";
    if (error.status === 409) return "conflict";
    if (error.status >= 500) return "serverError";
    if (error.code === "LOCAL_ASSET_UNSUPPORTED") return "unsupported";
    if (error.code === "SYNC_NETWORK") return pending ? "pending" : "offline";
    if (error.code === "SYNC_RESPONSE_INVALID") return "invalidResponse";
    return "requestError";
  };
  const safeCodes=new Set("INVALID_PERSONALIZATION PERSONALIZATION_ASSET_MISSING PERSONALIZATION_UNAVAILABLE PERSONALIZATION_STORAGE_UNAVAILABLE PERSONALIZATION_BUSY ALREADY_INITIALIZED NOT_INITIALIZED SECTION_CONFLICT UNAUTHORIZED GATEWAY_KEY_MISSING GATEWAY_NOT_CONNECTED SYNC_NETWORK SYNC_REQUEST_FAILED SYNC_RESPONSE_INVALID LOCAL_ASSET_DECODE_FAILED LOCAL_ASSET_CANVAS_FAILED LOCAL_ASSET_ANIMATED LOCAL_ASSET_UNSUPPORTED LOCAL_ASSET_UNREADABLE LOCAL_ASSET_MALFORMED LOCAL_ASSET_TYPE_UNSUPPORTED THEME_ASSET_TOO_LARGE THEME_ASSET_MAGIC_INVALID THEME_ASSET_STRUCTURE_INVALID THEME_ASSET_DIMENSIONS_INVALID THEME_ASSET_DIMENSIONS_TOO_LARGE THEME_ASSET_INTERNAL_ERROR FST_ERR_CTP_INVALID_JSON_BODY FST_ERR_CTP_BODY_TOO_LARGE LOCAL_STORAGE_QUOTA_EXCEEDED INDEXEDDB_QUOTA_EXCEEDED LOCAL_BACKUP_INVALID LOCAL_BACKUP_FAILED LOCAL_BACKUP_UNAVAILABLE".split(" "));
  const failure=(error,stage,slot=null)=>({stage,slot,status:Number.isInteger(error.status)?error.status:null,code:safeCodes.has(error.code)?error.code:error.name==="QuotaExceededError"?"LOCAL_STORAGE_QUOTA_EXCEEDED":error.name==="SyntaxError"&&stage==="avatar-backup"?"LOCAL_BACKUP_INVALID":"SYNC_REQUEST_FAILED"});
  class SyncClient {
    constructor({preferences,themes,voice,appearance,storage,request,upload,backup,now=()=>new Date(),onStatus=()=>{}}) {
      Object.assign(this,{preferences,themes,voice,appearance,storage,request,upload,backup,now,onStatus});
      try{this.meta=copy(JSON.parse(storage.getItem(KEY)||"null")||{});}catch{this.meta={};}
      this.serverInitialized=null;this.migrationError=null;this.cloud=this.meta.cloud||null;this.pending=this.meta.pending||{};this.conflicts={};this.status="loading";this.applying=false;this.busy=false;this.ready=false;this.generation={};this.images=new Map();this.seen=this.capture();
    }
    capture() {
      // Persistent stores intentionally drop object URLs; inspect only legacy image fields
      // before normalization so an expired reference is reported, never silently erased.
      let legacy={};try{legacy=JSON.parse(this.storage.getItem("xinban-user-preferences-v1")||"null")||{};}catch{}
      const legacyImage=(...sources)=>sources.flatMap(source=>[source?.imageData,source?.dataUrl,source?.imageUrl,source?.url,source?.src]).find(value=>typeof value==="string"&&/^(?:blob:|http:)/u.test(value))||null;
      const prefs=this.preferences.loadSync(),raw=prefs.avatar||{};
      const avatar=kind=>{const config=raw[kind+"Avatar"]||(kind==="chen"?raw:raw.meAvatar||raw.ownerAvatar)||{};const image=this.preferences[kind==="chen"?"getChenAvatarImage":"getUserAvatarImage"](prefs)||legacyImage(legacy.avatar?.[kind+"Avatar"],...(kind==="chen"?[legacy.avatar]:[legacy.avatar?.meAvatar,legacy.avatar?.ownerAvatar]));
        // AvatarStudio stores zoom inside crop and duplicates it as scale.
        // Cloud crop is x/y only; keep the renderer's explicit scale, or legacy zoom.
        const crop=copy(config.crop||{x:50,y:50}),scale=config.scale??crop.zoom??1;
        delete crop.zoom;
        return image?{imageData:this.canonical(image),crop,scale,...(config.border?{border:config.border}:{})}:null;};
      const bg=this.preferences.getChatBackground(prefs),theme=this.themes.getActive(),settings=this.voice.load();
      return {
        identity:{userAvatar:avatar("user"),chenAvatar:avatar("chen")},
        appearance:{chatBackground:{imageData:this.canonical(bg.image||legacyImage(legacy.chatBackground,legacy.background,legacy.space?.profile?.background)),color:bg.color,position:bg.position,size:bg.size,overlay:bg.overlay,blur:bg.blur,imageOpacity:bg.opacity},activeTheme:pick(theme,["id","name","source","accentMode","accentExplicit","tokens","assets","visualSlots","customDesign","layout","harmonyVersion","migratedVisualSlotsSafe"]),ui:{mode:"night",style:"purple",font:"default",...pick(this.appearance?.read()||{},["mode","style","font"])}},
        voicePortable:pick(settings,["autoRead","rate","pitch","volume","recognitionLanguage","showInterimTranscript","voiceSession"])
      };
    }
    canonical(value) {
      if(!value)return null;
      // The existing resolver may return the configured Gateway origin for a canonical reference.
      if(this.assetOrigin&&String(value).startsWith(this.assetOrigin+"/api/theme/assets/"))return String(value).slice(this.assetOrigin.length);
      return value;
    }
    notify(status=this.status) {this.status=status;this.onStatus(this);}
    persist() {try{this.storage.setItem(KEY,JSON.stringify(copy({initialized:Boolean(this.cloud),lastServerRevision:this.cloud?.revision||0,lastSyncedAt:this.meta.lastSyncedAt||null,cloud:this.cloud,pending:this.pending})));}catch{this.notify("pending");}}
    changed() {
      if(this.applying)return;
      const current=this.capture();
      for(const section of SECTIONS) if(!same(current[section],this.seen[section])){
        this.seen[section]=current[section];this.generation[section]=(this.generation[section]||0)+1;
        this.pending[section]={data:copy(current[section]),baseRevision:this.pending[section]?.baseRevision||this.cloud?.sections[section].revision||0};
      }
      if(this.cloud&&Object.keys(this.pending).length){this.persist();this.notify("pending");}
    }
    apply(section,data) {
      this.applying=true;
      try {
        if(section==="identity")this.preferences.save({avatar:{imageData:null,userAvatar:null,chenAvatar:null,meAvatar:null,ownerAvatar:null,...copy(data)}});
        if(section==="appearance"){
          // Clear legacy background fallbacks when cloud explicitly chooses no image.
          this.preferences.save({chatBackground:null,background:null,space:{profile:{background:null}}});
          this.preferences.save({chatBackground:copy(data.chatBackground)});
          this.themes.applyTheme(data.activeTheme,{applyBackground:true});this.appearance?.save(data.ui);
        }
        if(section==="voicePortable")this.voice.save({...this.voice.load(),...copy(data)});
      } finally {this.applying=false;this.seen=this.capture();}
    }
    async start() {return this.sync();}
    async fetchCloud() {
      const payload=await this.request("/api/personalization",{cache:"no-store"});
      const state=copy(payload.data.state);
      this.ready=true;this.serverInitialized=payload.data.initialized;
      if(!state){this.cloud=null;this.notify("uninitialized");return null;}
      for(const section of SECTIONS){
        const pending=this.pending[section];
        if(pending){if(pending.baseRevision!==state.sections[section].revision)this.conflicts[section]=copy(state.sections[section]);}
        else this.apply(section,state.sections[section].data);
      }
      this.cloud=state;this.meta.lastSyncedAt=this.now().toISOString();this.persist();return state;
    }
    async prepare(data, initial = false) {
      const isBlob=value=>["[object Blob]","[object File]"].includes(Object.prototype.toString.call(value));
      const clone=value=>isBlob(value)?value:Array.isArray(value)?value.map(clone):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key])=>!privateField.test(key)).map(([key,item])=>[key,clone(item)])):value;
      const next=clone(data);
      const walk=async (value,path=[])=>{
        for(const [key,item] of Object.entries(value)){
          if(item&&typeof item==="object"&&!isBlob(item))await walk(item,[...path,key]);
          else if(["imageData","url","backgroundAssetId"].includes(key)||key.endsWith("Image")||["bubbleTexture","bottomNavTexture","avatarFrame","inputDecoration","headerDecoration","userBubbleDecoration","assistantBubbleDecoration","decorativeAsset","navIcon","fontUrl"].includes(key)){
            if(!item)continue;
            const canonical=this.canonical(item);
            if(ASSET.test(canonical)){value[key]=key==="backgroundAssetId"?canonical.split("/").at(-1):canonical;continue;}
            if(key==="backgroundAssetId"&&ASSET.test(`/api/theme/assets/${item}`))continue;
            const slot=path.includes("userAvatar")?"userAvatar":path.includes("chenAvatar")?"chenAvatar":path.includes("chatBackground")?"chatBackground":path.includes("voiceSession")?"voiceBackground":"themeVisualSlot";
            try {
              if (!isBlob(item)&&!/^(?:data:|blob:)/u.test(item)) throw Object.assign(new Error("图片需要先导入素材库"),{code:"LOCAL_ASSET_UNSUPPORTED"});
              if(!this.images.has(item)){
                const uploaded=await this.upload(item,{normalizeAvatar:initial&&["userAvatar","chenAvatar"].includes(slot)});
                if(!ASSET.test(uploaded))throw Object.assign(new Error("无效素材响应"),{code:"SYNC_RESPONSE_INVALID"});
                this.images.set(item,uploaded);
              }
              const asset=this.images.get(item);
              if(!ASSET.test(asset))throw Object.assign(new Error("无效素材响应"),{code:"SYNC_RESPONSE_INVALID"});
              value[key]=key==="backgroundAssetId"?asset.split("/").at(-1):asset;
            } catch(error) {
              this.migrationError=failure(error,error.stage||"asset-upload",slot);
              throw error;
            }
          }
        }
      };
      await walk(next);return next;
    }
    originalAvatars(candidate = this.capture()) {
      const identity=copy(candidate.identity),raw=this.preferences.loadSync().avatar||{};
      for(const [name,config] of [["userAvatar",raw.userAvatar||raw.meAvatar||raw.ownerAvatar],["chenAvatar",raw.chenAvatar||raw]]){
        if(identity[name]&&config?.crop)identity[name].crop=copy(config.crop);
      }
      return identity;
    }
    async bootstrap() {
      if(this.busy||this.cloud)return;
      this.busy=true;this.migrationError=null;this.notify("loading");
      let stage="preflight";
      try {
        // Check first: a stale Settings page must not upload assets after another device initialized.
        const existing=await this.request("/api/personalization",{cache:"no-store"});
        this.serverInitialized=existing.data.initialized;
        if(existing.data.initialized){this.pending={};await this.fetchCloud();this.notify("synced");return;}
        stage="capture";const candidate=this.capture();
        stage="avatar-backup";
        if(candidate.identity?.userAvatar||candidate.identity?.chenAvatar){
          if(!this.backup)throw Object.assign(new Error("本机备份不可用"),{code:"LOCAL_BACKUP_UNAVAILABLE"});
          this.lastBackup=await this.backup.ensure(this.originalAvatars(candidate));
        }
        stage="asset-prepare";const sections=await this.prepare(candidate,true);
        stage="bootstrap";
        const payload=await this.request("/api/personalization/bootstrap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sections})});
        stage="apply";
        this.cloud=payload.data.state;this.serverInitialized=true;this.pending={};
        const current=this.capture();
        for(const section of SECTIONS){if(same(candidate[section],current[section]))this.apply(section,this.cloud.sections[section].data);else this.pending[section]={data:current[section],baseRevision:1};}
        this.meta.lastSyncedAt=this.now().toISOString();this.persist();this.notify(Object.keys(this.pending).length?"pending":"synced");
      }catch(error){this.migrationError ||= failure(error,stage);if(error.status===409){this.pending={};await this.fetchCloud().catch(()=>{});this.notify("conflict");}else this.notify(errorStatus(error));}
      finally{this.busy=false;this.notify();}
    }
    async flush() {
      for(const section of SECTIONS){
        if(this.conflicts[section]||!this.pending[section])continue;
        const queued=copy(this.pending[section]),patch=await this.prepare(queued.data);
        try {
          const payload=await this.request("/api/personalization",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({section,baseRevision:queued.baseRevision,patch})});
          const confirmed=payload.data.state;
          this.cloud.revision=confirmed.revision;this.cloud.updatedAt=confirmed.updatedAt;this.cloud.sections[section]=confirmed.sections[section];
          if(same(this.pending[section],queued)){delete this.pending[section];this.apply(section,confirmed.sections[section].data);}
          else this.pending[section].baseRevision=confirmed.sections[section].revision;
          this.meta.lastSyncedAt=this.now().toISOString();this.persist();
        }catch(error){if(error.status===409){const payload=await this.request("/api/personalization",{cache:"no-store"});this.conflicts[section]=payload.data.state.sections[section];this.persist();}else throw error;}
      }
    }
    async sync() {
      if(this.busy)return;this.busy=true;this.migrationError=null;this.notify("loading");
      try{const state=await this.fetchCloud();if(!state)return;await this.flush();this.notify(Object.keys(this.conflicts).length?"conflict":Object.keys(this.pending).length?"pending":"synced");}
      catch(error){this.notify(errorStatus(error,Boolean(Object.keys(this.pending).length)));}
      finally{this.busy=false;this.notify();}
    }
    async resolve(section,choice) {
      if(this.busy||!this.conflicts[section]||!["cloud","local"].includes(choice))return;
      const current=this.conflicts[section];
      if(choice==="cloud"){delete this.pending[section];this.apply(section,current.data);}
      else this.pending[section].baseRevision=current.revision;
      this.cloud.sections[section]=current;delete this.conflicts[section];this.persist();await this.sync();
    }
  }
  function mount(w) {
    if(w.PersonalizationSync||!w.CompanionUserPreferences||!w.XinbanThemeStore||!w.CompanionVoice||!w.XinbanThemeGateway)return;
    const request=async(path,options)=>{await w.XinbanThemeGateway.ensureConnection(w);return w.XinbanThemeGateway.requestFirstParty(path,options,w);};
    const upload=async (source,{normalizeAvatar=false}={})=>{let file=source;if(normalizeAvatar)try{file=await w.CompanionAvatarMigration.normalize(source,w);}catch(error){error.stage="avatar-normalize";throw error;}const payload=await w.XinbanThemeGateway.uploadThemeAsset(file,w);return `/api/theme/assets/${payload.data.id}`;};
    const panel=w.document.querySelector("[data-personalization-sync]");
    const render=client=>{
      if(!panel)return;
      panel.querySelector("[data-sync-status]").textContent={disconnected:"尚未连接映我同步服务。",auth:"同步认证已失效，请重新连接映我 Gateway。",forbidden:"当前设备无权访问同步服务。",unavailable:"同步服务暂不可用。",serverError:"同步服务暂时异常，请稍后再试。",invalidResponse:"同步服务响应异常。",requestError:"同步请求失败，请稍后重试。",loading:"正在同步…",synced:"已同步",uninitialized:"尚未初始化",conflict:"冲突：另一台设备已经更新了此设置。",offline:"当前离线，正在使用本地设置。",pending:"待同步：当前使用本地设置，恢复网络后可同步。",unsupported:"存在不能同步的图片引用，请从素材库重新选择。"}[client.status];
      if(client.migrationError){
        const detail=client.migrationError,label={userAvatar:"用户头像",chenAvatar:"沉头像",chatBackground:"聊天背景",voiceBackground:"语音背景",themeVisualSlot:"主题视觉素材"}[detail.slot];
        const reason={LOCAL_ASSET_DECODE_FAILED:"图片无法解码，请重新选择图片",LOCAL_ASSET_CANVAS_FAILED:"无法安全读取图片画布，请重新选择图片",LOCAL_ASSET_ANIMATED:"动态头像无法保持视觉一致，请重新选择静态图片",THEME_ASSET_MAGIC_INVALID:"图片类型与内容不一致，请重新选择图片",LOCAL_ASSET_UNSUPPORTED:"请先通过素材库安全导入此图片",LOCAL_ASSET_UNREADABLE:"本地图片已无法读取，请重新选择",LOCAL_ASSET_MALFORMED:"本地图片编码无效",LOCAL_ASSET_TYPE_UNSUPPORTED:"仅支持 PNG、JPEG、WebP",THEME_ASSET_TOO_LARGE:"图片大小不符合上传限制"}[detail.code]||"图片上传被拒绝，请检查图片后重试";
        const stageLabel={preflight:"初始化前检查",capture:"读取本机配置","asset-prepare":"准备图片","avatar-normalize":"头像本地转换","asset-read":"读取本地图片","asset-upload":"上传图片","avatar-backup":"保存本机头像备份",bootstrap:"提交初始配置",apply:"应用云端配置"}[detail.stage]||"同步";
        panel.querySelector("[data-sync-status]").textContent=`${client.serverInitialized===false?"初始化失败：":""}${label?`${label}迁移失败：${reason} · `:""}${stageLabel}（stage: ${detail.stage} · slot: ${detail.slot||"不适用"} · ${detail.status?`HTTP ${detail.status}`:"HTTP 未取得"} · ${detail.code}）`;
      }
      const backupFailure=client.migrationError?.stage==="avatar-backup";
      if(backupFailure){
        const quota=["LOCAL_STORAGE_QUOTA_EXCEEDED","INDEXEDDB_QUOTA_EXCEEDED"].includes(client.migrationError.code);
        panel.querySelector("[data-sync-status]").textContent=(quota?"本机头像备份空间不足，云端尚未初始化。原有头像和设置已保留。":"本机头像备份失败，云端尚未初始化。原有头像和设置已保留。")+`（stage: avatar-backup · ${client.migrationError.code}）`;
      }
      const exportButton=panel.querySelector("[data-sync-export-avatars]");if(exportButton)exportButton.hidden=!backupFailure;
      const exportNote=panel.querySelector("[data-sync-export-note]");if(exportNote)exportNote.hidden=!backupFailure;
      panel.querySelector("[data-sync-time]").textContent=client.meta.lastSyncedAt?new Date(client.meta.lastSyncedAt).toLocaleString():"尚未同步";
      panel.querySelector("[data-sync-device]").textContent=w.XinbanThemeGateway.firstPartyConfig(w).auth?.token && !["disconnected","auth","forbidden"].includes(client.status)?"本设备已连接":"本设备尚未连接";
      const bootstrap=panel.querySelector("[data-sync-bootstrap]");bootstrap.hidden=client.serverInitialized!==false;bootstrap.disabled=client.busy;
      panel.querySelector("[data-sync-now]").hidden=client.serverInitialized!==true;
      const connect=panel.querySelector("[data-sync-connect]");if(connect)connect.hidden=!["disconnected","auth"].includes(client.status);
      const note=panel.querySelector("[data-sync-connect-note]");if(note)note.hidden=client.status!=="disconnected";
      const view=panel.querySelector("[data-sync-conflicts]");view.hidden=!Object.keys(client.conflicts).length;
      const list=panel.querySelector("[data-sync-conflict-list]");list.replaceChildren();
      for(const [section,cloud] of Object.entries(client.conflicts)){
        const row=w.document.createElement("section"),title=w.document.createElement("h3");title.textContent={identity:"头像",appearance:"背景与主题",voicePortable:"语音偏好"}[section];row.append(title);
        for(const [label,data] of [["云端版本",cloud.data],["本机版本",client.pending[section]?.data]]){
          const details=w.document.createElement("div"),heading=w.document.createElement("strong"),description=w.document.createElement("p");heading.textContent=label;
          description.textContent=section==="appearance"?`主题：${data?.activeTheme?.name||"默认"} · ${data?.chatBackground?.imageData?"已设置背景":"无自定义背景"}`:section==="voicePortable"?`语速 ${data?.rate} · 音调 ${data?.pitch} · 音量 ${data?.volume} · ${data?.recognitionLanguage} · 连续对话${data?.voiceSession?.continuousConversation?"开启":"关闭"}`:"用户头像 / 沉沉头像";
          details.append(heading,description);
          const images=section==="identity"?[["你",data?.userAvatar],["沉沉",data?.chenAvatar]]:section==="appearance"?[["聊天背景",data?.chatBackground]]:[];
          for(const [name,config] of images){const image=w.document.createElement("img");image.alt=name;image.width=64;image.height=64;image.style.objectFit="cover";const source=config?.imageData;image.src=source?.startsWith("/api/theme/assets/")?w.XinbanThemes.resolveThemeAssetUrl(source):/^data:image\/(png|jpeg|webp);base64,/iu.test(source||"")?source:"";if(config?.crop)image.style.objectPosition=`${config.crop.x}% ${config.crop.y}%`;if(source)details.append(image);}
          row.append(details);
        }
        for(const [choice,label] of [["cloud","使用云端"],["local","使用本机"]]){const button=w.document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",()=>client.resolve(section,choice));row.append(button);}list.append(row);
      }
    };
    const client=new SyncClient({preferences:new w.CompanionUserPreferences.UserPreferenceStore(),themes:w.XinbanThemeStore,voice:new w.CompanionVoice.VoiceSettingsStore(w.localStorage),appearance:w.CompanionAppearance,storage:w.localStorage,request,upload,backup:new w.CompanionAvatarBackup.AvatarBackupStore({indexedDB:w.indexedDB,storage:w.localStorage}),onStatus:render});
    client.assetOrigin=new URL(w.XinbanThemeGateway.resolveGatewayUrl("/api/personalization",{locationRef:w.location})).origin;
    client.seen=client.capture();w.PersonalizationSync=client;
    let timer;
    const changed=()=>{client.changed();if(!client.cloud||!Object.keys(client.pending).length)return;w.clearTimeout(timer);timer=w.setTimeout(()=>client.sync(),500);};
    for(const event of ["user-preferences-change","xinban:theme-applied","xinban:voice-settings","xinban:appearance-settings"])w.addEventListener(event,()=>{if(!client.applying)changed();});
    w.addEventListener("storage",event=>{if(["xinban-user-preferences-v1","xinban-theme-active-v1","xinban-voice-settings-v1","xinban-appearance"].includes(event.key))changed();});
    w.addEventListener("provider-config-change",()=>{
      client.assetOrigin=new URL(w.XinbanThemeGateway.resolveGatewayUrl("/api/personalization",{locationRef:w.location})).origin;
      client.sync();
    });
    w.addEventListener("online",()=>client.sync());
    panel?.querySelector("[data-sync-bootstrap]").addEventListener("click",()=>client.bootstrap().finally(()=>render(client)));
    panel?.querySelector("[data-sync-now]").addEventListener("click",()=>client.sync());
    panel?.querySelector("[data-sync-conflicts]").addEventListener("click",()=>{panel.querySelector("[data-sync-conflict-list]").hidden=false;});
    w.addEventListener("gateway-connection-change",()=>{if(!client.busy)client.sync();});
    if(panel){
      const button=w.document.createElement("button");button.type="button";button.hidden=true;button.dataset.syncExportAvatars="";button.textContent="导出本机头像备份";
      const note=w.document.createElement("p");note.hidden=true;note.dataset.syncExportNote="";note.textContent="可先导出两张原始头像及裁剪设置到本机文件。导出不会初始化云端；浏览器备份恢复可用后再重试，无需清空浏览器数据。";
      button.addEventListener("click",()=>{
        try {
          const blob=new w.Blob([JSON.stringify({version:1,identity:client.originalAvatars()},null,2)],{type:"application/json"});
          const url=w.URL.createObjectURL(blob),link=w.document.createElement("a");link.href=url;link.download="yingwo-avatar-backup-v79.json";link.click();w.setTimeout(()=>w.URL.revokeObjectURL(url),1000);
        }catch{note.textContent="导出未完成，原有头像和设置已保留。请保留当前浏览器数据，待本机备份可用后重试。";}
      });
      panel.append(button,note);
    }
    client.start();return client;
  }
  return {KEY,SyncClient,mount,errorStatus};
});
