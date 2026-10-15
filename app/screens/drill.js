import * as answer from "./drill-answer.js";
import { startSession, next, skip } from "./drill-flow.js";
import { App } from "../app.js";

export { startSession, next };
export { keys } from "./drill-answer.js";

export const actions = {
  ...answer.actions,
  "start-drill": () => startSession("drill"),
  "start-weak": () => startSession("weak"),
  next,
  skip,
  "dismiss-intro": () => {
    App.introDismissed = true;
    try { localStorage.setItem("dysp.intro", "1"); } catch {}
  },
};
