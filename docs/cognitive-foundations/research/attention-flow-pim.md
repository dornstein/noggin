# Attention, flow, and personal information management

This file combines three closely-related literatures because their
implications for noggin overlap: each is about the conditions under
which sustained cognitive work is possible (or fails), and what a
tool can do to support — or harm — those conditions.

## Part 1 — Attention and flow

### Core claims

1. **Flow is the state of sustained, fully-engaged work.**
   Csikszentmihalyi's (1990) framework characterizes flow by clear
   goals, immediate feedback, balance between challenge and skill,
   merging of action and awareness, loss of self-consciousness.
   Productive deep work happens in flow.
2. **Flow is fragile to interruption.** Once broken, recovery
   takes substantial time (see [interruption.md](interruption.md))
   — and the *anticipation* of interruption is itself a flow-
   inhibitor.
3. **Attention is a limited resource that fragments under
   multitasking.** Mark's longitudinal work (2014, 2023) finds
   attention spans on a single screen have collapsed from ~2.5
   minutes in 2004 to ~47 seconds by the early 2020s. Heavy
   multitasking impairs the cognitive control systems that
   sustain attention (Ophir, Nass & Wagner 2009; Loh & Kanai 2014
   for the brain-structure correlate).
4. **Practical advice: protect the conditions for sustained
   attention.** Newport's *Deep Work* (2016) and *A World Without
   Email* (2021) are the popular synthesis, with concrete
   implications: minimize ambient interruption, batch
   communication, externalize anything that would otherwise
   demand attentional juggling.

### Key sources

- **Csikszentmihalyi, M. (1990).** *Flow: The Psychology of
  Optimal Experience.* Harper & Row.
- **Mark, G. (2023).** *Attention Span.* Hanover Square Press.
  Synthesizes a decade-plus of attention-fragmentation field
  research.
- **Ophir, E., Nass, C., & Wagner, A. D. (2009).** *Cognitive
  control in media multitaskers.* PNAS, 106(37), 15583–15587.
- **Newport, C. (2016).** *Deep Work.* Grand Central. Popular
  synthesis with strong design implications.
- **Newport, C. (2021).** *A World Without Email.* Portfolio. On
  the workflow-level pathologies of always-on communication.

### Implications for noggin

- **The tool itself must not interrupt (P6).** Every
  notification, blocking dialog, or required-attention prompt
  noggin emits is an attention-fragmentation event. The tool
  exists to support sustained attention; producing interruption
  defeats its purpose. This is why noggin has *no* notifications,
  *no* blocking, *no* "you have N unprocessed items" surface.
- **Externalization frees attention (P1).** A thought held in
  the head competes for attentional resources with the focal
  task. Capturing it to noggin lets the user stop attending to it
  and return to flow.
- **Visible structure enables fast resumption (P2).** When flow
  is broken (and it will be), getting back is faster when the
  spine is visible than when it must be reconstructed.

---

## Part 2 — Personal information management

### Core claims

1. **People prefer piles to files when filing is expensive.**
   Malone (1983) and Whittaker & Sidner (1996) found that
   knowledge workers consistently choose flat, location-based
   organization over hierarchical filing — *not* because piles
   are better, but because filing decisions are expensive and
   often regretted. People defer the classification decision.
2. **Finding > filing.** Bergman & Whittaker's *The Science of
   Managing Our Digital Stuff* (2016) synthesizes 30+ years of
   PIM research. The strongest finding: people re-find their
   stuff primarily by **navigation** (browsing through known
   structure) rather than by search. They want to know where
   their stuff is.
3. **Walled-garden tools tend to be abandoned.** When a tool
   silos the user's data (proprietary format, required account,
   no export, vendor-controlled), the eventual cost is the user
   losing access to the data — and the trust required to keep
   investing in the tool evaporates well before that.
4. **Plain-text outlives applications.** The most-cited
   longevity success stories in PIM are plain-text notes (markdown,
   org-mode, plain `.txt`) and flat-file structures the user
   controls. They outlast the applications that created them.

### Key sources

- **Bergman, O., & Whittaker, S. (2016).** *The Science of
  Managing Our Digital Stuff.* MIT Press.
- **Whittaker, S., & Sidner, C. (1996).** *Email overload:
  Exploring personal information management of email.* CHI '96.
- **Malone, T. W. (1983).** *How do people organize their
  desks? Implications for the design of office information
  systems.* ACM TOIS, 1(1), 99–112. The piles-vs-files
  observation.
- **Boardman, R., & Sasse, M. A. (2004).** *"Stuff goes into
  the computer and doesn't come out": A cross-tool study of
  personal information management.* CHI '04.
- **Bergman, O. (2013).** *Variables for personal information
  management research.* Aslib Proceedings, 65(5), 464–483.

### Implications for noggin

- **Documented data shape, pluggable providers (P7).** The PIM
  literature is unambiguous: data that outlives the application
  is data in user-controlled, open formats. The shipping default
  — `~/.noggin.yaml`, a plain-text YAML file the user can `cat`,
  `grep`, and version-control — passes the test directly. The
  underlying engine treats persistence as a plug-in (`file://`
  and `memory://` ship today; the provider registry admits more),
  so the durability invariant lives in the contract, not in any
  one provider.
- **Tree as navigation surface (P4, P7).** People re-find by
  navigation. The noggin tree is the navigation surface — there
  is no "search across all items" as a primary verb because
  navigation works.
- **Filing decisions are cheap (P3).** `add` defaults to placing
  under active; `push` defaults to under active. Placement flags
  exist but aren't required. This is the deferred-classification
  pattern done right: capture now, place if you want, otherwise
  the default is fine.
- **Don't silo (P7).** Every client — extension (in-process),
  desktop (via RPC to the main-process engine), MCP server, LM
  tools, bare CLI — goes through the same engine over the same
  documented `NogginDocument` shape. For the default file
  provider, the user can also `cat`, `grep`, or `git add` the
  YAML directly. We don't own the data; the user does, in a shape
  we have documented.

### Caveats

- The PIM literature is older than the AI-agent era. Some of
  its findings (e.g., people don't search much) are being
  re-examined as agents become better at finding things on the
  user's behalf. But the underlying point — the user has to be
  able to trust where their data is — is, if anything, more
  important when agents are involved.

---

## How the two parts reinforce each other

The attention literature says: don't be an interruption source;
externalize so the user can return to flow. The PIM literature
says: store externalized stuff in a form the user trusts to
persist. noggin needs both — a tool that captures cheaply (so it
gets used) and stores durably (so the captures are still there
when the user comes back). The intersection is the design.
