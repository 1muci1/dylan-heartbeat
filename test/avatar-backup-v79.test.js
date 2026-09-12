"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {AvatarBackupStore,LEGACY_KEY}=require('../frontend-p4b/assets/js/avatar-backup');
const images=require('./fixtures/personalization-images-v79.json');
const identity={userAvatar:{imageData:images.png,crop:{x:23,y:61,zoom:1.4},scale:1.4},chenAvatar:{imageData:images.jpeg,crop:{x:61,y:22},scale:1.2}};
test('existing exact legacy avatar backup is reusable without any localStorage write or IndexedDB',async()=>{
 const raw=JSON.stringify([identity]);let reads=0;const backup=new AvatarBackupStore({indexedDB:null,storage:{getItem:key=>{assert.equal(key,LEGACY_KEY);reads++;return raw;},setItem:()=>assert.fail('must not write')}});
 assert.deepEqual(await backup.ensure(identity),{kind:'legacy',index:0});assert.deepEqual(await backup.ensure(identity),{kind:'legacy',index:0});assert.equal(reads,2);
});
for(const raw of ['{','{}','null'])test(`invalid old backup fails closed without modifying it (${raw})`,async()=>{
 const backup=new AvatarBackupStore({indexedDB:null,storage:{getItem:()=>raw,setItem:()=>assert.fail('must not write')}});
 await assert.rejects(backup.ensure(identity),e=>e.code==='LOCAL_BACKUP_INVALID');
});
test('missing IndexedDB never falls back to copying originals into localStorage',async()=>{
 const backup=new AvatarBackupStore({indexedDB:null,storage:{getItem:()=>null,setItem:()=>assert.fail('must not write')}});
 await assert.rejects(backup.ensure(identity),e=>e.code==='LOCAL_BACKUP_UNAVAILABLE');
});
test('temporary blob URL cannot masquerade as a durable backup reference',async()=>{
 const value={userAvatar:{imageData:'blob:https://fixture.test/transient'}};
 const backup=new AvatarBackupStore({indexedDB:null,storage:{getItem:()=>JSON.stringify([value])}});
 await assert.rejects(backup.ensure(value),e=>e.code==='LOCAL_BACKUP_UNAVAILABLE');
});
