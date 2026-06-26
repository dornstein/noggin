# External cognition and distributed cognition

## The core claims

1. **Cognition extends beyond the head.** Hutchins's *Cognition in
   the Wild* (1995) showed that complex cognitive work (his case
   study was ship navigation) is performed by a *system* of human
   minds, artifacts, instruments, and procedures — not by any one
   brain. The cognitive unit of analysis is the system, not the
   individual.
2. **External representations do real cognitive work.** Scaife &
   Rogers (1996) introduced the term *external cognition* to
   describe how representations outside the head (diagrams, lists,
   notations) are not just storage but actively transform what
   problems are easy to solve. The format of the external
   representation determines what inferences become trivial.
3. **Some physical actions are cognitive moves.** Kirsh & Maglio
   (1994), studying expert Tetris players, distinguished
   **pragmatic actions** (advancing toward the goal) from
   **epistemic actions** (changing the world to make it easier to
   think about). Rotating a Tetris piece to see if it fits is an
   epistemic action — it's not progress in the game, it's a
   cognitive operation performed in the world rather than in the
   head.
4. **The extended-mind hypothesis takes this philosophically
   further.** Clark & Chalmers (1998) argue that when an external
   artifact is reliably available and routinely used to support
   cognition, it should count as *part of the user's mind* for
   purposes of explaining behaviour. The classic example: a
   notebook reliably consulted is functionally equivalent to
   biological memory.
5. **People offload when offloading is cheaper.** A large
   experimental literature, synthesized by Risko & Gilbert (2016),
   finds that people offload cognitive work onto external
   artifacts whenever the cost of offloading is lower than the
   internal cost. The result is generally better task performance,
   though it can come with retention costs (see [ai-and-cognition.md](ai-and-cognition.md)).

## Key sources

- **Hutchins, E. (1995).** *Cognition in the Wild.* MIT Press. The
  canonical text on distributed cognition.
- **Scaife, M., & Rogers, Y. (1996).** *External cognition: How do
  graphical representations work?* International Journal of
  Human-Computer Studies, 45(2), 185–213.
- **Kirsh, D., & Maglio, P. (1994).** *On distinguishing epistemic
  from pragmatic action.* Cognitive Science, 18(4), 513–549. The
  Tetris paper.
- **Clark, A., & Chalmers, D. (1998).** *The extended mind.*
  Analysis, 58(1), 7–19.
- **Risko, E. F., & Gilbert, S. J. (2016).** *Cognitive offloading.*
  Trends in Cognitive Sciences, 20(9), 676–688. The standard
  modern review of when and why people offload.
- **Norman, D. A. (1993).** *Things That Make Us Smart.* Addison-
  Wesley. Popular-press synthesis of the distributed-cognition
  view, with strong design implications.

## Implications for noggin

- **The whole tool is justified by this literature (P1, P7).** If
  cognition is distributed and external representations do real
  cognitive work, then a well-shaped external structure for
  in-flight intentions isn't a luxury; it's a part of the user's
  cognition. noggin's claim to be a "working-memory tree" isn't
  metaphorical.
- **The file is part of the user's extended mind (P7).** Clark &
  Chalmers's argument applies: a YAML file the user trusts and
  consults routinely is functionally part of their cognition. This
  is why local-first, plain-text, user-owned matters so much —
  a tool that takes the externalization and hides it behind an
  account, a service, or a proprietary format breaks the extended-
  mind relationship.
- **Noggin verbs are epistemic actions (P3, P4).** `push` /
  `add` / `note` don't advance the work the user is doing; they
  rearrange the external representation to make subsequent
  thinking easier. Recognizing them as epistemic (not pragmatic)
  is why P3 demands they be *cheap* — an expensive epistemic
  action is one people skip, leaving them with worse cognition.
- **The output format is part of the cognition (P2).** Scaife &
  Rogers's point: the *shape* of the external representation
  changes what's easy to think about. A tree of items lets the
  user see "where am I in the spine" instantly; a flat log of
  events would not. The visual layout matters, not just the data.
- **Offloading is good; over-offloading is the open question.**
  Risko & Gilbert's review is positive on offloading. The newer
  AI-cognition literature (see [ai-and-cognition.md](ai-and-cognition.md))
  adds nuance: offloading can have retention costs. P8 is our
  response.

## Caveats

- Extended-mind is a philosophical claim, not a settled empirical
  one. It is, however, a useful design heuristic regardless of
  metaphysical status: if you *act as if* the user's file is part
  of their mind, you make better tool-design decisions.
- The Kirsh & Maglio distinction (epistemic vs pragmatic) is
  cleaner in lab settings than in real work, where actions often
  do both at once. The framing remains useful even when the
  boundary blurs.
