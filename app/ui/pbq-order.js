import { esc } from "./common.js";

// Chip letters for the click-to-place PBQs; a pool never holds more than ten.
const KEYS_10 = "ABCDEFGHIJ";

// --- drag and order --------------------------------------------------------
//
// The exam calls these drag and drop. This is click to place instead: click the
// item, click where it goes. Same cognitive task, and it works with a keyboard,
// on a touch screen, and for anyone who cannot hold a drag steady. HTML5 drag
// events do none of those things well.
export function orderHtml(pbq, answers, locked) {
  const cfg = pbq.config;
  const held = answers.held || null;

  if (cfg.mode === "sequence") {
    const order = answers.order || [];
    const remaining = cfg.items.filter((i) => !order.includes(i.id));
    const heldItem = cfg.items.find((i) => i.id === held);
    return `
    <div class="card">
      <h2 class="eyebrow">Steps to place${heldItem ? ` &middot; pick a position for "${esc(heldItem.label)}"` : ""}</h2>
      ${remaining.length
        ? `<div class="chip-pool">${remaining.map((i, k) => `
            <button class="chip ${held === i.id ? "held" : ""}" data-action="order-hold" data-item="${esc(i.id)}" aria-pressed="${held === i.id}" ${locked ? "disabled" : ""}>
              <span class="key" aria-hidden="true">${KEYS_10[k]}</span>${esc(i.label)}</button>`).join("")}</div>`
        : `<p class="faint m0">All steps placed. Click one in the sequence to take it back.</p>`}
      ${remaining.length && !held
        ? `<p class="note">Click a step, then click the position it belongs in, or press its letter and then the position's number. You can fill the positions in any order.</p>`
        : ""}
    </div>
    <div class="card">
      <h2 class="eyebrow">${esc(cfg.sequenceLabel || "In order")}</h2>
      <ol class="seq">
        ${cfg.items.map((_, i) => {
          const id = order[i];
          const item = cfg.items.find((x) => x.id === id);
          return `<li class="${item ? "filled" : "empty"}">
            <span class="pos">${i + 1}</span>
            ${item
              ? `<button class="chip placed" data-action="order-unplace" data-i="${i}" aria-label="Position ${i + 1}: ${esc(item.label)}. Take it back" ${locked ? "disabled" : ""}>${esc(item.label)}</button>`
              : `<button class="slot" data-action="order-place-at" data-i="${i}" aria-label="Position ${i + 1}: ${held ? `place ${esc(heldItem?.label || "")} here` : "empty"}" ${locked || !held ? "disabled" : ""}>
                   ${held ? "place here" : "empty"}</button>`}
          </li>`;
        }).join("")}
      </ol>
    </div>`;
  }

  // categorize
  const placements = answers.placements || {};
  const unplaced = cfg.items.filter((i) => !placements[i.id]);
  const heldLabel = cfg.items.find((i) => i.id === held)?.label || "";
  return `
  <div class="card">
    <h2 class="eyebrow">Items to classify${held ? ` &middot; pick a column for "${esc(cfg.items.find((i) => i.id === held)?.label || "")}"` : ""}</h2>
    ${unplaced.length
      ? `<div class="chip-pool">${unplaced.map((i, k) => `
          <button class="chip ${held === i.id ? "held" : ""}" data-action="order-hold" data-item="${esc(i.id)}" aria-pressed="${held === i.id}" ${locked ? "disabled" : ""}>
            <span class="key" aria-hidden="true">${KEYS_10[k]}</span>${esc(i.label)}</button>`).join("")}</div>`
      : `<p class="faint m0">Everything placed. Click an item in a column to take it back.</p>`}
    ${unplaced.length && !held
      ? `<p class="note">Click an item, then click its column, or press its letter and then the column's number.</p>`
      : ""}
  </div>
  <div class="buckets">
    ${cfg.buckets.map((b, k) => `
      <div class="bucket">
        <button class="bucket-head" data-action="order-drop" data-bucket="${esc(b.id)}" aria-label="${esc(b.label)}${held ? `: place ${esc(heldLabel)} here` : ""}" ${locked || !held ? "disabled" : ""}>
          <span class="key" aria-hidden="true">${k + 1}</span>${esc(b.label)}${held ? " &larr; place here" : ""}
        </button>
        <div class="bucket-body">
          ${cfg.items.filter((i) => placements[i.id] === b.id).map((i) => `
            <button class="chip placed" data-action="order-remove" data-item="${esc(i.id)}" aria-label="${esc(i.label)}, in ${esc(b.label)}. Take it back" ${locked ? "disabled" : ""}>
              ${esc(i.label)}</button>`).join("") || `<span class="faint">empty</span>`}
        </div>
      </div>`).join("")}
  </div>`;
}
