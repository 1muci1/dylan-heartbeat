(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.CompanionVoiceSession=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const STATES=Object.freeze({idle:["listening","sending","thinking","speaking","error"],listening:["recognizing","review","idle","error"],recognizing:["review","idle","error"],review:["sending","listening","idle","error"],sending:["thinking","idle","error"],thinking:["speaking","idle","error"],speaking:["paused","idle","error"],paused:["speaking","idle","error"],error:["idle","listening","sending","thinking"]});
  const LABELS={idle:"准备好了",listening:"正在听…",recognizing:"正在识别…",review:"等待确认",sending:"发送中…",thinking:"沉正在想…",speaking:"沉正在说…",paused:"已暂停",error:"语音暂时不可用"};
  class VoiceSessionController{
    constructor({adapter,send,getBusy=()=>false,getSessionId=()=>"",getDraft=()=>"",setDraft=()=>{},settings=()=>({}),confirmContinuous=()=>false,onChange=()=>{},clock=globalThis,navigatorRef={},documentRef={}}){
      Object.assign(this,{adapter,send,getBusy,getSessionId,getDraft,setDraft,settings,confirmContinuous,onChange,clock,navigatorRef,documentRef});
      this.state="idle";this.active=false;this.continuousConversation=false;this.continuousConfirmed=false;this.sessionAutoSpeak=true;this.turn=0;this.playbackTurn=0;this.generation=0;this.completed=new Set();this.transcript="";this.summary="";this.timer=null;this.watchdog=null;this.suspended=false;this.editing=false;
    }
    emit(){this.onChange(this);}
    transition(next){if(next!==this.state&&!STATES[this.state].includes(next))return false;this.state=next;this.notice="";this.emit();return true;}
    open(){if(this.active)return;this.continuousConversation=false;this.active=true;this.sessionId=this.getSessionId();this.generation++;this.suspended=false;this.editing=false;this.transcript="";this.summary="";this.state="idle";this.emit();this.acquireWakeLock();}
    async acquireWakeLock(){const generation=this.generation;try{const lock=await this.navigatorRef.wakeLock?.request?.("screen");if(!this.active||generation!==this.generation||this.suspended)await lock?.release?.();else this.wakeLock=lock;}catch{/* optional capability */}}
    releaseWakeLock(){try{Promise.resolve(this.wakeLock?.release?.()).catch(()=>{});}catch{/* optional capability */}this.wakeLock=null;}
    cancelTimer(){if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;}
    cancelWatchdog(){if(this.watchdog!==null)this.clock.clearTimeout(this.watchdog);this.watchdog=null;}
    halt(){this.cancelWatchdog();this.cancelTimer();this.turn++;this.playbackTurn++;this.adapter.abortRecognition();this.adapter.stop();}
    stop(){this.halt();this.suspended=true;this.transition("idle");}
    close(){this.halt();this.active=false;this.generation++;this.state="idle";this.releaseWakeLock();this.emit();}
    sessionChanged(id){if(this.active&&id!==this.sessionId)this.close();}
    async setContinuous(enabled){if(!enabled){this.continuousConversation=false;this.cancelTimer();this.emit();return false;}const generation=this.generation;if(!this.continuousConfirmed){const confirmed=await this.confirmContinuous();if(!confirmed||!this.active||generation!==this.generation){this.emit();return false;}this.continuousConfirmed=true;}this.continuousConversation=true;this.emit();return true;}
    valid(){return this.active&&!this.suspended&&this.documentRef.visibilityState!=="hidden";}
    listen(){if(!this.active||this.documentRef.visibilityState==="hidden"||this.getBusy()||!["idle","review","error"].includes(this.state))return false;
      this.cancelTimer();if(this.suspended)this.acquireWakeLock();this.suspended=false;this.editing=false;
      if(!this.adapter.capabilities().stt){this.fail("当前浏览器不支持语音识别，可继续使用文字聊天");return false;}
      this.adapter.stop();this.adapter.abortRecognition();const turn=++this.turn;let finalReceived=false;
      const valid=()=>this.valid()&&turn===this.turn;
      this.draftBeforeTurn=this.getDraft();this.transcript="";this.transition("listening");
      const ok=this.adapter.startRecognition({lang:this.settings().recognitionLanguage,onStart:()=>{if(valid()&&this.state==="listening")this.emit();},onRecognizing:()=>{if(valid()&&this.state==="listening")this.transition("recognizing");},onInterim:value=>{if(valid()&&!finalReceived&&this.settings().showInterimTranscript!==false){this.transcript=value;this.emit();}},onFinal:value=>{
        if(!valid()||finalReceived||!["listening","recognizing"].includes(this.state))return;
        const text=String(value||"").trim();if(!text)return;finalReceived=true;
        this.turn++;this.adapter.abortRecognition();if(this.state==="listening")this.transition("recognizing");
        this.transcript=text;this.setDraft([this.getDraft().trim(),text].filter(Boolean).join(" "));this.transition("review");
        if(this.continuousConversation&&!this.editing)this.sendReview();
      },onError:error=>{if(valid())this.fail(["not-allowed","service-not-allowed","NotAllowedError"].includes(error)?"未获得麦克风权限":error==="no-speech"?"未听清，再试一次":error==="audio-capture"?"未找到可用麦克风":error==="aborted"?"语音识别已停止":"语音识别暂时不可用");},onEnd:()=>{if(valid()&&!finalReceived)this.fail("未听清，再试一次");}});
      if(!ok&&this.state!=="error")this.fail("语音识别暂时不可用");return ok;
    }
    async sendReview(){if(!this.valid()||this.state!=="review"||this.getBusy()||!this.getDraft().trim())return false;const generation=this.generation;this.transition("sending");try{const accepted=await this.send();if(!this.active||generation!==this.generation)return false;if(accepted===false&&this.state==="sending")this.fail("请检查聊天输入后再发送");return accepted!==false;}catch{if(this.active&&generation===this.generation)this.fail("沉的回复失败");return false;}}
    sending(){if(!this.active)return;this.halt();this.suspended=false;this.state="idle";this.transition("sending");}
    thinking(){if(this.active){if(this.state!=="sending")this.sending();this.transition("thinking");this.cancelWatchdog();const generation=this.generation;this.watchdog=this.clock.setTimeout(()=>{this.watchdog=null;if(this.active&&generation===this.generation&&this.state==="thinking")this.fail("等待回复超时，请重试。");},60000);}}
    fail(message){this.halt();this.suspended=true;this.transition("error");this.notice=message;this.emit();}
    assistantError(){if(this.active)this.fail("沉的回复失败");}
    completedReply(message,{history=false,streaming=false,generation=this.generation}={}){
      if(!this.active||generation!==this.generation||history||streaming||message?.role!=="assistant"||message.transient||!message.id||!message.content||this.completed.has(message.id))return false;
      this.cancelWatchdog();this.completed.add(message.id);if(!this.valid()||!this.sessionAutoSpeak){if(this.state==="thinking")this.transition("idle");return false;}
      this.halt();this.summary=Array.from(message.content).slice(0,240).join("");const token=this.playbackTurn;
      if(this.state!=="thinking")this.state="idle";
      // Playback state follows the adapter's real utterance start event.
      const ok=this.adapter.speak(message.content,{...this.settings(),onStart:()=>{if(this.valid()&&token===this.playbackTurn)this.transition("speaking");},onEnd:()=>{if(!this.active||token!==this.playbackTurn)return;this.transition("idle");this.scheduleListen(450);},onError:()=>{if(this.active&&token===this.playbackTurn)this.fail("语音播放失败");}});
      if(!ok)this.fail("当前浏览器无法朗读这条回复");return ok;
    }
    scheduleListen(delay,explicit=false){this.cancelTimer();if(!this.valid()||(!explicit&&!this.continuousConversation)||this.editing)return;const generation=this.generation;this.timer=this.clock.setTimeout(()=>{this.timer=null;if(generation===this.generation&&this.valid()&&!this.editing&&(explicit||this.continuousConversation)&&!this.getBusy())this.listen();},delay);}
    pause(){if(this.state==="speaking"&&this.adapter.pause()!==false)this.transition("paused");}
    resume(){if(this.state==="paused"&&this.documentRef.visibilityState!=="hidden"){this.suspended=false;this.acquireWakeLock();if(this.adapter.resume()!==false)this.transition("speaking");}else if(this.state==="idle"){this.suspended=false;this.acquireWakeLock();this.notice="准备好了，请点击说话";this.emit();}}
    interrupt(){if(!["speaking","paused"].includes(this.state))return;this.halt();this.suspended=false;this.transition("idle");this.scheduleListen(275,true);}
    cancelReview(){this.transcript="";this.transition("idle");}
    retry(){this.setDraft(this.draftBeforeTurn||"");this.listen();}
    composerEdited(){if(!this.active)return;this.editing=true;this.cancelTimer();}
    visibilityChanged(){if(!this.active)return;if(this.documentRef.visibilityState==="hidden"){this.cancelWatchdog();this.cancelTimer();this.turn++;this.adapter.abortRecognition();this.suspended=true;if(this.state==="thinking")this.transition("idle");if(this.state==="speaking"){this.adapter.pause();this.transition("paused");}else if(this.state!=="paused"){this.playbackTurn++;this.adapter.stop();}if(["listening","recognizing"].includes(this.state))this.transition("idle");this.releaseWakeLock();}this.notice="点击继续语音会话";this.emit();}
  }
  function syncAvatar(windowRef,documentRef,node){
    const resolver=windowRef.CompanionChatAvatars;
    const header=documentRef.querySelector(".chat-avatar");
    const background=header?windowRef.getComputedStyle(header).backgroundImage:"none";
    const configured=resolver?.getImage("chen");
    node.replaceChildren();node.textContent="沉";
    node.style.removeProperty("background-image");
    // Header backgrounds have already passed the shared avatar resolver.
    const match=background?.match(/^url\(["']?(.*?)["']?\)$/);
    const sources=[match?.[1],configured].filter((value,index,list)=>value&&list.indexOf(value)===index);
    const attempt=()=>{
      const source=sources.shift();if(!source)return;
      const img=documentRef.createElement("img");img.alt="沉";
      img.onload=()=>{if(node.firstChild===img)node.dataset.avatarLoaded="true";};
      img.onerror=()=>{if(node.firstChild!==img)return;node.replaceChildren();node.textContent="沉";attempt();};
      node.replaceChildren(img);img.src=source;
    };
    delete node.dataset.avatarLoaded;attempt();
  }
  // Presentation only: action handlers and controller transitions remain unchanged.
  function renderPresentation(dialog,controller){
    const state=controller.state,find=selector=>dialog.querySelector(selector);
    const visible={idle:["listen"],listening:["stop"],recognizing:[],review:["retry","send"],sending:[],thinking:[],speaking:["pause","interrupt"],paused:["resume","stop"],error:["listen"]};
    dialog.querySelectorAll("[data-vs-action]").forEach(button=>{if(button.dataset.vsAction!=="close")button.hidden=!(visible[state]||[]).includes(button.dataset.vsAction);});
    find("[data-vs-exit]").hidden=state!=="error";
    find("[data-vs-review]").hidden=state!=="review";
    find("[data-vs-listening]").hidden=state!=="listening";
    const listenLabel=state==="error"?"重新说":"点击说话";
    find("[data-vs-listen-label]").textContent=listenLabel;
    find('[data-vs-action="listen"]').setAttribute("aria-label",listenLabel);
    const errorReply=/回复/.test(controller.notice||"");
    find("[data-vs-status]").textContent=state==="error"?(errorReply?"回复失败":"语音暂时不可用"):({listening:"正在听你说…",speaking:"沉正在说话…"}[state]||LABELS[state]);
    find("[data-vs-secondary]").textContent=state==="error"?(controller.notice==="沉的回复失败"?"沉暂时没有回复成功，可以稍后再试。":controller.notice||"可以稍后再试。"):state==="idle"?(controller.suspended?"点击说话，继续陪伴":"想说什么都可以"):"";
  }
  function mount({windowRef,documentRef,voiceUI,input,send,getBusy,getSessionId}){
    const dialog=documentRef.querySelector("[data-voice-session]");if(!dialog||!voiceUI)return null;
    const find=selector=>dialog.querySelector(selector),buttons={};dialog.querySelectorAll("[data-vs-action]").forEach(button=>buttons[button.dataset.vsAction]=button);
    const toggle=find("[data-vs-continuous]");let previousFocus;
    const background=windowRef.CompanionVoiceBackground?.mount({windowRef,documentRef,dialog,store:voiceUI.store});
    const controller=new VoiceSessionController({adapter:voiceUI.adapter,send,getBusy,getSessionId,getDraft:()=>input.value,setDraft:value=>{input.value=value;input.dispatchEvent(new windowRef.Event("input",{bubbles:true}));},settings:()=>voiceUI.settings(),clock:windowRef,navigatorRef:windowRef.navigator,documentRef,confirmContinuous:()=>new Promise(resolve=>{
      const panel=find("[data-vs-confirm]");panel.hidden=false;toggle.disabled=true;
      const finish=value=>{panel.hidden=true;toggle.disabled=false;yes.removeEventListener("click",accept);no.removeEventListener("click",cancel);resolve(value);};
      const yes=find("[data-vs-confirm-yes]"),no=find("[data-vs-confirm-no]"),accept=()=>finish(true),cancel=()=>finish(false);
      yes.addEventListener("click",accept);no.addEventListener("click",cancel);no.focus();
    }),onChange:c=>{
      if(c.active&&!dialog.open){previousFocus=documentRef.activeElement;background?.open();dialog.showModal();}else if(!c.active&&dialog.open){find("[data-vs-confirm-no]")?.click();background?.close();dialog.close();previousFocus?.focus?.();}
      dialog.dataset.state=c.state;find("[data-vs-status]").textContent=c.notice||LABELS[c.state];find("[data-vs-transcript]").textContent=c.transcript;find("[data-vs-summary]").textContent=c.summary;toggle.checked=c.continuousConversation;
      buttons.listen.disabled=!["idle","review","error"].includes(c.state)||getBusy()||!c.adapter.capabilities().stt;
      renderPresentation(dialog,c);
    }});
    const actions={listen:()=>controller.listen(),stop:()=>controller.stop(),close:()=>controller.close(),send:()=>controller.sendReview(),retry:()=>controller.retry(),cancel:()=>controller.cancelReview(),interrupt:()=>controller.interrupt(),pause:()=>controller.pause(),resume:()=>controller.resume()};
    Object.entries(buttons).forEach(([name,button])=>button.addEventListener("click",actions[name]));
    find("[data-vs-exit]").addEventListener("click",()=>controller.close());
    toggle.addEventListener("change",()=>controller.setContinuous(toggle.checked));
    documentRef.querySelector("[data-open-voice-session]")?.addEventListener("click",()=>{voiceUI.destroy();syncAvatar(windowRef,documentRef,find("[data-vs-avatar]"));controller.open();});
    dialog.addEventListener("cancel",event=>{event.preventDefault();controller.close();});
    input.addEventListener("input",event=>{if(event.isTrusted)controller.composerEdited();});
    documentRef.addEventListener("visibilitychange",()=>controller.visibilityChanged());windowRef.addEventListener("pagehide",()=>controller.close());
    return controller;
  }
  return Object.freeze({STATES,LABELS,VoiceSessionController,syncAvatar,renderPresentation,mount});
});
