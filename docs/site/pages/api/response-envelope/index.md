---
title: Response envelope
slug: "api/response-envelope/"
---

# Response envelope

The versioned wrapper the CLI's `--json` mode, MCP tool responses,
and noggin-rpc verb responses share. Same shape everywhere so
downstream consumers pattern-match once:

```ts
{
  status: 'ok' | 'error',
  envelopeVersion: number,      // RESPONSE_ENVELOPE_VERSION
  verb: string | null,
  data?: <verb result>,         // when status === 'ok'
  error?: {
    code: NogginErrorCode | string,
    message: string,
    exitCode: number,
    data?: NogginErrorData,
  },                            // when status === 'error'
}
```

Two pages:

- [`JsonEnvelope`](json-envelope/) — the type union plus its two
  constituent shapes (`SuccessEnvelope`, `ErrorEnvelope`).
- [Envelope helpers](envelope-helpers/) — [`formatSuccess()`](envelope-helpers/)
  and [`formatError()`](envelope-helpers/). Use these instead of
  building the envelope by hand; they stamp the version field for
  you and unwrap engine `NogginError`s into the wire payload.

## Versioning

The envelope version increments only when the wrapper's shape
changes (a new field on the error side, a rename, etc.). It's
completely independent of `SCHEMA_VERSION`, which versions the
on-disk [`NogginDocument`](../core-data-model/noggin-document/).
Both are exported as [constants](../constants/).
