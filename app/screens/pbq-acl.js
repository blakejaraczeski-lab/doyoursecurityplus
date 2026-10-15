import { aclReadoutHtml } from "../ui/pbq-acl.js";
import { currentPbq, answersFor } from "./sheet.js";

/** Keep the readable policy in step with the grid without re-rendering it. */
function refreshAclReadout(edited = -1) {
  const el = document.getElementById("acl-readout");
  const pbq = currentPbq();
  if (!el || pbq?.kind !== "acl-table") return;
  el.outerHTML = aclReadoutHtml(pbq.config, answersFor(pbq).rules || [], edited);
}

export const actions = {
  "acl-add": () => {
    const a = answersFor(currentPbq());
    a.rules.push({ action: "permit", protocol: "tcp", src: "any", srcPort: "any", dst: "any", dstPort: "any" });
  },
  "acl-del": (el) => answersFor(currentPbq()).rules.splice(Number(el.dataset.i), 1),
  "acl-up": (el) => {
    const i = Number(el.dataset.i), r = answersFor(currentPbq()).rules;
    [r[i - 1], r[i]] = [r[i], r[i - 1]];
  },
  "acl-down": (el) => {
    const i = Number(el.dataset.i), r = answersFor(currentPbq()).rules;
    [r[i + 1], r[i]] = [r[i], r[i + 1]];
  },
};

/** A grid select changed. Returns true if it was ours. */
export function change(t) {
  if (!t.dataset.acl) return false;
  answersFor(currentPbq()).rules[Number(t.dataset.acl)][t.dataset.k] = t.value;
  // A full render would rebuild the select you are still interacting with and
  // take the focus with it, so the plain-text policy is refreshed on its own.
  refreshAclReadout(Number(t.dataset.acl));
  return true;
}
