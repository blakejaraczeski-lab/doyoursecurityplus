import { esc } from "./common.js";
import { fieldVisible } from "../grade-wireless.js";

export function wirelessHtml(pbq, answers, locked) {
  const fields = pbq.config.fields
    .map((f) => {
      const on = fieldVisible(f, answers);
      const val = answers[f.id] ?? "";
      const dis = locked || !on ? "disabled" : "";
      const id = `pf-${f.id}`;
      const input =
        f.type === "select"
          ? `<select id="${id}" data-pbq-field="${f.id}" ${dis}>
               <option value="">&mdash; select &mdash;</option>
               ${f.options.map((o) => `<option value="${esc(o.value)}" ${val === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
             </select>`
          : `<input id="${id}" type="text" data-pbq-field="${f.id}" value="${esc(val)}"
                placeholder="${esc(f.placeholder || "")}" ${dis}>`;
      return `<div class="field-row ${on ? "" : "disabled"}">
                <label for="${id}">${esc(f.label)}${on ? "" : ` <span class="faint">(not applicable)</span>`}</label>
                ${input}
              </div>`;
    })
    .join("");
  return `<div class="card"><h2 class="eyebrow">${esc(pbq.config.deviceName)}</h2>${fields}</div>`;
}
