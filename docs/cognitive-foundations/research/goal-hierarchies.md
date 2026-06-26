# Goal hierarchies and cognitive architectures

## The core claims

1. **People plan and execute complex tasks as nested goal
   hierarchies.** From the early GOMS work (Card, Moran & Newell
   1983) onwards, attempts to model real human task performance
   converge on a tree-of-goals structure: top-level intentions
   decompose into sub-goals, which decompose into operators, with
   one focal sub-goal active at a time.
2. **A "goal stack" governs which sub-goal is focal.** ACT-R
   (Anderson and colleagues, 1983 onwards), the most thoroughly
   validated cognitive architecture, makes the goal stack a
   central construct: pushing a sub-goal makes it focal; popping
   returns to the parent; the rest of cognition (memory retrieval,
   procedural matching) operates relative to the current top of
   stack.
3. **The match between tool model and mental model matters.**
   When the tool's primitives match the user's cognitive
   primitives, the extraneous cognitive load (see [working-memory.md](working-memory.md))
   of using the tool collapses toward zero. When they mismatch,
   every operation pays a translation tax.
4. **Implementation intentions structure prospective action.**
   Gollwitzer's (1999) work on implementation intentions shows
   that the "if-X-then-Y" form ("when I finish this, I will Y")
   dramatically improves follow-through — a structurally similar
   point to the prospective-memory cue/intention pairing.

## Key sources

- **Card, S. K., Moran, T. P., & Newell, A. (1983).** *The
  Psychology of Human-Computer Interaction.* Lawrence Erlbaum.
  GOMS, the Model Human Processor, the keystroke-level model. The
  founding reference for cognitive modeling in HCI.
- **Newell, A. (1990).** *Unified Theories of Cognition.* Harvard
  University Press. The vision of cognitive-architecture research;
  the Soar architecture in particular.
- **Anderson, J. R. (2007).** *How Can the Human Mind Occur in the
  Physical Universe?* Oxford University Press. The mature ACT-R
  picture. (Anderson's earlier *Architecture of Cognition*, 1983,
  introduced ACT.)
- **Anderson, J. R., Bothell, D., Byrne, M. D., Douglass, S.,
  Lebiere, C., & Qin, Y. (2004).** *An integrated theory of the
  mind.* Psychological Review, 111(4), 1036–1060. The standard
  ACT-R reference paper.
- **Miller, G. A., Galanter, E., & Pribram, K. H. (1960).** *Plans
  and the Structure of Behavior.* Holt. The much-earlier source
  for the TOTE unit (Test-Operate-Test-Exit) and the goal-
  hierarchical view of behaviour.
- **Gollwitzer, P. M. (1999).** *Implementation intentions:
  Strong effects of simple plans.* American Psychologist, 54(7),
  493–503.

## Implications for noggin

- **Tree, not list, not graph (P4).** A flat list discards the
  parent/child structure the user is mentally tracking; a graph
  adds expressive power that doesn't map to the goal-stack model
  and pays for itself in load. A tree is the structural
  isomorphism.
- **Exactly one active item (P4).** The goal stack has a single
  top. Making "active" a first-class concept aligns the tool
  with the cognitive primitive.
- **`push` and `pop` are not arbitrary verb choices.** They are
  the literal verbs for the goal-stack operations in cognitive
  architectures. Picking them as user-facing verbs is the deepest
  possible alignment between tool and mental model.
- **`add` is the move ACT-R-style architectures don't quite cover.**
  ACT-R's goal stack handles "descend now"; it doesn't well
  capture "remember to do this later, but don't descend." That
  move is closer to prospective-memory cue placement (see [prospective-memory.md](prospective-memory.md))
  or to implementation intentions. So `add` lives at the
  intersection of goal-hierarchy and prospective-memory
  literatures.
- **`done` surfaces back to parent.** The literal pop operation.
  After completing a sub-goal, you return to the parent; the
  cognitive architecture and noggin agree.
- **Why not just use a calendar or a Kanban board?** They model
  different things: calendars model time, Kanban models pipeline
  states. Neither models nested goal stacks; using them for the
  goal-stack job would force the user to translate between mental
  model and tool model on every interaction.

## Caveats

- ACT-R's goal stack is a model, not a direct claim about
  conscious experience. People don't literally introspect on a
  data structure; what the architecture says is that *behavioural
  predictions* are well captured by the stack abstraction.
- Real work has graph features too — items that genuinely belong
  to two parents, dependencies between siblings, etc. noggin's
  tree-only stance is an opinionated trade: simpler model, lower
  load, at the cost of some expressive power. Adding graph
  features would re-introduce the translation tax we deliberately
  removed. See [open-questions.md](../open-questions.md) for the
  multi-noggin variant of this tension.
