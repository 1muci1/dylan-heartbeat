(() => {
  const config = () => window.AppConfig?.getProviderConfig?.() || {};
  const url = pathname => `${String(config().baseUrl || "").replace(/\/+$/, "")}${pathname}`;
  const headers = json => {
    const result = json ? { "Content-Type": "application/json" } : {};
    if (config().auth?.type === "bearer" && config().auth.token) result.Authorization = `Bearer ${config().auth.token}`;
    return result;
  };
  async function request(pathname, options = {}) {
    const response = await fetch(url(pathname), { cache: "no-store", ...options, headers: { ...headers(options.body && !(options.body instanceof FormData)), ...(options.headers || {}) } });
    if (!response.ok) { let payload; try { payload = await response.json(); } catch {} throw new Error(payload?.error?.message || `请求失败（${response.status}）`); }
    return response.headers.get("content-type")?.includes("application/json") ? response.json() : response.blob();
  }
  const normalizeStatus = value => {
    if (value?.status) return String(value.status);
    if (value?.enabled === false || value?.active === false || value?.using === false) return "disabled";
    return "active";
  };
  const normalizeStickerItem = (value, pack = {}) => {
    if (!value || typeof value !== "object") return null;
    const urlValue = String(value.url || value.imageUrl || "").trim();
    if (!urlValue) return null;
    const tagsValue = Array.isArray(value.tags) ? value.tags.join(" ") : String(value.tags || "");
    return {
      id: String(value.id || ""),
      url: urlValue,
      label: String(value.label || value.description || "Sticker"),
      description: String(value.description || value.label || ""),
      tags: tagsValue,
      status: normalizeStatus(
        ["status", "enabled", "active", "using"].some(field => Object.prototype.hasOwnProperty.call(value, field))
          ? value
          : pack
      ),
      packId: String(value.packId || pack.id || pack.packId || ""),
      imported: value.imported === true || pack.imported === true || Boolean(pack.items || pack.stickers)
    };
  };
  const normalizeStickerPack = value => {
    if (!value || typeof value !== "object") return [];
    const items = Array.isArray(value.items) ? value.items
      : Array.isArray(value.stickers) ? value.stickers
        : null;
    if (!items) {
      const item = normalizeStickerItem(value);
      return item ? [item] : [];
    }
    return items.map(item => normalizeStickerItem(item, value)).filter(Boolean);
  };
  const normalizeStickerPacks = values => (Array.isArray(values) ? values : [])
    .flatMap(normalizeStickerPack);
  const normalizeStickerUrl = value => {
    const raw = String(value || "").trim();
    try {
      const parsed = new URL(raw, window.location?.origin || "http://local.invalid");
      parsed.hash = "";
      parsed.hostname = parsed.hostname.toLowerCase();
      return raw.startsWith("/") ? `${parsed.pathname}${parsed.search}` : parsed.toString();
    } catch { return raw; }
  };
  const dedupeStickers = values => {
    const seen = new Set();
    return values.filter(item => {
      const key = normalizeStickerUrl(item.url);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const matchesSticker = (item, keyword) => {
    const term = String(keyword || "").trim().toLowerCase();
    return !term || `${item.description} ${item.label} ${item.tags}`.toLowerCase().includes(term);
  };
  const listLocal = async (keyword = "", status = "active") => {
    const payload = await request(`/api/v1/stickers?keyword=${encodeURIComponent(keyword)}&status=${encodeURIComponent(status)}`);
    return normalizeStickerPacks(payload.data || [])
      .filter(item => status !== "active" || item.status === "active")
      .filter(item => matchesSticker(item, keyword));
  };
  const listImported = async keyword => {
    const payload = await request("/api/v1/sticker-imports");
    return normalizeStickerPacks(payload.data || [])
      .filter(item => item.status === "active")
      .filter(item => matchesSticker(item, keyword));
  };
  const list = async keyword => {
    const [local, imported] = await Promise.all([
      listLocal(keyword),
      listImported(keyword)
    ]);
    return dedupeStickers(local.concat(imported));
  };
  const uploadSticker = async (file, label, tags) => { const body = new FormData(); body.append("label", label || ""); body.append("tags", tags || ""); body.append("file", file); return (await request("/api/v1/stickers", { method: "POST", body })).data; };
  const update = async (id, values) => (await request(`/api/v1/stickers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) })).data;
  const remove = id => request(`/api/v1/stickers/${encodeURIComponent(id)}`, { method: "DELETE" });
  const restore = id => request(`/api/v1/stickers/${encodeURIComponent(id)}/restore`, { method: "POST" });
  const uploadImages = (files, sessionId, onProgress) => new Promise((resolve, reject) => {
    const body = new FormData(); files.forEach(file => body.append("images", file));
    const xhr = new XMLHttpRequest(); xhr.open("POST", url("/api/v1/chat/uploads/images"));
    const auth = headers(); if (auth.Authorization) xhr.setRequestHeader("Authorization", auth.Authorization);
    if (sessionId) xhr.setRequestHeader("X-Session-Id", sessionId);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(`正在上传 ${Math.round(event.loaded / event.total * 100)}%`); };
    xhr.onerror = () => reject(new Error("图片上传网络中断，文字和图片仍保留在输入区"));
    xhr.onload = () => { let payload; try { payload = JSON.parse(xhr.responseText); } catch {} if (xhr.status >= 200 && xhr.status < 300) { onProgress?.("上传完成"); resolve(payload.data); } else reject(new Error(payload?.error?.message || `上传失败（${xhr.status}）`)); };
    xhr.send(body);
  });
  const uploadChatFiles = async files => {
    const body = new FormData(); files.forEach(file => body.append("files", file));
    const payload = await request("/api/v1/uploads/chat-file", { method: "POST", body });
    return payload.data || [];
  };
  const uploadChatFile = async file => (await uploadChatFiles([file]))[0];
  const previewStickerImport = async file => {
    const body = new FormData(); body.append("file", file);
    return request("/api/v1/sticker-imports/preview", { method: "POST", body });
  };
  const confirmStickerImport = (fileId, selectedIndexes) => request("/api/v1/sticker-imports/confirm", {
    method: "POST", body: JSON.stringify({ fileId, selectedIndexes })
  });
  const blobUrl = async pathname => /^https?:\/\//i.test(pathname)
    ? pathname
    : URL.createObjectURL(await request(pathname));
  window.AppMedia = Object.freeze({
    list, listLocal, listImported, normalizeStickerItem, normalizeStickerPack, dedupeStickers,
    uploadSticker, update, remove, restore, uploadImages, uploadChatFile, uploadChatFiles,
    previewStickerImport, confirmStickerImport, blobUrl, request
  });
})();
