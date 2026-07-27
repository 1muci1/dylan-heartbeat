"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const Store = window.CompanionUserPreferences?.UserPreferenceStore;
  if (!Store) return;
  const store = new Store();
  const applyAvatar = (node, avatar) => {
    if (!node) return false;
    if (avatar?.imageData) {
      node.style.backgroundImage = `url(${JSON.stringify(avatar.imageData)})`;
      node.style.backgroundPosition = `${avatar.crop?.x ?? 50}% ${avatar.crop?.y ?? 50}%`;
      node.style.backgroundSize = `${Math.max(1, Number(avatar.scale) || 1) * 100}%`;
      node.classList.add("has-avatar-image");
      return true;
    }
    node.style.removeProperty("background-image");
    node.style.removeProperty("background-position");
    node.style.removeProperty("background-size");
    node.classList.remove("has-avatar-image");
    if (node.classList.contains("message-avatar")) node.textContent = "沉";
    return false;
  };
  const applyAvatars = preferences => {
    const avatar = preferences?.avatar || store.loadSync().avatar;
    const chen = avatar.chenAvatar || avatar;
    document.querySelectorAll(".chat-avatar, .message-avatar").forEach(node => applyAvatar(node, chen));
  };
  const applyTo = node => {
    const avatar = store.loadSync().avatar;
    return applyAvatar(node, avatar.chenAvatar || avatar);
  };
  window.CompanionChatAvatars = Object.freeze({ apply: applyAvatars, applyTo });
  applyAvatars(store.loadSync());
  store.subscribe(applyAvatars);
  store.load().then(applyAvatars).catch(() => {
    // 保留当前头像，异步恢复失败时不回退默认。
  });
  let target = "chen";
  let pending = null;
  const modal = document.createElement("section");
  modal.className = "avatar-editor-modal";
  modal.hidden = true;
  modal.innerHTML = '<div class="avatar-editor" role="dialog" aria-modal="true" aria-labelledby="avatar-editor-title"><button class="avatar-editor__close" type="button" aria-label="关闭">×</button><h2 id="avatar-editor-title">设置头像</h2><p>选择图片后预览，保存即可在设备上恢复。</p><div class="avatar-editor__preview" data-avatar-editor-preview>头像</div><label class="avatar-editor__pick">选择图片<input type="file" accept="image/png,image/jpeg,image/webp" data-avatar-editor-file></label><div class="avatar-editor__actions"><button type="button" data-avatar-editor-cancel>取消</button><button type="button" data-avatar-editor-save disabled>保存</button></div><p role="status" data-avatar-editor-status></p></div>';
  document.body.append(modal);
  const preview = modal.querySelector("[data-avatar-editor-preview]");
  const fileInput = modal.querySelector("[data-avatar-editor-file]");
  const saveButton = modal.querySelector("[data-avatar-editor-save]");
  const status = modal.querySelector("[data-avatar-editor-status]");
  const close = () => { modal.hidden = true; pending = null; if (fileInput) fileInput.value = ""; };
  const open = nextTarget => { target = nextTarget === "user" ? "user" : "chen"; modal.hidden = false; status.textContent = `正在编辑${target === "user" ? "我的头像" : "沉沉头像"}`; };
  document.querySelectorAll("[data-avatar-target]").forEach(button => button.addEventListener("click", () => open(button.dataset.avatarTarget)));
  modal.querySelector(".avatar-editor__close")?.addEventListener("click", close);
  modal.querySelector("[data-avatar-editor-cancel]")?.addEventListener("click", close);
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file || !/^image\/(?:png|jpeg|webp)$/iu.test(file.type) || file.size > 2 * 1024 * 1024) { status.textContent = "请选择 2MB 以内的 PNG、JPG 或 WebP 图片"; saveButton.disabled = true; return; }
    const reader = new FileReader();
    reader.onload = () => { pending = String(reader.result || ""); preview.style.backgroundImage = `url(${JSON.stringify(pending)})`; preview.textContent = ""; saveButton.disabled = false; status.textContent = "预览已更新"; };
    reader.readAsDataURL(file);
  });
  saveButton?.addEventListener("click", () => {
    if (!pending) return;
    try { store.saveAvatar({ source: "upload", imageData: pending, crop: { x: 50, y: 50 }, scale: 1, border: "moon" }, target); status.textContent = "头像已保存"; setTimeout(close, 350); }
    catch (error) { status.textContent = error.message || "头像保存失败"; }
  });
});
