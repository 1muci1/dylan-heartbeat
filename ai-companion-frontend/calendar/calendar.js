"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionCalendar = Object.freeze(api);
  if (typeof document !== "undefined") api.mount(document, root);
})(typeof window !== "undefined" ? window : null, () => {
  const RELATIONSHIP_START_DATE = "2026-07-01";
  const pad = value => String(value).padStart(2, "0");
  const relationshipDays = (date, startDate = RELATIONSHIP_START_DATE) => {
    const [year, month, day] = String(startDate).split("-").map(Number);
    const start = new Date(year, month - 1, day);
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.max(1, Math.floor((today - start) / 86400000) + 1);
  };
  const monthLabel = date => `${date.getFullYear()}年${date.getMonth() + 1}月`;
  const renderMonth = (documentRef, date, today = new Date()) => {
    const grid = documentRef.querySelector("[data-calendar-grid]");
    const label = documentRef.querySelector("[data-calendar-month]");
    if (!grid || !label) return;
    label.textContent = monthLabel(date);
    grid.replaceChildren();
    const first = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    const total = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    for (let index = 0; index < first; index += 1) grid.append(documentRef.createElement("span"));
    for (let day = 1; day <= total; day += 1) {
      const cell = documentRef.createElement("time");
      cell.textContent = String(day);
      cell.dateTime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(day)}`;
      cell.setAttribute("role", "gridcell");
      if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && day === today.getDate()) cell.className = "is-today";
      if (cell.dateTime === RELATIONSHIP_START_DATE) cell.classList.add("is-important");
      grid.append(cell);
    }
  };
  const mount = (documentRef, windowRef) => {
    const now = new windowRef.Date();
    let current = new windowRef.Date(now.getFullYear(), now.getMonth(), 1);
    const update = () => renderMonth(documentRef, current, now);
    documentRef.querySelector("[data-calendar-prev]")?.addEventListener("click", () => { current = new windowRef.Date(current.getFullYear(), current.getMonth() - 1, 1); update(); });
    documentRef.querySelector("[data-calendar-next]")?.addEventListener("click", () => { current = new windowRef.Date(current.getFullYear(), current.getMonth() + 1, 1); update(); });
    const days = documentRef.querySelector("[data-calendar-days]");
    if (days) days.textContent = String(relationshipDays(now));
    update();
  };
  return { RELATIONSHIP_START_DATE, relationshipDays, renderMonth, monthLabel, mount };
});
