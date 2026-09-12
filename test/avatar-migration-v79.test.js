"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect,normalize,diagnose}=require('../frontend-p4b/assets/js/avatar-migration');
const Gateway=require('../frontend-p4b/assets/js/theme-gateway');
const images=require('./fixtures/personalization-images-v79.json');
for(const [type,data] of Object.entries(images))test(`v79 avatar real ${type} signature and structure`,()=>{
 const info=inspect(Buffer.from(data.split(',')[1],'base64'),'image/'+type);
 assert.equal(info.mimeMatches,true);assert.ok(Object.values(info.checks).every(Boolean));assert.equal(info.width,16);assert.equal(info.height,16);
});
test('v79 legacy JPEG terminal marker explains strict rejection, without changing bytes',()=>{
 const bytes=Buffer.concat([Buffer.from(images.jpeg.split(',')[1],'base64'),Buffer.from([0,0])]),copy=Buffer.from(bytes),info=inspect(bytes,'image/jpeg');
 assert.equal(info.mimeMatches,true);assert.equal(info.checks.terminalEOI,false);assert.equal(info.checks.dimensionsParsed,true);assert.deepEqual(bytes,copy);
});
test('v79 mismatch and disguised HTML fail before decoder or network access',async()=>{
 const w={Blob,File,atob,XinbanThemeGateway:Gateway};
 for(const data of [images.png.replace('image/png','image/jpeg'),'data:image/png;base64,PGh0bWw+'])await assert.rejects(normalize(data,w),e=>e.code==='THEME_ASSET_MAGIC_INVALID');
 const report=await diagnose(images.png.replace('image/png','image/jpeg'),w);assert.equal(report.decoded,false);assert.equal(report.mimeMatches,false);assert.doesNotMatch(JSON.stringify(report),/base64|data:|html/);
});
test('v79 diagnostic excludes source data and never fetches external URLs',async()=>{
 const w={Blob,File,atob,XinbanThemeGateway:Gateway,fetch:()=>{throw Error('must not fetch')}};
 assert.deepEqual(await diagnose('https://example.test/private.png',w),{code:'LOCAL_ASSET_UNSUPPORTED',decoded:false});
});
