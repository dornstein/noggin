# Working memory and cognitive load

## The core claims

1. **Working memory is small.** The number of independent items a
   person can actively hold and manipulate at one time is somewhere
   between four (Cowan 2001's revised estimate) and seven plus or
   minus two (Miller 1956's classic figure). Both numbers are
   "chunks," not raw items — a meaningful unit can package several
   primitives — but the chunk count is the binding constraint.
2. **Cognitive overload degrades performance.** When information or
   task structure exceeds working-memory capacity, the result is
   slower processing, more errors, dropped sub-goals, and
   diminished decision quality (Sweller 1988; Sweller, van
   Merriënboer & Paas 1998).
3. **Cognitive load has three components** (Sweller's cognitive load
   theory):
   - **Intrinsic load** — the inherent complexity of the task.
   - **Extraneous load** — load added by the way information or
     tools are presented. The user's tool is part of this.
   - **Germane load** — effort spent building durable mental models
     ("schemas") for the work.
   The total is bounded; extraneous load *crowds out* germane load.

## Key sources

- **Miller, G. A. (1956).** *The magical number seven, plus or minus
  two: some limits on our capacity for processing information.*
  Psychological Review, 63(2), 81–97.
- **Baddeley, A. D., & Hitch, G. (1974).** *Working memory.* In
  Recent Advances in Learning and Motivation, vol. 8. The multi-
  component model (phonological loop, visuospatial sketchpad,
  central executive; episodic buffer added in Baddeley 2000).
- **Cowan, N. (2001).** *The magical number 4 in short-term memory:
  A reconsideration of mental storage capacity.* Behavioral and
  Brain Sciences, 24(1), 87–114. The currently accepted refinement
  of Miller's figure.
- **Sweller, J. (1988).** *Cognitive load during problem solving:
  Effects on learning.* Cognitive Science, 12(2), 257–285. The
  founding paper of cognitive load theory.
- **Chandler, P., & Sweller, J. (1991).** *Cognitive load theory and
  the format of instruction.* Cognition and Instruction, 8(4),
  293–332. Introduces intrinsic / extraneous.
- **Sweller, J., van Merriënboer, J. J. G., & Paas, F. G. W. C.
  (1998).** *Cognitive architecture and instructional design.*
  Educational Psychology Review, 10(3), 251–296.
- **Sparrow, B., Liu, J., & Wegner, D. M. (2011).** *Google effects
  on memory: Cognitive consequences of having information at our
  fingertips.* Science, 333(6043), 776–778. Working-memory-adjacent
  but relevant to noggin's offloading story.

Useful secondary: Wikipedia's [Cognitive load](https://en.wikipedia.org/wiki/Cognitive_load)
article is a competent overview and tracks the contemporary
literature.

## Implications for noggin

- **Why externalize at all (P1).** Complex AI-assisted software
  work routinely exceeds 4–7 chunks: there's the focal sub-task,
  parent goals, paused side-quests, relevant constraints, what the
  agent just proposed, what was rejected. Holding all of that in
  the head is impossible; the choice is to externalize or to lose
  information. noggin's tree is the externalization.
- **Why minimize extraneous load (P3, P6).** Every UI step, every
  required argument, every blocking error consumes working-memory
  budget that could be spent on the actual work. Single-verb capture,
  sensible defaults, non-blocking errors, relative path syntax —
  these are all extraneous-load minimization.
- **Why structure mirrors mental structure (P4).** When the tool's
  model matches the user's mental model (nested goals → tree),
  there's no translation cost. When it doesn't (a flat list, an
  abstract graph), every interaction pays translation tax.
- **Why don't pretend the user has more cognitive headroom than
  they do.** This is why we resist features that ask the user to
  classify, tag, estimate, or prioritize at capture time — those
  decisions consume the budget the user needs for the work.

## Caveats

- The "4 vs 7" debate is real but doesn't change the policy
  implication: working memory is *small*, and tools should respect
  that. Either number is far below what AI-assisted work routinely
  generates.
- Cognitive load theory's three-component model is well-established
  but the additivity of the three components has been questioned
  (de Jong 2009). For our purposes the policy implications are
  robust to the precise mechanism.
