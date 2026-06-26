# Prospective memory

## The core claims

1. **Prospective memory is "remembering to do future things."**
   Distinct from retrospective memory (remembering past content).
   Examples: remember to take medication; remember to mention
   something next time you see a colleague; remember to follow up
   on a side-quest after the current diversion. The bulk of
   everyday memory failures are prospective failures (Kliegel &
   Martin 2010).
2. **Event-based cues outperform time-based cues.** When the
   intention to act is associated with an external event ("when
   the build finishes, check X"), retrieval is more reliable than
   when associated with a time ("at 3pm, check X") (Sellen et al.
   1997; Einstein & McDaniel 2005). Salience and association
   strength of the cue are the dominant factors.
3. **Spontaneous retrieval beats active monitoring.** The multi-
   process model (McDaniel & Einstein 2005) holds that prospective
   memory works best when the cue *triggers* the intention
   automatically, not when the user has to actively monitor for
   it. Active monitoring consumes working-memory budget and
   competes with the primary task.
4. **Cue salience and cue-intention association quality are
   levers.** Stronger cues, stronger associations, simpler intended
   actions all increase retrieval. Conversely, distraction at the
   moment of cue presentation suppresses retrieval (McDaniel et
   al. 2004 — "delaying execution of intentions").
5. **Interrupted intentions are forgotten quickly without
   support.** Einstein et al. (2003), "Forgetting of intentions in
   demanding situations is rapid," showed even brief delays during
   high-load tasks dramatically reduce intention retrieval.

## Key sources

- **Einstein, G. O., & McDaniel, M. A. (1990).** *Normal aging and
  prospective memory.* JEP: LMC, 16, 717–726. Introduces the
  event-based/time-based distinction in experimental form.
- **Einstein, G. O., & McDaniel, M. A. (2005).** *Prospective
  memory: Multiple retrieval processes.* Current Directions in
  Psychological Science, 14(6), 286–290. The multi-process model.
- **McDaniel, M. A., & Einstein, G. O. (2007).** *Prospective
  Memory: An Overview and Synthesis of an Emerging Field.* Sage.
  Book-length synthesis.
- **Sellen, A. J., Louie, G., Harris, J. E., & Wilkins, A. J.
  (1997).** *What brings intentions to mind? An in situ study of
  prospective memory.* Memory, 4, 483–507. Field study comparing
  event vs time cues; event wins.
- **McDaniel, M., Einstein, G. O., Graham, T., & Rall, E. (2004).**
  *Delaying execution of intentions: Overcoming the costs of
  interruptions.* Applied Cognitive Psychology, 18, 533–547.
- **Einstein, G. O., McDaniel, M. A., Williford, C. L., Pagan, J.
  L., & Dismukes, R. K. (2003).** *Forgetting of intentions in
  demanding situations is rapid.* JEP: Applied, 9(3), 147–162.

Useful secondary: Wikipedia's [Prospective memory](https://en.wikipedia.org/wiki/Prospective_memory)
article covers the multi-process model and the event/time-based
distinction.

## Implications for noggin

- **Items as event-based cues (P2).** Every open item in the noggin
  tree is, definitionally, an intention to act in the future. By
  giving each one a visible, named row in a persistent surface,
  noggin converts internally-stored intentions (poor retrieval)
  into externally-cued ones (good retrieval). This is the deepest
  reason a *tree* of items works: each item is a pre-positioned
  prospective-memory cue.
- **Why the active spine matters (P2).** The path from a root to
  the active item is a sequence of intentions to return to. Each
  parent is the cue for "after I'm done here, I owe this." Without
  the spine, "what should I go back to?" becomes an active
  monitoring problem, which the literature says we're bad at.
- **Title quality is the cue (implicit in P3).** A vague title
  ("misc") is a weak cue; a specific one ("rewrite the YAML
  parser to handle multiline notes") is a strong cue. The agent's
  job under the SKILL is to suggest specific titles, not generic
  ones.
- **Resumption-note template (P2, P5).** Captures the cue at
  suspension. When the user returns, the note is the cue that
  brings the suspended goal-set back. The structured shape
  ("Where I am / What I believe / Ruled out / Decisions in flight
  / Resume by") is engineered to be a strong, multi-channel cue.
- **Persistent visibility (sidebar, status bar) is cue salience.**
  The literature is clear: salient cues > buried cues. The status
  bar item and sidebar tree turn an arbitrary noggin into a
  high-salience cue field.
- **Don't ask the user to *monitor*.** P6's no-nag posture matches
  the multi-process model: active monitoring is expensive and
  competes with the primary task. Instead we let the externalized
  representation do the cueing — the user only consults it when
  they want to.

## Caveats

- Cue quality matters a lot. A noggin full of vague titles is a
  poor cue field. This is partly why the SKILL emphasizes specific,
  active item names — and why the agent's "echo back" rule matters
  (the user sees and can correct the title).
- Even strong cues fail under high cognitive load (Einstein et al.
  2003). Which is one more reason to keep extraneous load low
  (P3, P6) — we need cognitive headroom available *for the cue
  to register*.
