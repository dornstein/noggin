# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial layout: `cli/` (source of truth), `plugin/` (agent plugin), `extension/` (VS Code extension).
- Skill: `cli/SKILL.md` — agent guide for working-memory tree.
- Reference: `cli/README.md` — full human documentation.
- CLI: `cli/noggin.mjs` — single-file ES module, depends only on `js-yaml`.
- CLI: `delete <path> [--recursive]` verb. Refuses non-empty subtrees without `--recursive`; reassigns active to the deleted item's parent when active is inside the removed subtree.
