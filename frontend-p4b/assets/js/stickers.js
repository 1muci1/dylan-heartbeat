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
  const list = async keyword => {
    const term = String(keyword || "").toLowerCase();
    const [local, imported] = await Promise.all([
      request(`/api/v1/stickers?keyword=${encodeURIComponent(keyword || "")}`).then(payload => payload.data || []),
      request("/api/v1/sticker-imports").then(payload => payload.data || []).catch(() => [])
    ]);
    return local.concat(imported.filter(item => !term
      || `${item.label || ""} ${item.tags || ""}`.toLowerCase().includes(term)));
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
  const previewStickerImport = async file => {
    const body = new FormData(); body.append("file", file);
    return request("/api/v1/sticker-imports/preview", { method: "POST", body });
  };
  const confirmStickerImport = (fileId, selectedIndexes) => request("/api/v1/sticker-imports/confirm", {
    method: "POST", body: JSON.stringify({ fileId, selectedIndexes })
  });
  const listImported = async () => (await request("/api/v1/sticker-imports")).data || [];
  const blobUrl = async pathname => /^https?:\/\//i.test(pathname)
    ? pathname
    : URL.createObjectURL(await request(pathname));
  window.AppMedia = Object.freeze({
    list, uploadSticker, update, remove, restore, uploadImages, uploadChatFiles,
    previewStickerImport, confirmStickerImport, listImported, blobUrl, request
  });
})();
