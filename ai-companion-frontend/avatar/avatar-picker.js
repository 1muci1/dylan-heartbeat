"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionAvatarPicker = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const IMAGE_TYPES = /^image\/(?:png|jpeg|webp)$/iu;
  const MAX_BYTES = 2 * 1024 * 1024;

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
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file || !IMAGE_TYPES.test(file.type) || file.size > MAX_BYTES) {
        status.textContent = "请选择 2MB 以内的 PNG、JPG 或 WebP 图片";
        saveButton.disabled = true;
        return;
      }
      const Reader = windowRef?.FileReader;
      if (!Reader) return;
      const reader = new Reader();
      reader.onload = () => {
        const imageData = String(reader.result || "");
        if (!imageData.startsWith("data:image/")) {
          status.textContent = "图片读取失败，请重新选择";
          return;
        }
        pending = imageData;
        preview.style.backgroundImage = `url(${JSON.stringify(pending)})`;
        preview.textContent = "";
        saveButton.disabled = false;
        status.textContent = "预览已更新";
      };
      reader.readAsDataURL(file);
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

  return { MAX_BYTES, mount };
});
