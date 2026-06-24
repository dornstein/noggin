// Path helpers — exhaustive tests for the small algebra over
// `NogginNode[]` forests used by the gesture executor and the tree
// component. Imports directly from the source so any drift is caught
// here rather than at a much later integration boundary.

import { describe, it, expect } from 'vitest';
import {
  findByPath,
  siblingsOf,
  parentOf,
  prevSibling,
  nextSibling,
  firstSibling,
  lastSibling,
} from '../treeOps';
import type { NogginNode } from '../types';

function node(key: string, path: string, title: string, children: NogginNode[] = []): NogginNode {
  return { key, path, title, done: false, noteCount: 0, children };
}

const SAMPLE: NogginNode[] = [
  node('r1', '/1', 'A', [
    node('r1c1', '/1/1', 'A.1'),
    node('r1c2', '/1/2', 'A.2', [
      node('r1c2g1', '/1/2/1', 'A.2.1'),
    ]),
    node('r1c3', '/1/3', 'A.3'),
  ]),
  node('r2', '/2', 'B'),
  node('r3', '/3', 'C'),
];

describe('treeOps path helpers', () => {
  it('findByPath returns the right node at any depth', () => {
    expect(findByPath(SAMPLE, '/1')?.title).toBe('A');
    expect(findByPath(SAMPLE, '/1/2')?.title).toBe('A.2');
    expect(findByPath(SAMPLE, '/1/2/1')?.title).toBe('A.2.1');
    expect(findByPath(SAMPLE, '/3')?.title).toBe('C');
    expect(findByPath(SAMPLE, '/9')).toBeNull();
  });

  it('siblingsOf returns the sibling list at the right depth', () => {
    expect(siblingsOf(SAMPLE, '/1')).toHaveLength(3);    // roots
    expect(siblingsOf(SAMPLE, '/1/2')).toHaveLength(3);  // A's children
    expect(siblingsOf(SAMPLE, '/1/2/1')).toHaveLength(1); // A.2's children
  });

  it('parentOf returns null for roots and parent for deeper paths', () => {
    expect(parentOf(SAMPLE, '/1')).toBeNull();
    expect(parentOf(SAMPLE, '/1/2')?.title).toBe('A');
    expect(parentOf(SAMPLE, '/1/2/1')?.title).toBe('A.2');
  });

  it('prev/nextSibling respect edges', () => {
    expect(prevSibling(SAMPLE, '/1')).toBeNull();
    expect(nextSibling(SAMPLE, '/3')).toBeNull();
    expect(prevSibling(SAMPLE, '/2')?.title).toBe('A');
    expect(nextSibling(SAMPLE, '/2')?.title).toBe('C');
    expect(prevSibling(SAMPLE, '/1/2')?.title).toBe('A.1');
    expect(nextSibling(SAMPLE, '/1/2')?.title).toBe('A.3');
  });

  it('first/lastSibling on a path in a single-child group returns the same node', () => {
    expect(firstSibling(SAMPLE, '/1/2/1')?.path).toBe('/1/2/1');
    expect(lastSibling(SAMPLE, '/1/2/1')?.path).toBe('/1/2/1');
  });

  it('first/lastSibling on multi-child group returns extremes', () => {
    expect(firstSibling(SAMPLE, '/1/2')?.path).toBe('/1/1');
    expect(lastSibling(SAMPLE, '/1/2')?.path).toBe('/1/3');
    expect(firstSibling(SAMPLE, '/2')?.path).toBe('/1');
    expect(lastSibling(SAMPLE, '/2')?.path).toBe('/3');
  });
});
