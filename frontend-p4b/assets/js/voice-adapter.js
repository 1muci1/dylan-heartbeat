(function(root,factory){"use strict";const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.CompanionVoice=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const SETTINGS_KEY="xinban-voice-settings-v1";
  const LANGUAGES=Object.freeze(["zh-CN","zh-TW","ja-JP","en-US"]);
  const DEFAULT_SETTINGS=Object.freeze({version:1,autoRead:false,voiceURI:"",voiceName:"",voiceLang:"",rate:1,pitch:1,volume:1,recognitionLanguage:"zh-CN",showInterimTranscript:true});
  const clamp=(value,min,max,fallback)=>{const number=Number(value);return Number.isFinite(number)?Math.min(max,Math.max(min,number)):fallback;};
  const sanitizeSettings=value=>{const input=value&&typeof value==="object"?value:{};return{version:1,autoRead:input.autoRead===true,voiceURI:String(input.voiceURI||"").slice(0,300),voiceName:String(input.voiceName||"").slice(0,200),voiceLang:String(input.voiceLang||"").slice(0,35),rate:clamp(input.rate,.6,1.6,1),pitch:clamp(input.pitch,.7,1.3,1),volume:clamp(input.volume,0,1,1),recognitionLanguage:LANGUAGES.includes(input.recognitionLanguage)?input.recognitionLanguage:"zh-CN",showInterimTranscript:input.showInterimTranscript!==false};};
  class VoiceSettingsStore{
    constructor(storage){this.storage=storage||null;}
    load(){try{return sanitizeSettings(JSON.parse(this.storage?.getItem(SETTINGS_KEY)||"null"));}catch{return{...DEFAULT_SETTINGS};}}
    save(value){const next=sanitizeSettings(value);this.storage?.setItem(SETTINGS_KEY,JSON.stringify(next));return next;}
  }
  const normalizeSpeechText=text=>String(text||"")
    .replace(/```[\s\S]*?```/gu," ").replace(/`[^`]*`/gu," ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu,"$1").replace(/\[([^\]]+)\]\([^)]*\)/gu,"$1")
    .replace(/(?:https?:\/\/|www\.)\S+/giu," ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu,"")
    .replace(/[~*_]{1,3}/gu,"").replace(/\s+/gu," ").trim();
  const chunkSpeechText=(text,maxLength=220)=>{const normalized=normalizeSpeechText(text);if(!normalized)return[];const chunks=[];let rest=normalized;while(rest.length>maxLength){let cut=-1;for(let i=Math.min(maxLength,rest.length-1);i>=Math.floor(maxLength*.55);i-=1){if(/[。！？!?；;，,\n]/u.test(rest[i])){cut=i+1;break;}}if(cut<1)cut=maxLength;chunks.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}if(rest)chunks.push(rest);return chunks;};
  class BrowserVoiceAdapter{
    constructor(windowRef=typeof window!=="undefined"?window:null){this.windowRef=windowRef;this.synthesis=windowRef?.speechSynthesis||null;this.Recognition=windowRef?.SpeechRecognition||windowRef?.webkitSpeechRecognition||null;this.queue=[];this.activeUtterance=null;this.playbackState="idle";this.playbackGeneration=0;this.recognition=null;this.callbacks={};}
    capabilities(){return{tts:Boolean(this.synthesis&&this.windowRef?.SpeechSynthesisUtterance),stt:Boolean(this.Recognition)};}
    getVoices(){try{return this.synthesis?.getVoices?.()||[];}catch{return[];}}
    isSpeaking(){return this.playbackState!=="idle";}
    speak(text,options={}){if(!this.capabilities().tts)return false;if(this.playbackState!=="idle"||this.activeUtterance||this.queue.length)this.stop();else this.playbackGeneration+=1;this.queue=chunkSpeechText(text,options.maxChunkLength||220);if(!this.queue.length)return false;this.playbackState="playing";this.speakNext(options,this.playbackGeneration);return true;}
    speakNext(options,generation){if(generation!==this.playbackGeneration||this.playbackState!=="playing")return;if(!this.queue.length){this.activeUtterance=null;this.playbackState="idle";options.onEnd?.();return;}const utterance=new this.windowRef.SpeechSynthesisUtterance(this.queue.shift());utterance.rate=clamp(options.rate,.6,1.6,1);utterance.pitch=clamp(options.pitch,.7,1.3,1);utterance.volume=clamp(options.volume,0,1,1);const voices=this.getVoices(),voice=voices.find(item=>options.voiceURI&&item.voiceURI===options.voiceURI)||voices.find(item=>options.voiceName&&item.name===options.voiceName&&(!options.voiceLang||item.lang===options.voiceLang));if(voice)utterance.voice=voice;utterance.lang=voice?.lang||options.lang||"zh-CN";this.activeUtterance=utterance;utterance.onend=()=>{if(generation!==this.playbackGeneration||this.playbackState!=="playing")return;this.activeUtterance=null;this.speakNext(options,generation);};utterance.onerror=event=>{if(generation!==this.playbackGeneration)return;this.queue=[];this.activeUtterance=null;this.playbackState="idle";options.onError?.(event);};this.synthesis.speak(utterance);}
    pause(){if(this.playbackState!=="playing")return false;this.playbackState="paused";try{this.synthesis?.pause?.();return true;}catch{this.playbackState="playing";return false;}}
    resume(){if(this.playbackState!=="paused")return false;this.playbackState="playing";try{this.synthesis?.resume?.();return true;}catch{this.playbackState="paused";return false;}}
    stop(){this.playbackGeneration+=1;this.playbackState="idle";this.queue=[];this.activeUtterance=null;try{this.synthesis?.cancel?.();}catch{/* voice failure is isolated */}}
    startRecognition(options={}){if(!this.capabilities().stt)return false;this.abortRecognition();const recognition=new this.Recognition();this.recognition=recognition;this.callbacks=options;recognition.lang=LANGUAGES.includes(options.lang)?options.lang:"zh-CN";recognition.interimResults=true;recognition.continuous=false;recognition.onstart=()=>options.onStart?.();recognition.onspeechend=()=>options.onRecognizing?.();recognition.onresult=event=>{let interim="",final="";for(let index=event.resultIndex||0;index<event.results.length;index+=1){const value=String(event.results[index][0]?.transcript||"");if(event.results[index].isFinal)final+=value;else interim+=value;}if(interim)options.onInterim?.(interim);if(final)options.onFinal?.(final);};recognition.onerror=event=>options.onError?.(event?.error||"recognition-failed");recognition.onend=()=>{if(this.recognition===recognition)this.recognition=null;options.onEnd?.();};try{recognition.start();return true;}catch(error){this.recognition=null;options.onError?.(error?.name||"recognition-failed");return false;}}
    stopRecognition(){try{this.recognition?.stop?.();}catch{/* isolated */}}
    abortRecognition(){try{this.recognition?.abort?.();}catch{/* isolated */}this.recognition=null;}
  }
  return Object.freeze({SETTINGS_KEY,LANGUAGES,DEFAULT_SETTINGS,sanitizeSettings,normalizeSpeechText,chunkSpeechText,VoiceSettingsStore,BrowserVoiceAdapter});
});
