(function(root,factory){"use strict";const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.CompanionVoice=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const SETTINGS_KEY="xinban-voice-settings-v1";
  const LANGUAGES=Object.freeze(["zh-CN","zh-TW","ja-JP","en-US"]);
  const safeBackgroundAssetId=value=>typeof value==="string"&&/^[a-z0-9-]{8,80}$/iu.test(value)?value:"";
  const sessionSettings=value=>({continuousConversation:value?.continuousConversation===true,autoSpeak:value?.autoSpeak!==false,backgroundMode:value?.backgroundMode==="custom"?"custom":"follow-chat",backgroundAssetId:safeBackgroundAssetId(value?.backgroundAssetId)});
  const DEFAULT_SETTINGS=Object.freeze({version:1,autoRead:false,voiceURI:"",voiceName:"",voiceLang:"",rate:1,pitch:1,volume:1,recognitionLanguage:"zh-CN",showInterimTranscript:true,voiceSession:Object.freeze(sessionSettings())});
  const clamp=(value,min,max,fallback)=>{const number=Number(value);return Number.isFinite(number)?Math.min(max,Math.max(min,number)):fallback;};
  const sanitizeSettings=value=>{const input=value&&typeof value==="object"?value:{};return{version:1,autoRead:input.autoRead===true,voiceURI:String(input.voiceURI||"").slice(0,300),voiceName:String(input.voiceName||"").slice(0,200),voiceLang:String(input.voiceLang||"").slice(0,35),rate:clamp(input.rate,.6,1.6,1),pitch:clamp(input.pitch,.7,1.3,1),volume:clamp(input.volume,0,1,1),recognitionLanguage:LANGUAGES.includes(input.recognitionLanguage)?input.recognitionLanguage:"zh-CN",showInterimTranscript:input.showInterimTranscript!==false,voiceSession:sessionSettings(input.voiceSession)};};
  class VoiceSettingsStore{
    constructor(storage){this.storage=storage||null;}
    load(){try{return sanitizeSettings(JSON.parse(this.storage?.getItem(SETTINGS_KEY)||"null"));}catch{return{...DEFAULT_SETTINGS};}}
    save(value){const next=sanitizeSettings(value);this.storage?.setItem(SETTINGS_KEY,JSON.stringify(next));return next;}
  }
  const normalizeSpeechText=(text,preserveLines=false)=>String(text||"")
    .replace(/```[\s\S]*?```/gu," ").replace(/`[^`]*`/gu," ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu,"$1").replace(/\[([^\]]+)\]\([^)]*\)/gu,"$1")
    .replace(/(?:https?:\/\/|www\.)\S+/giu," ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu,"")
    .replace(/[~*_]{1,3}/gu,"").replace(preserveLines?/[^\S\n]+/gu:/\s+/gu," ").trim();
  const chunkSpeechText=(text,maxLength=220)=>{
    const limit=Math.max(1,Math.min(220,Number(maxLength)||220)),target=Math.min(160,limit);
    const chars=Array.from(normalizeSpeechText(text,true)),chunks=[];
    while(chars.length){let cut=Math.min(target,chars.length);if(chars.length>target){let boundary=0;for(let i=Math.min(79,target-1);i<Math.min(limit,chars.length);i++){if(/[。！？!?\n]/u.test(chars[i])){boundary=i+1;if(boundary>=target)break;}}if(boundary)cut=boundary;}chunks.push(chars.splice(0,cut).join("").trim());}
    return chunks.filter(Boolean);
  };
  class BrowserVoiceAdapter{
    constructor(windowRef=typeof window!=="undefined"?window:null){this.windowRef=windowRef;this.synthesis=windowRef?.speechSynthesis||null;this.Recognition=windowRef?.SpeechRecognition||windowRef?.webkitSpeechRecognition||null;this.queue=[];this.activeUtterance=null;this.playbackState="idle";this.playbackGeneration=0;this.recognition=null;this.callbacks={};this.chunkTimer=null;this.pendingChunk=null;}
    capabilities(){return{tts:Boolean(this.synthesis&&this.windowRef?.SpeechSynthesisUtterance),stt:Boolean(this.Recognition)};}
    getVoices(){try{return this.synthesis?.getVoices?.()||[];}catch{return[];}}
    isSpeaking(){return this.playbackState!=="idle";}
    speak(text,options={}){if(!this.capabilities().tts)return false;if(this.playbackState!=="idle"||this.activeUtterance||this.queue.length)this.stop();else this.playbackGeneration+=1;this.queue=chunkSpeechText(text,options.maxChunkLength||220);if(!this.queue.length)return false;this.playbackState="playing";this.speakNext(options,this.playbackGeneration);return true;}
    speakNext(options,generation){if(generation!==this.playbackGeneration||this.playbackState!=="playing")return;if(!this.queue.length){this.activeUtterance=null;this.playbackState="idle";options.onEnd?.();return;}const utterance=new this.windowRef.SpeechSynthesisUtterance(this.queue.shift());utterance.rate=clamp(options.rate,.6,1.6,1);utterance.pitch=clamp(options.pitch,.7,1.3,1);utterance.volume=clamp(options.volume,0,1,1);const voices=this.getVoices(),voice=voices.find(item=>options.voiceURI&&item.voiceURI===options.voiceURI)||voices.find(item=>options.voiceName&&item.name===options.voiceName&&(!options.voiceLang||item.lang===options.voiceLang));if(voice)utterance.voice=voice;utterance.lang=voice?.lang||options.lang||"zh-CN";this.activeUtterance=utterance;utterance.onstart=()=>{if(generation===this.playbackGeneration&&this.playbackState==="playing")options.onStart?.();};utterance.onend=()=>{if(generation!==this.playbackGeneration||this.playbackState!=="playing")return;this.activeUtterance=null;if(this.queue.length&&this.windowRef.setTimeout){this.pendingChunk=()=>this.speakNext(options,generation);this.chunkTimer=this.windowRef.setTimeout(()=>{this.chunkTimer=null;if(this.playbackState==="playing"){const next=this.pendingChunk;this.pendingChunk=null;next?.();}},120);}else this.speakNext(options,generation);};utterance.onerror=event=>{if(generation!==this.playbackGeneration)return;this.queue=[];this.activeUtterance=null;this.playbackState="idle";options.onError?.(event);};this.synthesis.speak(utterance);}
    pause(){if(this.playbackState!=="playing")return false;this.playbackState="paused";try{this.synthesis?.pause?.();return true;}catch{this.playbackState="playing";return false;}}
    resume(){if(this.playbackState!=="paused")return false;this.playbackState="playing";try{this.synthesis?.resume?.();if(this.pendingChunk&&this.chunkTimer===null){const next=this.pendingChunk;this.pendingChunk=null;next();}return true;}catch{this.playbackState="paused";return false;}}
    stop(){if(this.chunkTimer!==null)this.windowRef.clearTimeout?.(this.chunkTimer);this.chunkTimer=null;this.pendingChunk=null;this.playbackGeneration+=1;this.playbackState="idle";this.queue=[];this.activeUtterance=null;try{this.synthesis?.cancel?.();}catch{/* voice failure is isolated */}}
    startRecognition(options={}){if(!this.capabilities().stt)return false;this.abortRecognition();const recognition=new this.Recognition();this.recognition=recognition;this.callbacks=options;recognition.lang=LANGUAGES.includes(options.lang)?options.lang:"zh-CN";recognition.interimResults=true;recognition.continuous=false;recognition.onstart=()=>options.onStart?.();recognition.onspeechend=()=>options.onRecognizing?.();recognition.onresult=event=>{let interim="",final="";for(let index=event.resultIndex||0;index<event.results.length;index+=1){const value=String(event.results[index][0]?.transcript||"");if(event.results[index].isFinal)final+=value;else interim+=value;}if(interim)options.onInterim?.(interim);if(final)options.onFinal?.(final);};recognition.onerror=event=>options.onError?.(event?.error||"recognition-failed");recognition.onend=()=>{if(this.recognition===recognition)this.recognition=null;options.onEnd?.();};try{recognition.start();return true;}catch(error){this.recognition=null;options.onError?.(error?.name||"recognition-failed");return false;}}
    stopRecognition(){try{this.recognition?.stop?.();}catch{/* isolated */}}
    abortRecognition(){const recognition=this.recognition;if(recognition){for(const event of ["onstart","onspeechend","onresult","onerror","onend"])recognition[event]=null;}try{recognition?.abort?.();}catch{/* isolated */}this.recognition=null;}
  }
  return Object.freeze({SETTINGS_KEY,safeBackgroundAssetId,LANGUAGES,DEFAULT_SETTINGS,sanitizeSettings,normalizeSpeechText,chunkSpeechText,VoiceSettingsStore,BrowserVoiceAdapter});
});
