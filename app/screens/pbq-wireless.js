import { renderApp } from "../app.js";
import { currentPbq, answersFor } from "./sheet.js";

/** A wireless field changed. Returns true if it was ours. */
export function change(t) {
  if (!t.dataset.pbqField) return false;
  answersFor(currentPbq())[t.dataset.pbqField] = t.value;
  renderApp();
  return true;
}
