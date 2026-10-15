// The PBQ lab list: an order of attack, last score with best beside it, and
// intro copy that is computed from the content rather than typed.
import { labListView } from "../app/ui/lab.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>The lab list shows an order of attack and the last score</b>");
{
  const pbqs = content.pbqs;
  const view = (rec) => {
    const doc = new DOMParser().parseFromString(labListView({ content, state: { pbq: rec } }), "text/html");
    return { doc, text: doc.body.textContent.replace(/\s+/g, " ") };
  };

  // Nothing attempted: the summary counts them and the weakest button opens the first PBQ.
  const a = view({});
  check(a.text.includes(`${pbqs.length} PBQs`) && a.text.includes(`${pbqs.length} not attempted`),
        "empty record: the summary counts every PBQ as not attempted");
  check(a.doc.querySelector("button[data-id]")?.textContent === "Start the weakest",
        "empty record: the first button is Start the weakest");

  // Two attempts, 90 then 50 on one PBQ: the card reads last 50% in the bad tone, best beside it.
  const [first, second] = pbqs;
  const rec = { [first.id]: { attempts: 2, best: 90, last: 50, lastAt: 1 }, [second.id]: { attempts: 1, best: 95, last: 95, lastAt: 1 } };
  const b = view(rec);
  const card = [...b.doc.querySelectorAll(".card")].find((c) => c.textContent.includes(first.title));
  check(card.querySelector(".tag.bad")?.textContent === "last 50%" && card.textContent.includes("best 90%"),
        "a 90 then a 50 reads last 50% in the bad tone, best 90% beside it");
  const weakest = b.doc.querySelector("button[data-id]");
  const unattempted = pbqs.find((p) => !rec[p.id]);
  check(weakest.dataset.id === unattempted.id, "the weakest button opens an unattempted PBQ before a scored one");

  // Every PBQ attempted: the weakest is the lowest last score; at 90 and above everywhere, no button.
  const all = Object.fromEntries(pbqs.map((p, i) => [p.id, { attempts: 1, best: 100, last: i === 3 ? 40 : 100, lastAt: 1 }]));
  check(view(all).doc.querySelector("button[data-id]")?.dataset.id === pbqs[3].id, "with all attempted, the weakest is the lowest last score");
  const top = Object.fromEntries(pbqs.map((p) => [p.id, { attempts: 1, best: 95, last: 95, lastAt: 1 }]));
  check(view(top).text.includes("Start the weakest") === false, "everything at 90% or above: no Start the weakest");

  // A record from before the last score was kept still reads honestly.
  const old = view({ [first.id]: { attempts: 1, best: 60, lastAt: 1 } });
  check(old.text.includes("best 60%"), "a record without a last score reads best N%");

  // The intro states the real range of targets and the cards no longer show difficulty.
  const mins = pbqs.map((p) => Math.round(p.targetSeconds / 60));
  check(a.text.includes(`Targets run ${Math.min(...mins)} to ${Math.max(...mins)} minutes`), "the intro states the actual range of targets");
  check(!a.text.includes("difficulty") && !a.text.includes("eight minute") && !a.text.includes("Four to five"),
        "no difficulty text, no eight minute claim, no exam count claim");
}
