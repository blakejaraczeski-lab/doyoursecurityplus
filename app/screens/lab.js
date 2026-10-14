import { App } from "../app.js";
import { openPbq } from "./sheet.js";

export const actions = {
  "open-pbq": (el) => {
    App.lab = App.content.pbqsById[el.dataset.id];
    openPbq(App.lab);
    App.screen = "lab-run";
  },
};
