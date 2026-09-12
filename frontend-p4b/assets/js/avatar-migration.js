"use strict";
// Local-only inspection and raster re-encoding. Never fetches remote images or writes storage.
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionAvatarMigration = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const fail = code => Object.assign(new Error("头像无法安全转换，请重新选择 PNG、JPEG 或 WebP 图片。"), {code});
  function inspect(bytes, mime) {
    const n=bytes.length, view=new DataView(bytes.buffer,bytes.byteOffset,n);
    const text=(start,end)=>String.fromCharCode(...bytes.subarray(start,end));
    const signature=n>=8&&text(0,8)==="\x89PNG\r\n\x1a\n"?"image/png":n>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":n>=12&&text(0,4)==="RIFF"&&text(8,12)==="WEBP"?"image/webp":null;
    const checks={};let width=0,height=0,animated=false;
    if(mime==="image/png") {
      checks.minimumLength=n>=45;checks.ihdr=n>=24&&view.getUint32(8)===13&&text(12,16)==="IHDR";
      checks.iend=false;
      for(let i=8;i+12<=n;){const len=view.getUint32(i),tag=text(i+4,i+8);if(i+12+len>n)break;if(tag==="acTL")animated=true;if(tag==="IEND"&&len===0)checks.iend=true;i+=12+len;}
      if(checks.ihdr){width=view.getUint32(16);height=view.getUint32(20);}
    } else if(mime==="image/jpeg") {
      checks.minimumLength=n>=16;checks.terminalEOI=n>=2&&bytes[n-2]===255&&bytes[n-1]===217;
      for(let i=2;i+9<n;){if(bytes[i]!==255){i++;continue;}const marker=bytes[i+1];if([216,217].includes(marker)){i+=2;continue;}const len=view.getUint16(i+2);if(len<2||i+len+2>n)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){width=view.getUint16(i+7);height=view.getUint16(i+5);break;}i+=len+2;}
      checks.dimensionsParsed=Boolean(width&&height);
    } else if(mime==="image/webp") {
      checks.minimumLength=n>=30;checks.riffLength=n>=8&&view.getUint32(4,true)+8<=n;
      const tag=text(12,16);
      if(tag==="VP8X"&&n>=30){width=1+bytes[24]+bytes[25]*256+bytes[26]*65536;height=1+bytes[27]+bytes[28]*256+bytes[29]*65536;animated=Boolean(bytes[20]&2);}
      if(tag==="VP8 "&&n>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;}
      if(tag==="VP8L"&&n>=25&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
      checks.dimensionsParsed=Boolean(width&&height);
    }
    return {mime,bytes:n,signature,mimeMatches:signature===mime,checks,width,height,animated};
  }
  async function decode(file,w) {
    const url=w.URL.createObjectURL(file),image=new w.Image();
    try {await new Promise((resolve,reject)=>{const timer=w.setTimeout(()=>reject(fail("LOCAL_ASSET_DECODE_FAILED")),10000);image.onload=()=>{w.clearTimeout(timer);resolve();};image.onerror=()=>{w.clearTimeout(timer);reject(fail("LOCAL_ASSET_DECODE_FAILED"));};image.src=url;});return image;}
    finally {w.URL.revokeObjectURL(url);}
  }
  async function read(source,w) {
    const file=await w.XinbanThemeGateway.readLocalImage(source,w);
    return {file,info:inspect(new Uint8Array(await file.arrayBuffer()),file.type)};
  }
  async function diagnose(source,w=window) {
    try {const {file,info}=await read(source,w);let decoded=false;
      // Do not invoke a decoder on disguised SVG/HTML or unsupported content.
      if(info.mimeMatches)try{await decode(file,w);decoded=true;}catch{}
      return {...info,decoded};
    } catch(error){return {code:error.code||"LOCAL_ASSET_UNREADABLE",decoded:false};}
  }
  async function normalize(source,w=window) {
    const {file,info}=await read(source,w);
    if(!info.mimeMatches)throw fail("THEME_ASSET_MAGIC_INVALID");
    if(info.animated)throw fail("LOCAL_ASSET_ANIMATED");
    if(!info.width||!info.height||info.width>8192||info.height>8192||info.width*info.height>32*1024*1024)throw fail("THEME_ASSET_DIMENSIONS_INVALID");
    const image=await decode(file,w),width=image.naturalWidth,height=image.naturalHeight;
    if(!width||!height||width>8192||height>8192||width*height>32*1024*1024)throw fail("THEME_ASSET_DIMENSIONS_TOO_LARGE");
    // Keep orientation, full image, dimensions and crop semantics of the browser renderer.
    // Re-encode only when the container needs normalization; standard originals retain exact bytes.
    if(Object.values(info.checks).every(Boolean))return file;
    const canvas=w.document.createElement("canvas");canvas.width=width;canvas.height=height;
    let blob;
    try {const ctx=canvas.getContext("2d");if(!ctx)throw Error();ctx.drawImage(image,0,0);blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));}
    catch {throw fail("LOCAL_ASSET_CANVAS_FAILED");}
    if(!blob||blob.type!=="image/png")throw fail("LOCAL_ASSET_CANVAS_FAILED");
    if(!blob.size||blob.size>2*1024*1024)throw fail("THEME_ASSET_TOO_LARGE");
    // Encoding must preserve the browser-decoded raster, including alpha and color handling.
    try {
      const verify=await decode(blob,w),other=w.document.createElement("canvas");other.width=width;other.height=height;
      const ctx=other.getContext("2d");ctx.drawImage(verify,0,0);
      const before=canvas.getContext("2d").getImageData(0,0,width,height).data,after=ctx.getImageData(0,0,width,height).data;
      if(before.some((value,index)=>value!==after[index]))throw Error();
    } catch {throw fail("LOCAL_ASSET_CANVAS_FAILED");}
    return blob;
  }
  return {inspect,diagnose,normalize};
});
