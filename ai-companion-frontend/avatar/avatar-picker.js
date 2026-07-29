"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionAvatarPicker = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const IMAGE_TYPES = /^image\/(?:png|jpeg|webp)$/iu;
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const readAsDataUrl = (file, windowRef) => new Promise((resolve, reject) => {
    const Reader = windowRef?.FileReader;
    if (!Reader) return reject(new Error("当前浏览器无法读取图片"));
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择"));
    reader.readAsDataURL(file);
  });
  const optimizeImageFile = async (file, {
    windowRef,
    documentRef,
    maxDimension = 512,
    quality = .84
  } = {}) => {
    const original = await readAsDataUrl(file, windowRef);
    if (!original.startsWith("data:image/")) throw new Error("图片读取失败，请重新选择");
    const ImageCtor = windowRef?.Image;
    if (!ImageCtor || !documentRef?.createElement) return original;
    try {
      const image = await new Promise((resolve, reject) => {
        const instance = new ImageCtor();
        instance.onload = () => resolve(instance);
        instance.onerror = reject;
        instance.src = original;
      });
      const longest = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
      if (!longest || (longest <= maxDimension && file.size <= MAX_BYTES)) return original;
      const scale = Math.min(1, maxDimension / longest);
      const canvas = documentRef.createElement("canvas");
      canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const context = canvas.getContext?.("2d");
      if (!context) return original;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const type = file.type === "image/png" ? "image/webp" : file.type;
      const optimized = canvas.toDataURL?.(type, quality);
      return String(optimized || "").startsWith("data:image/") ? optimized : original;
    } catch {
      return original;
    }
  };

  const mount = ({ documentRef, windowRef, store, selector = "[data-avatar-target]" } = {}) => {
    if (!documentRef?.createElement || !documentRef?.body || !store?.saveAvatar) return null;
    let target = "user";
    let pending = null;
    const modal = documentRef.createElement("section");
    modal.className = "avatar-editor-modal";
    modal.hidden = true;
    modal.innerHTML = '<div class="avatar-editor" role="dialog" aria-modal="true" aria-labelledby="avatar-editor-title"><button class="avatar-editor__close" type="button" aria-label="关闭">×</button><h2 id="avatar-editor-title">设置头像</h2><p>选择图片后预览，保存即可在设备上恢复。</p><div class="avatar-editor__preview" data-avatar-editor-preview>头像</div><label class="avatar-editor__pick">选择图片<input type="file" accept="image/png,image/jpeg,image/webp" data-avatar-editor-file></label><div class="avatar-editor__actions"><button type="button" data-avatar-editor-cancel>取消</button><button type="button" data-avatar-editor-save disabled>保存</button></div><p role="status" data-avatar-editor-status></p></div>';
    documentRef.body.append(modal);
    const preview = modal.querySelector("[data-avatar-editor-preview]");
    const fileInput = modal.querySelector("[data-avatar-editor-file]");
    const saveButton = modal.querySelector("[data-avatar-editor-save]");
    const status = modal.querySelector("[data-avatar-editor-status]");
    const close = () => {
      modal.hidden = true;
      pending = null;
      if (fileInput) fileInput.value = "";
    };
    const open = nextTarget => {
      target = nextTarget === "chen" ? "chen" : "user";
      modal.hidden = false;
      status.textContent = `正在编辑${target === "user" ? "我的头像" : "沉沉头像"}`;
      if (fileInput) {
        fileInput.value = "";
        fileInput.click();
      }
    };
    documentRef.querySelectorAll(selector).forEach(trigger => {
      trigger.addEventListener("click", () => open(trigger.dataset.avatarTarget));
    });
    modal.querySelector(".avatar-editor__close")?.addEventListener("click", close);
    modal.querySelector("[data-avatar-editor-cancel]")?.addEventListener("click", close);
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file || !IMAGE_TYPES.test(file.type) || file.size > MAX_SOURCE_BYTES) {
        status.textContent = "请选择 12MB 以内的 PNG、JPG 或 WebP 图片";
        saveButton.disabled = true;
        return;
      }
      saveButton.disabled = true;
      status.textContent = "正在压缩图片…";
      try {
        const imageData = await optimizeImageFile(file, { windowRef, documentRef, maxDimension: 512, quality: .84 });
        if (imageData.length > MAX_BYTES * 1.4) throw new Error("图片压缩后仍然过大，请选择更小的图片");
        pending = imageData;
        preview.style.backgroundImage = `url(${JSON.stringify(pending)})`;
        preview.textContent = "";
        saveButton.disabled = false;
        status.textContent = "预览已更新";
      } catch (error) {
        pending = null;
        status.textContent = error.message || "图片处理失败，请重新选择";
      }
    });
    saveButton?.addEventListener("click", () => {
      if (!pending || pending.startsWith("blob:")) return;
      try {
        store.saveAvatar({
          source: "upload",
          imageData: pending,
          crop: { x: 50, y: 50 },
          scale: 1,
          border: "moon"
        }, target);
        status.textContent = "头像已保存";
        windowRef?.setTimeout?.(close, 350);
      } catch (error) {
        status.textContent = error.message || "头像保存失败";
      }
    });
    return Object.freeze({ close, fileInput, modal, open });
  };

  return { MAX_BYTES, MAX_SOURCE_BYTES, mount, optimizeImageFile };
});
