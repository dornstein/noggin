// Wrapper that spawns the bundled cli.mjs against the currently open noggin
// file (as tracked by NogginSession) and parses its --json output.
// Uses VS Code's bundled Node via ELECTRON_RUN_AS_NODE so no separate Node
// install is required.

import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { NogginSession } from './session';

export interface CliItem {
  key: string;
  parentKey: string | null;
  path: string | null;
  position: number | null;
  title: string;
  done?: boolean;
  pushedAt?: string;
  closedAt?: string | null;
  notes?: Array<{ timestamp: string | null; text: string }>;
}

export interface CliCurrentTree extends CliItem {
  active: string | null;
  ancestors: CliItem[];
  siblings: CliItem[];
  children?: CliItem[];
}

export interface CliResult<T = CliCurrentTree | null> {
  status: 'ok';
  data: T;
}

export class CliError extends Error {
  constructor(message: string, public readonly exitCode: number, public readonly stderr: string) {
    super(message);
    this.name = 'CliError';
  }
}

export interface CliRunner {
  cliPath: string;
  run(verb: string, args: string[]): Promise<CliCurrentTree | null>;
}

export function createCliRunner(
  context: vscode.ExtensionContext,
  session: NogginSession,
): CliRunner {
  const cliPath = vscode.Uri.joinPath(context.extensionUri, 'skills', 'noggin', 'cli.mjs').fsPath;

  return {
    cliPath,
    async run(verb: string, args: string[]): Promise<CliCurrentTree | null> {
      const file = session.file;
      if (!file) {
        throw new CliError('no noggin file is open', 1, '');
      }
      const fullArgs = [cliPath, verb, '--json', '--file', file, ...args];

      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, fullArgs, {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new CliError(stderr.trim() || `cli exited with code ${code}`, code ?? -1, stderr));
            return;
          }
          if (!stdout.trim()) { resolve(null); return; }
          try {
            const parsed = JSON.parse(stdout) as CliResult;
            resolve(parsed.data);
          } catch (err) {
            reject(new Error(`failed to parse CLI JSON output: ${(err as Error).message}\n${stdout}`));
          }
        });
      });
    },
  };
}
