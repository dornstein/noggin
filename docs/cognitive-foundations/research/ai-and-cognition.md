# AI assistants and cognition

The newest and least-settled literature in this folder. The picture
emerging from the last few years of research on LLM and AI-assistant
use is more cautionary than the older distributed-cognition
literature suggested. This file is the explicit grounding for
[principle P8](../principles.md#p8-keep-the-human-in-the-loop-against-cognitive-debt).

## The core claims

1. **Heavy LLM use during cognitive tasks produces measurable
   shallow-processing effects.** The MIT "Your Brain on ChatGPT"
   study (Kosmyna et al. 2025) used EEG to compare brain
   connectivity in three groups writing the same essays: LLM-
   assisted, search-assisted, and unaided. The LLM group showed
   the weakest brain connectivity throughout the writing task
   and the lowest retention of their own essay content
   afterwards. The authors describe the result as **cognitive
   debt** — borrowing from external cognition in a way that
   doesn't build internal scaffolding.
2. **LLM use reduces depth of learning compared to search.**
   Melumad & Yun (2025, *PNAS Nexus*) ran preregistered
   experiments comparing LLM and web-search conditions on
   educational tasks. LLM users learned less deeply and
   transferred less to new problems — even though they often
   *felt* they had learned more.
3. **The "Google effect" is the precursor pattern.** Sparrow,
   Liu & Wegner (2011) found that people encode less of
   information they expect to be able to access externally. LLMs
   intensify this: not just facts but *reasoning and structure*
   become externally accessed.
4. **Cognitive offloading is good for performance but can have
   retention costs.** Risko & Gilbert's review (2016) — written
   before LLMs — already noted this trade-off. The LLM era
   makes the trade-off more acute because the things being
   offloaded are higher-order.
5. **Productive struggle / desirable difficulty is what builds
   durable skill.** Bjork & Bjork's (1992, 2011) work on
   "desirable difficulties" finds that learning is more durable
   when acquisition is *harder*, not easier. AI assistants that
   smooth away all difficulty may smooth away the conditions for
   skill acquisition.
6. **Deskilling is real and observable.** A 2025 *Lancet
   Gastroenterology & Hepatology* study (Budzyń et al.) found
   that endoscopists who relied on AI assistance during routine
   colonoscopies showed *worse* detection rates when the AI was
   subsequently withdrawn — measurable skill loss in working
   doctors over a few months.
7. **AI-assisted users have known calibration problems.**
   They often over-trust correct AI output and under-trust
   incorrect AI output (a well-documented pattern in the broader
   automation-bias literature; e.g., Mosier & Skitka 1996 for
   the classical version, with growing AI-specific replications).

## Key sources

- **Kosmyna, N., et al. (2025).** *Your Brain on ChatGPT:
  Accumulation of Cognitive Debt when Using an AI Assistant for
  Essay Writing Task.* arXiv:2506.08872. The MIT cognitive-debt
  study.
- **Melumad, S., & Yun, J. H. (2025).** *Experimental evidence of
  the effects of large language models versus web search on
  depth of learning.* PNAS Nexus, 4(10), pgaf316.
- **Sparrow, B., Liu, J., & Wegner, D. M. (2011).** *Google
  effects on memory: Cognitive consequences of having
  information at our fingertips.* Science, 333(6043), 776–778.
- **Risko, E. F., & Gilbert, S. J. (2016).** *Cognitive
  offloading.* Trends in Cognitive Sciences, 20(9), 676–688.
- **Bjork, R. A., & Bjork, E. L. (1992).** *A new theory of
  disuse and an old theory of stimulus fluctuation.* In *From
  Learning Processes to Cognitive Processes* (Healy et al.,
  eds). Erlbaum.
- **Bjork, E. L., & Bjork, R. A. (2011).** *Making things hard
  on yourself, but in a good way: Creating desirable
  difficulties to enhance learning.* In *Psychology and the
  Real World* (Gernsbacher et al., eds). Worth.
- **Budzyń, K., et al. (2025).** *Endoscopist deskilling risk
  after exposure to artificial intelligence in colonoscopy: a
  multicentre, observational study.* The Lancet
  Gastroenterology & Hepatology, 10(10), 896–903.
- **Oakley, B., Johnston, M., Chen, K., Jung, E., & Sejnowski,
  T. (2025).** *The Memory Paradox: Why Our Brains Need
  Knowledge in an Age of AI.* SSRN preprint 5250447.
- **Dergaa, I., et al. (2024).** *From tools to threats: A
  reflection on the impact of artificial-intelligence chatbots
  on cognitive health.* Frontiers in Psychology, 15, 1259845.
- **Mosier, K. L., & Skitka, L. J. (1996).** *Human decision
  makers and automated decision aids: Made for each other?* In
  *Automation and Human Performance* (Parasuraman & Mouloua,
  eds). Erlbaum. (The original automation-bias literature; the
  AI-specific replications are still landing.)

## Implications for noggin

- **P8 exists because of this literature.** noggin's whole point
  is cognitive offloading — and the literature now says that
  offloading, done poorly, has costs. The design response is to
  identify which cognitive acts noggin should *protect* (keep
  the human doing) and which it should *offload* (let the
  externalization do the work).
- **What noggin *should* offload:**
  - Holding open intentions in working memory (the tree does
    this).
  - Tracking the sequence of past events (the notes log).
  - Remembering "where was I" across interruption (the spine).
  These are storage and structure — exactly the things the
  cognitive-offloading literature supports.
- **What noggin should *not* let the agent do silently:**
  - **Naming items.** The agent can propose a title; the user
    sees and (implicitly or explicitly) accepts it. Naming is a
    cognitive act that builds the user's model of the work.
  - **Picking verbs.** The agent makes the verb choice but
    *announces it* (the SKILL's "one-line acknowledgement"
    rule). The user can override if the choice was wrong; over
    time the user is building a model of when to push vs add.
  - **Closing items.** The agent can mark something done, but
    the user sees it happen. Silent closure would let an agent
    error remain undiscovered.
  - **Hiding structure.** The SKILL's "always print `show`
    output by default" rule exists for this — the user must
    see the tree, every turn, or they will stop building the
    model.
- **The small acts of structuring are the desirable difficulties.**
  Each `push`, `add`, `note`, each title chosen, each closure
  decision is a moment where the user is doing the thinking the
  cognitive-debt literature says builds the model. They are
  small, but they are not trivial — and they are deliberately
  kept user-driven.
- **The notes log is the audit trail against agent error.**
  When the agent acts on the user's behalf, the user needs to be
  able to look back. Schön's reflection-on-action (see
  [metacognition.md](metacognition.md)) is the cognitive
  function we're enabling; calibration of trust in the agent is
  the operational benefit.

## Caveats

- This literature is *new* and small-N. Kosmyna et al. is a
  preprint (as of mid-2026); the deskilling and depth-of-
  learning findings are individual studies, not yet meta-
  analyzed. The directional signal is consistent across
  studies, but the effect sizes and exact mechanisms remain to
  be established.
- The "Google effect" literature has had its own mixed-
  replication history; the LLM-era findings could go the same
  way.
- P8 is a defensive design choice: even if some of these
  findings soften, the operational reasons to keep the human
  in the loop (catching agent mistakes, building user
  understanding, supporting reflection) remain strong on their
  own.
- See [open-questions.md](../open-questions.md) Q2 and Q7 for
  the live tensions in this literature.
