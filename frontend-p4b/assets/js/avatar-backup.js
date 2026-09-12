"use strict";
// Local recovery only. No network requests, preference writes, or data deletion.
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionAvatarBackup = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const DB_NAME = "personalization-avatar-backup-v79";
  const LEGACY_KEY = "personalization-original-avatars-v79";
  const fail = code => Object.assign(new Error("本机头像备份失败，原有设置已保留。"), {code});
  const digest = async value => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
  const result = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  function transaction(db, mode, run) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["images", "snapshots"], mode);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || fail("LOCAL_BACKUP_FAILED"));
      tx.onerror = () => {}; // Abort, not request success, determines durability.
      try { run(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  class AvatarBackupStore {
    constructor({indexedDB = globalThis.indexedDB, storage = globalThis.localStorage} = {}) {
      this.indexedDB = indexedDB; this.storage = storage;
    }
    open() {
      return new Promise((resolve, reject) => {
        if (!this.indexedDB?.open) return reject(fail("LOCAL_BACKUP_UNAVAILABLE"));
        const request = this.indexedDB.open(DB_NAME, 1);
        let expired = false;
        const timer = setTimeout(() => { expired = true; reject(fail("LOCAL_BACKUP_UNAVAILABLE")); }, 10000);
        request.onupgradeneeded = () => {
          if (expired) { request.transaction.abort(); return; }
          for (const name of ["images", "snapshots"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        };
        request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
      });
    }
    async restore(id) {
      const db = await this.open();
      try {
        const snapshot = await result(db.transaction("snapshots").objectStore("snapshots").get(id));
        if (!snapshot) throw fail("LOCAL_BACKUP_INVALID");
        for (const avatar of Object.values(snapshot)) {
          if (!avatar?.imageData?.blobKey) continue;
          const meta = avatar.imageData;
          const blob = await result(db.transaction("images").objectStore("images").get(meta.blobKey));
          if (!(blob instanceof Blob)) throw fail("LOCAL_BACKUP_INVALID");
          if (meta.encoding === "base64") {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            avatar.imageData = meta.header + btoa(binary);
          } else avatar.imageData = await blob.text();
          if (await digest(avatar.imageData) !== meta.blobKey) throw fail("LOCAL_BACKUP_INVALID");
        }
        if (await digest(JSON.stringify(snapshot)) !== id) throw fail("LOCAL_BACKUP_INVALID");
        return snapshot;
      } finally { db.close(); }
    }
    async ensure(identity) {
      let db;
      try {
        if (Object.values(identity).some(avatar => String(avatar?.imageData || "").startsWith("blob:"))) throw fail("LOCAL_BACKUP_UNAVAILABLE");
        // Existing localStorage backups remain untouched and may satisfy this exact snapshot.
        const legacy = JSON.parse(this.storage?.getItem(LEGACY_KEY) || "[]");
        if (!Array.isArray(legacy)) throw fail("LOCAL_BACKUP_INVALID");
        const serialized = JSON.stringify(identity);
        if (legacy.some(value => JSON.stringify(value) === serialized)) return {kind: "legacy", index: legacy.findIndex(value => JSON.stringify(value) === serialized)};
        const id = await digest(serialized), snapshot = JSON.parse(serialized), images = new Map();
        db = await this.open();
        const exists = await result(db.transaction("snapshots").objectStore("snapshots").get(id));
        if (exists) {
          db.close(); db = null;
          if (JSON.stringify(await this.restore(id)) !== serialized) throw fail("LOCAL_BACKUP_INVALID");
          return {kind: "indexeddb", id};
        }
        for (const avatar of Object.values(snapshot)) {
          const source = avatar?.imageData;
          if (typeof source !== "string" || !source.startsWith("data:")) continue;
          const blobKey = await digest(source), comma = source.indexOf(","), header = source.slice(0, comma + 1), payload = source.slice(comma + 1);
          let blob, encoding = "text";
          // Preserve exact originals, even noncanonical legacy data URLs, without re-encoding pixels.
          if (/;base64,$/iu.test(header) && /^[A-Za-z0-9+/]*={0,2}$/u.test(payload)) {
            try { const binary = atob(payload); if (btoa(binary) === payload) { const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); blob = new Blob([bytes], {type: header.slice(5).split(";")[0]}); encoding = "base64"; } } catch {}
          }
          images.set(blobKey, blob || new Blob([source], {type: "text/plain;charset=utf-8"}));
          avatar.imageData = {blobKey, header, encoding};
        }
        await transaction(db, "readwrite", tx => {
          for (const [key, blob] of images) {
            const store = tx.objectStore("images"), request = store.getKey(key);
            request.onsuccess = () => { if (request.result === undefined) store.put(blob, key); };
          }
          tx.objectStore("snapshots").put(snapshot, id);
        });
        db.close(); db = null;
        // Commit plus a fresh read verifies full images and recovery metadata before bootstrap.
        if (JSON.stringify(await this.restore(id)) !== serialized) throw fail("LOCAL_BACKUP_INVALID");
        return {kind: "indexeddb", id};
      } catch (error) {
        if (error?.name === "QuotaExceededError") throw fail("INDEXEDDB_QUOTA_EXCEEDED");
        if (error?.name === "SyntaxError") throw fail("LOCAL_BACKUP_INVALID");
        throw fail(/^LOCAL_BACKUP_/u.test(error?.code) ? error.code : "LOCAL_BACKUP_FAILED");
      } finally { db?.close(); }
    }
  }
  return {AvatarBackupStore, DB_NAME, LEGACY_KEY};
});
