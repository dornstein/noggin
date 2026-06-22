# Docs site

The source for [https://dornstein.github.io/noggin/](https://dornstein.github.io/noggin/).

Built and deployed by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml)
on every push to `main`.

## Layout

```
docs/site/
  build.mjs              entry point; orchestrates the whole build
  template.mjs           shared HTML chrome (sidebar nav, footer)
  markdown.mjs           tiny markdown → HTML renderer (no external deps)
  assets/style.css       site stylesheet
  pages/*.md             hand-written content pages
  generators/            scripts that produce HTML from live source
    cli.mjs                runs `noggin help`
    api.mjs                parses cli/**/*.d.mts for @public / @internal
    schema.mjs             renders cli/noggin.schema.json
```

The legacy [`scripts/build-demo-html.mjs`](../../scripts/build-demo-html.mjs)
is invoked by `build.mjs` to produce the `/demo/` page.

## Build locally

```bash
node docs/site/build.mjs --out docs/site/dist
```

Open `docs/site/dist/index.html` in a browser. The output is in
`.gitignore`.

## Adding a page

1. Drop a markdown file under `pages/` with frontmatter:

   ```markdown
   ---
   title: Some page
   slug: "some-page/"
   ---
   ```

   `slug` is the URL slug (always trailing-slashed; `""` for root).
   The page renders to `<out>/<slug>index.html`.

2. Add an entry to `NAV` in [`template.mjs`](./template.mjs) so it
   appears in the sidebar.

3. `node docs/site/build.mjs` and check the result.

## Dynamic content

The site never hand-mirrors information that's already in the
source — every dynamic generator reads from canonical files in the
repo so docs and code can't drift:

| Page | Source of truth |
|---|---|
| `/cli/` | `noggin help` output (rebuilt CLI on every build) |
| `/api/` | `cli/noggin-api.d.mts`, `cli/backends/file.d.mts`, `cli/serializers/*.d.mts` |
| `/schema/` | `cli/noggin.schema.json` |
| `/demo/` | `scripts/build-demo-html.mjs` (runs real CLI scenarios) |

If you change one of those sources, the next CI build picks it up
automatically. No manual sync needed.

## Markdown subset supported

The hand-rolled renderer in [`markdown.mjs`](./markdown.mjs) covers
the common cases: headings, paragraphs, fenced code blocks with
language hints, inline code, bold/italic, links, images, ordered
and unordered lists, pipe tables, blockquotes, horizontal rules, and
inline HTML passthrough (so we can drop `<div class="card-grid">`
etc. directly in markdown). If you need something more exotic, just
write HTML inline — the renderer leaves it alone.
