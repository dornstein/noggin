---
title: Serializers
slug: "api/serializers/"
---

# Serializers

Pure conversions between a [`NogginDocument`](../core-data-model/noggin-document/)
and its two wire forms. No I/O — you hand them strings and
documents, they hand you back the other. Both round-trip: the
document → string → document identity holds for any valid
document.

- [`serializers/yaml`](yaml/) — canonical YAML flavour every
  provider writes to disk / storage.
- [`serializers/json`](json/) — canonical JSON used inside CLI
  `--json` output and noggin-rpc payloads.

## When to use these directly

Prefer opening a [`Noggin`](../handles/noggin/) whenever you have
a location. The serializers are the right entry point when you're
working with document bytes:

- Loading a document from an unusual source (a paste buffer, a
  test fixture, an HTTP body a custom provider fetched).
- Writing a document to an unusual sink (a `.yaml.example` in the
  docs site, a CI artifact).
- Round-tripping through a serializer to normalise / validate an
  edited document before passing it back to a provider.

For anything that lives at a URI a provider knows, use
[`openNoggin`](../opening/open-noggin/) instead.
