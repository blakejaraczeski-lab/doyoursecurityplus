import { App } from "../app.js";

export const actions = {
  "bank-all": () => { App.bankAll = !App.bankAll; },
  "expand-mc": (el) => { App.expanded = App.expanded === el.dataset.id ? null : el.dataset.id; },
};
