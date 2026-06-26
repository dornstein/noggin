# Metacognition and reflective practice

## The core claims

1. **Metacognition is "thinking about thinking."** Flavell (1979)
   introduced the term to describe the monitoring and control of
   one's own cognitive processes — knowing what one knows, what
   one doesn't, what strategy is being used, when to switch
   strategies, when one is stuck. It develops with age and is
   trainable.
2. **Reflection-on-action is distinct from reflection-in-action.**
   Schön's *The Reflective Practitioner* (1983) distinguishes
   *reflection-in-action* (thinking about what you're doing as
   you do it, characteristic of expert practice) from
   *reflection-on-action* (looking back at what was done after the
   fact, characteristic of learning and improvement). Both require
   information about what actually happened.
3. **Reflection requires a faithful past to look at.** The work
   on learning from experience (Kolb 1984's experiential learning
   cycle; Argyris & Schön's double-loop learning) all assume the
   learner has access to a record of what was actually done, not
   just what they currently believe they did. Memory of past
   action is famously reconstructive and unreliable; written
   records are more dependable.
4. **Metacognitive accuracy matters for working with imperfect
   collaborators.** When working with an agent (human or AI) that
   sometimes makes mistakes, the user needs accurate metacognition
   to know when to trust output and when to question it. This is
   essentially the calibration problem; poor metacognition (over-
   or under-confidence) is a known failure mode.

## Key sources

- **Flavell, J. H. (1979).** *Metacognition and cognitive
  monitoring: A new area of cognitive-developmental inquiry.*
  American Psychologist, 34(10), 906–911. Introduces the term and
  the framework.
- **Schön, D. A. (1983).** *The Reflective Practitioner: How
  Professionals Think in Action.* Basic Books. Reflection-in-
  action and reflection-on-action.
- **Schön, D. A. (1987).** *Educating the Reflective Practitioner.*
  Jossey-Bass. Follow-up with stronger pedagogical implications.
- **Kolb, D. A. (1984).** *Experiential Learning: Experience as
  the Source of Learning and Development.* Prentice-Hall. The
  experiential learning cycle (concrete experience → reflective
  observation → abstract conceptualization → active
  experimentation).
- **Argyris, C., & Schön, D. (1974).** *Theory in Practice:
  Increasing Professional Effectiveness.* Jossey-Bass. Double-loop
  learning.
- **Dunning, D., Heath, C., & Suls, J. M. (2004).** *Flawed self-
  assessment: Implications for health, education, and the
  workplace.* Psychological Science in the Public Interest, 5(3),
  69–106. Empirical work on metacognitive accuracy.

## Implications for noggin

- **Closure-as-note, not state-flip (P5).** A `closedAt` field
  collapses closure into a binary state — useful for filtering,
  useless for reflection-on-action. A note in the log preserves
  *when* and (optionally) *why*, and sits in the same sequence as
  every other thing that happened on the item. Reflection has
  something to read.
- **Append-only notes (P5).** Editing or deleting older notes
  would destroy the historical record. The cost is occasionally
  longer items; the benefit is a trustworthy past. For reflection-
  on-action this trade is overwhelming.
- **`edit --open` doesn't rewrite the close note (P5).** When a
  user reopens a closed item, they add a new event; the
  historical close stays. The narrative is "I closed this, then I
  changed my mind," not "I never closed this in the first place."
  The first is reflection-supporting; the second is a lie.
- **Done items stay visible (P5).** The reflective view of a
  parent item is its sequence of completed and in-flight
  children. Hiding done items hides exactly what reflection needs.
- **Notes can hold rationale (implicit).** A user (or agent) can
  capture "decided X because Y, ruled out Z" as a note on the
  item. Later reflection can see not just what happened but why.
  The resumption-note template is a structured form of this.
- **Why this matters more in the AI era (P8).** When the agent
  is doing structural work on the user's behalf, the user needs
  to be able to look back and verify *what* the agent did and
  *why*. The notes log is the audit trail that makes that
  verification possible. Without it, the user is forced to trust
  the agent's current claims about past actions — and human +
  agent metacognition both have known calibration problems.

## Caveats

- "Metacognition" as a label covers a wide range of phenomena
  (judgments of learning, feelings of knowing, strategy selection,
  …). The specific subset noggin engages is "monitoring what I
  did and what I intended to do." Other metacognitive functions
  are out of scope.
- Schön's framework is more popular in professional-practice
  education than in laboratory cognitive psychology. The
  predictions are nonetheless consistent with mainstream
  metacognition research.
