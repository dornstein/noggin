// Concise per-verb docs for the playground CLI sidebar.
//
// Each entry mirrors what `noggin help` shows, distilled into a
// short pane: one-liner, syntax, optional flag list, optional notes,
// and ready-to-run examples that click-fill the prompt.

export const VERBS = [
  {
    name: 'push',
    summary: 'add child + make active',
    syntax: 'push <title>',
    description:
      'Create a new child of the active item and move the active pointer to it. The fastest way to dive into a subtask.',
    examples: ['push "ship v1"', 'push "draft outline"'],
  },
  {
    name: 'add',
    summary: 'add item without diving in',
    syntax: 'add <title> [--before|--after|--into <path>] [--goto [path]]',
    description:
      'Create a new item without changing the active pointer. By default it becomes a child of the active item; placement flags pick a different spot.',
    flags: [
      { flag: '--before <path>', desc: 'insert as previous sibling of <path>' },
      { flag: '--after <path>',  desc: 'insert as next sibling of <path>' },
      { flag: '--into <path>',   desc: 'append as last child of <path>' },
      { flag: '--goto [path]',   desc: 'jump there after creating' },
    ],
    examples: [
      'add "write tests"',
      'add "next milestone" --after /1',
      'add "background reading" --into /2 --goto',
    ],
  },
  {
    name: 'move',
    summary: 'relocate an item',
    syntax: 'move [<path>] (--before|--after|--into <path>) [--goto [path]]',
    description:
      'Relocate an existing item. The placement flag is required — pick a destination relative to another item.',
    flags: [
      { flag: '--before <path>', desc: 'move before <path>' },
      { flag: '--after <path>',  desc: 'move after <path>' },
      { flag: '--into <path>',   desc: 'move under <path>' },
    ],
    examples: ['move /1/2 --after /1/1', 'move /3 --into /1'],
  },
  {
    name: 'goto',
    summary: 'change the active item',
    syntax: 'goto <path>',
    description:
      'Move the active pointer to another item. Paths are absolute (/1/2) or relative to the current active (.. - + ./X).',
    examples: ['goto /1', 'goto ..', 'goto -'],
  },
  {
    name: 'done',
    summary: 'close an item',
    syntax: 'done [<path>] [--force|--close-all]',
    description:
      'Mark an item done and make its parent active. Idempotent. By default it refuses to close an item with open children.',
    flags: [
      { flag: '--close-all', desc: 'close any open descendants first' },
      { flag: '--force',     desc: 'close the target anyway, leaving kids open' },
    ],
    examples: ['done', 'done /1/2', 'done --close-all'],
  },
  {
    name: 'pop',
    summary: 'done on the active item',
    syntax: 'pop [--force|--close-all]',
    description:
      'Shortcut for `done` on the active item (no path argument). Useful at the end of a focused subtask.',
    examples: ['pop', 'pop --close-all'],
  },
  {
    name: 'edit',
    summary: 'rename / change state',
    syntax: 'edit [<path>] [--done|--open] [--title T] [--force|--close-all] [--goto [path]]',
    description:
      'Rename an item or change its open/done state. Idempotent. Reopening with --open does NOT touch the notes log — the historical close note stays.',
    flags: [
      { flag: '--done',  desc: 'mark done' },
      { flag: '--open',  desc: 'reopen' },
      { flag: '--title T', desc: 'rename' },
    ],
    examples: [
      'edit --title "new title"',
      'edit /1 --done',
      'edit /1/2 --open',
    ],
  },
  {
    name: 'show',
    summary: 'print the tree',
    syntax: 'show [<path>] [--no-children|--with-descendants] [--with-siblings] [--with-all] [--with-notes] [--goto [path]]',
    description:
      'Print the current tree view rooted at <path> (default: active item). Flags expand or shrink what you see.',
    flags: [
      { flag: '--no-children',      desc: 'just the target row' },
      { flag: '--with-descendants', desc: 'expand the subtree recursively' },
      { flag: '--with-siblings',    desc: 'include siblings along the spine' },
      { flag: '--with-all',         desc: 'siblings + descendants' },
      { flag: '--with-notes',       desc: 'include note bodies' },
    ],
    examples: ['show', 'show --with-all', 'show /1 --with-notes'],
  },
  {
    name: 'note',
    summary: 'append a note',
    syntax: 'note [<path>] <text…> [--goto [path]]',
    description:
      'Append a timestamped note to an item. Notes are append-only — anything worth saying about an item goes in a note.',
    examples: ['note "kicked off design"', 'note /1 "review with team"'],
  },
  {
    name: 'delete',
    summary: 'remove an item',
    syntax: 'delete <path> [--recursive]',
    description:
      'Remove an item. Refuses if it has children unless you pass --recursive.',
    flags: [{ flag: '--recursive', desc: 'also remove the subtree' }],
    examples: ['delete /3', 'delete /2 --recursive'],
  },
  {
    name: 'where',
    summary: 'show resolved noggin',
    syntax: 'where',
    description:
      'Print which noggin would be used and why. In the playground this is always the in-browser localStorage store.',
    examples: ['where'],
  },
  {
    name: 'providers',
    summary: 'list providers',
    syntax: 'providers',
    description: 'List the providers registered with this CLI build.',
    examples: ['providers'],
  },
  {
    name: 'help',
    summary: 'all verbs + flags',
    syntax: 'help',
    description: 'Print the full verb list and common flags.',
    examples: ['help'],
  },
];
