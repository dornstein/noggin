import test from 'node:test';
import assert from 'node:assert/strict';

import { fromYaml, toYaml } from '../serializers/yaml.mjs';
import { fromJson, toJson } from '../serializers/json.mjs';

const SAMPLE = {
  schemaVersion: 1,
  active: 'i-20260616-184644-f04bf5',
  items: [
    {
      key: 'i-20260616-184644-f04bf5',
      parentKey: null,
      title: 'root',
      done: false,
      createdAt: '2026-06-16T18:46:44.071Z',
      notes: [
        { timestamp: '2026-06-16T18:46:45.625Z', text: 'a note' },
      ],
    },
  ],
};

test('yaml: round-trips a sample document', () => {
  const text = toYaml(SAMPLE);
  assert.equal(typeof text, 'string');
  const parsed = fromYaml(text);
  assert.deepEqual(parsed, SAMPLE);
});

test('yaml: empty string yields an empty document', () => {
  const doc = fromYaml('');
  assert.deepEqual(doc, { schemaVersion: 1, active: null, items: [] });
});

test('yaml: rejects unsupported schemaVersion', () => {
  const text = 'schemaVersion: 99\nactive: null\nitems: []\n';
  assert.throws(() => fromYaml(text), { code: 'unsupported-schema' });
});

test('yaml: rejects malformed YAML', () => {
  assert.throws(() => fromYaml(': : : not yaml'), { code: 'invalid-document' });
});

test('yaml: rejects missing items', () => {
  const text = 'schemaVersion: 1\nactive: null\n';
  assert.throws(() => fromYaml(text), { code: 'invalid-document' });
});

test('json: round-trips a sample document', () => {
  const text = toJson(SAMPLE);
  assert.equal(typeof text, 'string');
  assert.ok(text.endsWith('\n'), 'pretty output ends with newline');
  const parsed = fromJson(text);
  assert.deepEqual(parsed, SAMPLE);
});

test('json: compact form has no trailing newline', () => {
  const text = toJson(SAMPLE, { pretty: false });
  assert.ok(!text.endsWith('\n'));
});

test('json: empty string yields an empty document', () => {
  const doc = fromJson('');
  assert.deepEqual(doc, { schemaVersion: 1, active: null, items: [] });
});

test('json: rejects unsupported schemaVersion', () => {
  const text = JSON.stringify({ schemaVersion: 99, active: null, items: [] });
  assert.throws(() => fromJson(text), { code: 'unsupported-schema' });
});

test('json: rejects malformed JSON', () => {
  assert.throws(() => fromJson('{ not json'), { code: 'invalid-document' });
});

test('yaml ↔ json: cross-encoder round-trip', () => {
  const yamlText = toYaml(SAMPLE);
  const doc = fromYaml(yamlText);
  const jsonText = toJson(doc);
  const doc2 = fromJson(jsonText);
  assert.deepEqual(doc2, SAMPLE);
});
