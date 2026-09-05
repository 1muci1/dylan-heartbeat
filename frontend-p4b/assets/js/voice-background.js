(function(root,factory){"use strict";const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.CompanionVoiceBackground=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  // Read rendered layers in paint order; theme/preferences retain ownership of resolution.
  function chatBackground(windowRef,documentRef){
    const shell=documentRef.querySelector(".chat-shell");
    for(const [node,pseudo] of [[shell,"::before"],[shell,null],[documentRef.body,null]]){
      if(!node)continue;
      const style=windowRef.getComputedStyle(node,pseudo);
      if(style.display==="none"||style.opacity==="0")continue;
      const image=style.backgroundImage?.match(/url\((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)]*)\)/)?.[0];
      if(image)return image;
    }
    return "";
  }
  function mount({windowRef,documentRef,dialog,store}){
    const find=s=>dialog.querySelector(s),panel=find("[data-vb-panel]"),preview=find("[data-vb-preview]"),notice=find("[data-vb-notice]"),frame=find("[data-vb-picker]");
    if(!panel)return {open(){},close(){}};
    let generation=0;
    const paint=image=>{dialog.style.setProperty("--voice-background-image",image||"none");dialog.toggleAttribute("data-voice-background",Boolean(image));preview.style.backgroundImage=image||"none";};
    const render=()=>{const value=store.load().voiceSession;find('[data-vb-mode="follow-chat"]').checked=value.backgroundMode!=="custom";find('[data-vb-mode="custom"]').checked=value.backgroundMode==="custom";};
    const open=async()=>{
      const token=++generation;render();notice.textContent="";const follow=()=>paint(chatBackground(windowRef,documentRef));follow();
      const value=store.load().voiceSession;if(value.backgroundMode!=="custom")return;
      const fallback=()=>{if(token!==generation)return;follow();notice.textContent="自定义背景不可用，已临时使用聊天背景。";};
      const id=windowRef.CompanionVoice.safeBackgroundAssetId(value.backgroundAssetId);
      const src=id?windowRef.XinbanThemes?.resolveThemeAssetUrl(`/api/theme/assets/${id}`):"";
      if(!src){fallback();return;}
      try{const library=await windowRef.XinbanThemeGateway.request("/api/theme/assets/library",{cache:"no-store"},windowRef);if(token!==generation)return;if(!library.data?.items?.some(asset=>asset.id===id&&!asset.deletedAt)){fallback();return;}}catch{fallback();return;}
      // Fresh image verification also detects a deleted immutable-cache asset.
      const image=new windowRef.Image();image.onload=()=>{if(token===generation)paint(`url(${JSON.stringify(src)})`);};image.onerror=fallback;image.src=src+`?voice-check=${Date.now()}`;
    };
    const save=(mode,id="")=>{const value=store.load();try{store.save({...value,voiceSession:{...value.voiceSession,backgroundMode:mode,backgroundAssetId:id}});open();}catch{notice.textContent="背景设置未保存，请检查浏览器存储。";}};
    const closePicker=()=>{frame.hidden=true;frame.removeAttribute("src");find("[data-vb-picker-close]").hidden=true;};
    const choose=()=>{
      frame.hidden=false;find("[data-vb-picker-close]").hidden=false;
      frame.onload=()=>{if(frame.hidden)return;const bridge=frame.contentWindow?.XinbanThemeStudioBridge;if(!bridge){notice.textContent="素材库暂时无法打开，请重试。";closePicker();return;}bridge.openAssetPicker(id=>{closePicker();if(windowRef.CompanionVoice.safeBackgroundAssetId(id))save("custom",id);else render();});};
      frame.src="theme-workshop.html?picker=voice-session";
    };
    find("[data-vb-toggle]").addEventListener("click",()=>{panel.hidden=!panel.hidden;find("[data-vb-toggle]").setAttribute("aria-expanded",String(!panel.hidden));});
    find("[data-vb-choose]").addEventListener("click",choose);
    find('[data-vb-mode="custom"]').addEventListener("change",choose);
    for(const selector of ['[data-vb-mode="follow-chat"]',"[data-vb-restore]"])find(selector).addEventListener("click",()=>{closePicker();save("follow-chat");});
    find("[data-vb-picker-close]").addEventListener("click",()=>{closePicker();render();});
    return {open,close(){generation++;closePicker();panel.hidden=true;find("[data-vb-toggle]").setAttribute("aria-expanded","false");}};
  }
  return Object.freeze({chatBackground,mount});
});
