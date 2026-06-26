# Interruption and task switching

## The core claims

1. **Task-switching has a cost.** Even simple switches between
   tasks produce measurable slowdowns and error increases — the
   "switch cost" (Monsell 2003). The cost has two components: the
   time to re-configure the cognitive system for the new task, and
   residual interference from the just-abandoned one.
2. **Workplace interruptions are pervasive and costly.** Gloria
   Mark's field studies of information workers find people are
   interrupted (or self-interrupt) every few minutes; recovery to
   the original task — when it happens at all — takes
   substantially longer than the interruption itself. The widely
   cited "~23 minutes to return to a task" figure comes from this
   line of work (Mark, Gudith & Klocke 2008; Czerwinski, Horvitz &
   Wilhite 2004).
3. **Goal activation decays during interruption.** The "memory for
   goals" theory (Altmann & Trafton 2002) holds that a suspended
   goal loses activation over time, and that retrieving it depends
   on environmental cues that were associated with the goal at
   suspension. The longer the interruption and the weaker the
   cues, the more likely the goal is lost or imperfectly
   reconstructed.
4. **Multitasking degrades performance even when it feels
   productive.** Heavy media multitasking is associated with
   reduced working-memory efficiency, weaker attentional control,
   and increased distractibility (Ophir, Nass & Wagner 2009).

## Key sources

- **Monsell, S. (2003).** *Task switching.* Trends in Cognitive
  Sciences, 7(3), 134–140. The standard reference on switch costs.
- **Altmann, E. M., & Trafton, J. G. (2002).** *Memory for goals:
  An activation-based model.* Cognitive Science, 26(1), 39–83.
  The foundational paper on why interrupted goals are hard to
  resume and what helps.
- **Mark, G., Gudith, D., & Klocke, U. (2008).** *The cost of
  interrupted work: More speed and stress.* CHI '08. The often-
  cited "interruptions cost time and create stress" study.
- **Czerwinski, M., Horvitz, E., & Wilhite, S. (2004).** *A diary
  study of task switching and interruptions.* CHI '04. Long-form
  field data on how often knowledge workers switch.
- **Mark, G. (2023).** *Attention Span: A Groundbreaking Way to
  Restore Balance, Happiness and Productivity.* Hanover Square
  Press. Book-length synthesis of Mark's research program.
- **Ophir, E., Nass, C., & Wagner, A. D. (2009).** *Cognitive
  control in media multitaskers.* PNAS, 106(37), 15583–15587.
- **Salvucci, D. D., & Taatgen, N. A. (2010).** *The Multitasking
  Mind.* Oxford University Press. Synthesis of cognitive-
  architecture work on multitasking.

## Implications for noggin

- **AI work multiplies interruption.** When an agent can fork four
  parallel logical branches in seconds, the user is interrupted
  (by themselves, by the agent's output, by switching between
  parallel conversations) far more often than in pre-LLM work.
  The cost-of-interruption literature predicts what we actually
  observe: lost threads, abandoned side-quests, "where was I?"
  questions.
- **Capture-at-suspension, not capture-on-return (P2, P3).** The
  memory-for-goals theory says the cue that reactivates a goal is
  the cue that was *encoded with it at suspension*. This is the
  whole basis for the resumption-note template — the user writes
  down the reactivation cue while the goal is still hot, not when
  it's cold.
- **The tree is a pre-positioned cue field (P2).** Every item in
  the tree is an event-based cue waiting for the user to glance
  at it. The mere act of seeing "spike storage layer" in the
  sidebar re-activates the associated goal without requiring
  active recall.
- **Don't add interruptions yourself (P6).** A tool that *itself*
  produces interruptions (pop-ups, blocking errors, nags) is
  literally generating the harm it was meant to mitigate. noggin's
  non-blocking, no-notification design comes directly from this
  literature.
- **Visible spine on return (P2).** The status bar item showing
  the active item, the sidebar tree, the SKILL's "always print
  `show` output by default" rule — all of these put the reactivation
  cue in front of the user the moment they look.

## Caveats

- The "23 minutes to return" figure is widely cited but somewhat
  specific to the Mark 2008 study population (knowledge workers in
  open-plan offices); the precise number depends on context.
  The qualitative finding (interruption recovery is much longer
  than the interruption) is robust.
- "Cognitive switch cost" in lab studies (Monsell-style) is
  smaller in absolute terms than "workplace interruption cost"
  (Mark-style) — different phenomena at different scales. noggin
  is targeting the workplace-interruption scale.
