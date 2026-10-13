# Observing one person who is not Blake

Every check in `bin/check` was written by someone who knows where everything
is. This protocol is the one test that cannot be written that way. It takes
ten minutes and one other person who is studying for anything, a driving
theory test, a language, a certification; they do not need to know security.

## Before they sit down

1. Start a server on its own throwaway data, so nothing they do touches real
   progress:

   ```
   DYSP_DATA=/tmp/dysp-observe python3 serve.py 8790
   ```

2. Open `http://localhost:8790/` in a fresh browser window, at the size they
   would really use. Do not open any other screen first.
3. Have a phone timer and this file open where they cannot see it.

## What to say, once, then nothing

> This is a study tool. I am testing the tool, not you. I will give you three
> things to do. Please think out loud while you do them. I am not allowed to
> help or answer questions, so if you get stuck, say what you are looking for
> and keep going, or move on.

From then on the observer says nothing. No pointing, no "try the left side",
no "that is right". Silence is the method: the moment they hesitate is the
data, and a hint erases it. If they ask a question, write it down and say
"what would you try?" and nothing else.

## The three tasks

Read each one out, then start the timer. Stop each at its limit whether or
not it is finished; an unfinished task is a finding, not a failure.

1. **Answer five questions. On one of them, tell the app you are guessing.**
   Four minutes. Watches: whether the keys or the guess control are found
   without being taught, whether the verdict is noticed, whether Next is found.
2. **Find out what the app thinks you should study next, and how long it
   thinks you need.** Three minutes. Watches: whether they reach Readiness,
   and whether the forecast, the hours and the booking rule mean anything to
   someone who did not design them.
3. **In the PBQ lab, open "Incident response, in order" and put the steps in
   order.** Three minutes. They will not know the right order; that does not
   matter. Watches: whether click to place is discovered, whether a held step
   is understood as held, whether they can undo a placement.

## What to write down

One row per moment of hesitation: a pause of more than about two seconds, a
wrong click, a question asked out loud, a frown, a scroll that hunts. Write
what you saw, not what you think caused it. Propose the fix afterwards, not
during.

| Time | Moment of hesitation | What they were trying to do | What the screen offered | Proposed fix |
|---|---|---|---|---|
| | | | | |

## Afterwards

Ask one question only: "What was the most confusing moment?" Write the answer
under the table in their words. Then delete `/tmp/dysp-observe`.

The next interface pass starts from whatever is written here.
