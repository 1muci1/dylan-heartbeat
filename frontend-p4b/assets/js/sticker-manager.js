document.addEventListener("DOMContentLoaded", () => {
  const media = window.AppMedia; if (!media) return;
  const form = document.querySelector(".sticker-upload"), grid = document.querySelector(".manager-grid"), search = document.querySelector(".manager-tools input"), statusSelect = document.querySelector(".manager-tools select"), status = document.querySelector(".manager-status");
  const importSection = document.querySelector(".sticker-import");
  const importFile = importSection?.querySelector("input[type=file]");
  const importPreview = importSection?.querySelector(".import-preview");
  const importGrid = importSection?.querySelector(".import-preview-grid");
  const importStatus = importSection?.querySelector(".import-status");
  let previewPayload = null;
  async function load() {
    try {
      const items = statusSelect.value === "active"
        ? await media.list(search.value)
        : await media.listLocal(search.value, statusSelect.value);
      grid.replaceChildren();
      for (const item of items) {
        const card = document.createElement("article"); card.className = "manager-card";
        const img = document.createElement("img"); img.alt = item.label || "Sticker"; img.loading = "lazy";
        media.blobUrl(item.url).then(url => img.src = url);
        const title = document.createElement("strong"); title.textContent = item.label || "未命名";
        const tags = document.createElement("small"); tags.textContent = item.tags || "无标签";
        card.append(img, title, tags);
        if (!item.imported) {
          const actions = document.createElement("div"); actions.className = "manager-actions";
          const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "编辑";
          edit.onclick = async () => {
            const label = prompt("名称", item.label || ""); if (label === null) return;
            const values = prompt("标签", item.tags || ""); if (values === null) return;
            await media.update(item.id, { label, tags: values }); load();
          };
          const toggle = document.createElement("button"); toggle.type = "button";
          toggle.textContent = item.status === "deleted" ? "恢复" : "删除";
          toggle.onclick = async () => {
            if (item.status !== "deleted" && !confirm("确定软删除这个 Sticker？")) return;
            await (item.status === "deleted" ? media.restore(item.id) : media.remove(item.id)); load();
          };
          actions.append(edit, toggle); card.append(actions);
        }
        grid.append(card);
      }
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener("submit",async event=>{event.preventDefault();const file=form.querySelector("input[type=file]").files[0];if(!file)return;try{status.textContent="正在上传…";await media.uploadSticker(file,form.elements.label.value,form.elements.tags.value);form.reset();status.textContent="上传完成";load()}catch(error){status.textContent=error.message;}});search.addEventListener("input",load);statusSelect.addEventListener("change",load);load();
  importSection?.querySelector("[data-sticker-import-preview]")?.addEventListener("click", async () => {
    if (!importFile.files[0]) { importStatus.textContent = "请先选择表情包文件"; return; }
    try {
      importStatus.textContent = "正在识别文件…";
      previewPayload = await media.previewStickerImport(importFile.files[0]);
      importGrid.replaceChildren();
      previewPayload.items.forEach(item => {
        const card = document.createElement("label"); card.className = "import-item";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = true; checkbox.value = item.index;
        const image = document.createElement("img"); image.alt = item.description || "待确认表情"; image.loading = "lazy";
        if (item.imageUrl) image.src = item.imageUrl;
        else if (item.uploadFile && importFile.files[0]?.type?.startsWith("image/")) {
          image.src = URL.createObjectURL(importFile.files[0]);
        }
        const text = document.createElement("span"); text.textContent = item.description || "缺少描述，需要确认";
        card.append(checkbox, image, text); importGrid.append(card);
      });
      importPreview.hidden = false;
      importStatus.textContent = `识别到 ${previewPayload.items.length} 个候选，请确认后导入`;
    } catch (error) {
      previewPayload = null; importPreview.hidden = true;
      importStatus.textContent = error.message || "表情包识别失败";
    }
  });
  importSection?.querySelector("[data-sticker-import-confirm]")?.addEventListener("click", async () => {
    if (!previewPayload) return;
    const selectedIndexes = [...importGrid.querySelectorAll("input:checked")].map(input => Number(input.value));
    try {
      importStatus.textContent = "正在导入…";
      const result = await media.confirmStickerImport(previewPayload.fileId, selectedIndexes);
      importStatus.textContent = `已导入 ${result.importedCount} 个，跳过 ${result.skippedDuplicateCount || 0} 个重复表情。`;
      previewPayload = null; importPreview.hidden = true; importFile.value = "";
      load();
    } catch (error) { importStatus.textContent = error.message || "表情包导入失败"; }
  });
});
