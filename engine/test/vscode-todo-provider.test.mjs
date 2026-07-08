// Smoke tests for the vscode-todo read-only provider.
//
// These tests build a synthetic `state.vscdb` (an `ItemTable` with a
// `memento/chat-todo-list` row) to exercise the projection + watch
// loop without needing an actual VS Code install. The DB schema
// mirrors what VS Code's `ChatTodoListStorage` writes via its
// `Memento('chat-todo-list', storageService)` on `manage_todo_list`
// tool invocations.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openNoggin, NogginError } from '../noggin-api.mjs';
import { openVscodeTodoNoggin, listVscodeTodoSessions } from '../providers/vscode-todo.mjs';

// node:sqlite is experimental until Node 24; the provider requires
// it. Skip the suite entirely (rather than failing) on older Node so
// the engine's Node 20 support surface still passes.
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* skip below */
}

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noggin-vscode-todo-'));
  return path.join(dir, 'state.vscdb');
}

/** Write a `memento/chat-todo-list` row containing the given bySession object. */
function seedDb(dbPath, bySession) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)');
    db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
      .run('memento/chat-todo-list', JSON.stringify(bySession));
  } finally {
    db.close();
  }
}

/** Write a `chat.ChatSessionStore.index` row containing the given entries. */
function seedChatIndex(dbPath, entries) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)');
    db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
      .run('chat.ChatSessionStore.index', JSON.stringify({ version: 1, entries }));
  } finally {
    db.close();
  }
}

/** Write an `agentSessions.model.cache` row containing the given entries. */
function seedAgentCache(dbPath, entries) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)');
    db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
      .run('agentSessions.model.cache', JSON.stringify(entries));
  } finally {
    db.close();
  }
}

const SUITE = DatabaseSync ? describe : describe.skip;

SUITE('vscode-todo provider — projection', () => {
  it('projects the given session\u2019s todos as roots', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, {
      'session-alpha-1234': [
        { id: 1, title: 'Research storage', status: 'completed' },
        { id: 2, title: 'Scaffold provider', status: 'in-progress' },
        { id: 3, title: 'Wire up tests', status: 'not-started' },
      ],
    });

    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 'session-alpha-1234', pollIntervalMs: 0 });
    try {
      assert.equal(n.readOnly, true);
      assert.equal(n.roots.length, 3);
      assert.equal(n.roots[0].title, 'Research storage');
      assert.equal(n.roots[0].done, true);
      assert.equal(n.roots[1].title, 'Scaffold provider');
      assert.equal(n.roots[1].done, false);
      assert.equal(n.roots[1].notes.length, 1);
      assert.equal(n.roots[1].notes[0].text, 'in-progress');
      assert.equal(n.roots[2].done, false);
      assert.equal(n.roots[2].notes.length, 0);
    } finally {
      await n.dispose();
    }
  });

  it('describe() returns the session title from the chat index', async () => {
    const dbPath = makeTempDbPath();
    seedChatIndex(dbPath, {
      'sid-titled': { title: 'My renamed chat', lastMessageDate: 1000, isEmpty: false },
    });
    seedDb(dbPath, { 'sid-titled': [{ id: 1, title: 'x', status: 'not-started' }] });
    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 'sid-titled', pollIntervalMs: 0 });
    try {
      assert.equal(n.describe(), 'My renamed chat');
    } finally {
      await n.dispose();
    }
  });

  it('describe() falls back to the location when no title is available', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, { 'sid-nowhere': [] });
    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 'sid-nowhere', pollIntervalMs: 0 });
    try {
      assert.equal(n.describe(), n.location);
      assert.ok(n.describe().startsWith('vscode-todo://'));
    } finally {
      await n.dispose();
    }
  });

  it('describe() reads the title from the agent-sessions cache when the chat index doesn\u2019t have it', async () => {
    const dbPath = makeTempDbPath();
    seedAgentCache(dbPath, [
      { resource: 'copilotcli:/agent-x', label: 'From the agent cache', timing: { lastRequestEnded: 1000 } },
    ]);
    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 'copilotcli:/agent-x', pollIntervalMs: 0 });
    try {
      assert.equal(n.describe(), 'From the agent cache');
    } finally {
      await n.dispose();
    }
  });

  it('exposes an empty document when the session has no todos', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, {
      'sid-a': [{ id: 1, title: 'A1', status: 'not-started' }],
    });

    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 'sid-b-missing', pollIntervalMs: 0 });
    try {
      assert.equal(n.roots.length, 0);
    } finally {
      await n.dispose();
    }
  });

  it('exposes an empty document when the memento row is missing', async () => {
    const dbPath = makeTempDbPath();
    // Create an empty ItemTable without the memento row.
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)');
    db.close();

    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 'anything', pollIntervalMs: 0 });
    try {
      assert.equal(n.roots.length, 0);
    } finally {
      await n.dispose();
    }
  });

  it('rejects with sessionId-required when no session is provided', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, { s1: [{ id: 1, title: 'T', status: 'not-started' }] });

    await assert.rejects(
      openVscodeTodoNoggin(dbPath),
      (err) => err instanceof NogginError && err.code === 'sessionId-required',
    );
  });
});

SUITE('vscode-todo provider — listVscodeTodoSessions', () => {
  it('reads titles + ordering from chat.ChatSessionStore.index', async () => {
    const dbPath = makeTempDbPath();
    seedChatIndex(dbPath, {
      'sid-new': {
        title: 'Refactor picker source',
        lastMessageDate: Date.now(),
        initialLocation: 'panel',
        isEmpty: false,
      },
      'sid-old': {
        title: 'Old chat about auth',
        lastMessageDate: Date.now() - 3600_000,
        initialLocation: 'panel',
        isEmpty: false,
      },
    });
    seedDb(dbPath, {
      'sid-new': [{ id: 1, title: 'todo one', status: 'not-started' }],
    });

    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sessionId, 'sid-new');
    assert.equal(rows[0].sessionTitle, 'Refactor picker source');
    assert.equal(rows[0].count, 1);
    assert.equal(rows[0].firstTitle, 'todo one');
    assert.equal(rows[0].hasSessionLog, true);
    assert.equal(rows[0].isExternal, false);
    assert.equal(rows[1].sessionId, 'sid-old');
    assert.equal(rows[1].sessionTitle, 'Old chat about auth');
    assert.equal(rows[1].count, 0);
  });

  it('drops sessions VS Code marked isEmpty', async () => {
    const dbPath = makeTempDbPath();
    seedChatIndex(dbPath, {
      'sid-empty': { title: 'New Chat', lastMessageDate: 1000, isEmpty: true },
      'sid-real': { title: 'Real chat', lastMessageDate: 2000, isEmpty: false },
    });
    seedDb(dbPath, {});
    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 'sid-real');
  });

  it('marks isExternal for CLI / cloud sessions', async () => {
    const dbPath = makeTempDbPath();
    seedChatIndex(dbPath, {
      'copilotcli:/e827': {
        title: 'Some CLI prompt',
        lastMessageDate: 5000,
        isExternal: true,
        isEmpty: false,
      },
    });
    seedDb(dbPath, {});
    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].isExternal, true);
    assert.equal(rows[0].hasSessionLog, false);
    assert.equal(rows[0].sessionTitle, 'Some CLI prompt');
  });

  it('picks up agent-mode sessions from agentSessions.model.cache', async () => {
    const dbPath = makeTempDbPath();
    // Only the agent cache — no chat index, no memento — so we\u2019re
    // proving the picker sees agent sessions that never touched
    // either of the other stores.
    seedAgentCache(dbPath, [
      {
        providerType: 'copilotcli',
        providerLabel: 'Copilot CLI',
        resource: 'copilotcli:/agent-1',
        icon: 'copilot',
        label: 'Document review feedback',
        status: 1,
        timing: {
          created: 1000,
          lastRequestStarted: 1000,
          lastRequestEnded: 5000,
        },
      },
    ]);
    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 'copilotcli:/agent-1');
    assert.equal(rows[0].sessionTitle, 'Document review feedback');
    assert.equal(rows[0].isExternal, true);
    assert.equal(rows[0].hasSessionLog, false);
    assert.equal(rows[0].mtimeMs, 5000);
  });

  it('merges chat-index + agent-cache + memento by session id', async () => {
    const dbPath = makeTempDbPath();
    // A CLI session that appears in the chat index (with a shorter
    // title), in the agent cache (with the richer label), and in
    // the memento (with a todo). Should merge into ONE row.
    seedChatIndex(dbPath, {
      'copilotcli:/merged': {
        title: 'Old chat title',
        lastMessageDate: 5000,
        isExternal: true,
        isEmpty: false,
      },
    });
    seedAgentCache(dbPath, [
      {
        resource: 'copilotcli:/merged',
        label: 'Sidebar label (agent-cache)',
        timing: { lastRequestEnded: 8000 },
      },
    ]);
    seedDb(dbPath, {
      'copilotcli:/merged': [{ id: 1, title: 'a todo', status: 'not-started' }],
    });
    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 'copilotcli:/merged');
    // Chat-index title wins for merged rows (matches VS Code's
    // own display precedence).
    assert.equal(rows[0].sessionTitle, 'Old chat title');
    // Agent-cache mtime wins because it's newer.
    assert.equal(rows[0].mtimeMs, 8000);
    assert.equal(rows[0].count, 1);
    assert.equal(rows[0].firstTitle, 'a todo');
    assert.equal(rows[0].isExternal, true);
  });

  it('skips providerType="local" agent-cache entries to avoid double-listing local chats', async () => {
    const dbPath = makeTempDbPath();
    // A local chat exists in both stores — the chat index as
    // 'sid-local' and the agent cache as a `vscode-chat-session://`
    // shim with providerType='local'. Should produce ONE row.
    seedChatIndex(dbPath, {
      'sid-local': {
        title: 'Native panel chat',
        lastMessageDate: 5000,
        isExternal: false,
        isEmpty: false,
      },
    });
    seedAgentCache(dbPath, [
      {
        resource: 'vscode-chat-session://local/c2lkLWxvY2Fs',
        label: 'Native panel chat',
        providerType: 'local',
        timing: { lastRequestEnded: 5000 },
      },
    ]);
    seedDb(dbPath, {});
    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 'sid-local');
    assert.equal(rows[0].isExternal, false);
  });

  it('surfaces memento-only sessions that aren\u2019t in the index', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, {
      'sid-orphan': [{ id: 1, title: 'orphaned todo', status: 'not-started' }],
    });
    // No index row seeded — memento entry is the only source.
    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 'sid-orphan');
    assert.equal(rows[0].count, 1);
    assert.equal(rows[0].sessionTitle, null);
    assert.equal(rows[0].hasSessionLog, false);
  });

  it('returns an empty list when neither the index nor the memento is present', async () => {
    const dbPath = makeTempDbPath();
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)');
    db.close();
    const rows = await listVscodeTodoSessions(dbPath);
    assert.equal(rows.length, 0);
  });
});

SUITE('vscode-todo provider — read-only contract', () => {
  it('apply(ops) rejects with code "read-only"', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, { s1: [{ id: 1, title: 'T', status: 'not-started' }] });

    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 's1', pollIntervalMs: 0 });
    try {
      await assert.rejects(
        n.apply([{ type: 'setActive', key: 'vt-t-s1-1' }]),
        (err) => err instanceof NogginError && err.code === 'read-only',
      );
    } finally {
      await n.dispose();
    }
  });
});

SUITE('vscode-todo provider — openNoggin(url) dispatch', () => {
  it('opens via the vscode-todo:// scheme with a #sessionId fragment', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, { s1: [{ id: 1, title: 'via URL', status: 'not-started' }] });

    const url = `vscode-todo://${dbPath.replace(/\\/g, '/')}#s1`;
    const n = await openNoggin(url);
    try {
      assert.equal(n.readOnly, true);
      assert.equal(n.items.length, 1);
      assert.equal(n.items[0].title, 'via URL');
      assert.equal(n.items[0].done, false);
    } finally {
      await n.dispose();
    }
  });

  it('rejects when the URL has no #sessionId fragment', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, { s1: [{ id: 1, title: 'x', status: 'not-started' }] });
    const url = `vscode-todo://${dbPath.replace(/\\/g, '/')}`;
    await assert.rejects(
      openNoggin(url),
      (err) => err instanceof NogginError && err.code === 'sessionId-required',
    );
  });

  it('scopes to the fragment even when other sessions exist', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, {
      other: [{ id: 1, title: 'nope', status: 'not-started' }],
      wanted: [{ id: 1, title: 'yes', status: 'completed' }],
    });

    const url = `vscode-todo://${dbPath.replace(/\\/g, '/')}#wanted`;
    const n = await openNoggin(url);
    try {
      assert.equal(n.roots.length, 1);
      assert.equal(n.roots[0].title, 'yes');
      assert.equal(n.roots[0].done, true);
    } finally {
      await n.dispose();
    }
  });
});

SUITE('vscode-todo provider — watching', () => {
  it('fires onDidChange when the memento is rewritten', async () => {
    const dbPath = makeTempDbPath();
    seedDb(dbPath, {
      s1: [{ id: 1, title: 'first', status: 'not-started' }],
    });

    const n = await openVscodeTodoNoggin(dbPath, { sessionId: 's1', pollIntervalMs: 25 });
    try {
      const changes = [];
      n.onDidChange((batch) => { changes.push(batch); });

      // Rewrite the row with different data.
      seedDb(dbPath, {
        s1: [{ id: 1, title: 'first', status: 'completed' }],
      });

      // Wait for at least one change event to arrive.
      const start = Date.now();
      while (changes.length === 0 && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 25));
      }

      assert.ok(changes.length > 0, 'expected at least one onDidChange batch');
      const todo = n.items.find((i) => i.title === 'first');
      assert.equal(todo?.done, true);
    } finally {
      await n.dispose();
    }
  });
});
