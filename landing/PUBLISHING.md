# Aya's Playground public landing

Public URL: **https://wondping0.github.io/ayas-playground/**

## Hosting boundary

The owner requested GitHub publication alongside q-agent, then a distinct
**Aya's Number Challenge** design with leaf green. The current light, playful
layout replaces the original dark terminal presentation.
The existing public `wondping0/wondping0.github.io` repository serves this page
from `ayas-playground/`, alongside the personal homepage and `q-agent/`.
Pages uses `main` with source `/`; the root `.nojekyll` is retained.

Only these browser assets may be copied from this application's `landing/`:

- `index.html`
- `styles.css`
- `app.js`
- `assets/aya.svg`

Do not publish application source, environment files, uploaded bundles, order
artifacts, local tests, private Git history, or this publishing record.
System fonts replace the former q-agent font assets. Aya's leaf mark and
number-puzzle artwork are specific to this page.

## Local checks

```sh
npm run verify
python -m http.server 4173 --bind 127.0.0.1 --directory landing
```

The landing tests check correct and incorrect warm-up answers, retries,
exclusive pressed-button state, the no-JavaScript fallback, local HTML assets,
canonical URL, and internal section links. The puzzle runs locally without
network requests, challenge verification, or order creation.

The design adapts to narrow screens, preserves visible keyboard focus,
honors reduced motion, and uses system fonts. Browser visual inspection
must be reported separately from automated DOM checks.

## Updating the public page

1. Fetch the latest public site into a separate checkout and create a branch.
2. Copy only the files above into `ayas-playground/`.
3. Review the diff: no paths outside `ayas-playground/` should change.
4. Run the local checks and commit the static update using the owner's identity.
5. Push the branch and merge the reviewed commit into `main` without force.
6. Wait for the GitHub Pages build to reach `built`.
7. Fetch every deployed asset and compare its SHA-256 to the local file.
8. Verify the existing homepage and q-agent landing still return HTTP 200.

This publishes the marketing page only. Production marketplace operations
require separate infrastructure, payment setup, a real sandbox runner, and
operational validation.

## Current design — Aya's Number Challenge

Updated on **2026-10-21** following the owner's request for a distinct layout
and leaf-green theme. Centered editorial hero, number tiles, interactive warm-up,
two challenge cards, a simple buyer journey, and a creator invitation replace
the terminal, architecture panels, and condensed display type.

- Public commit: [`fa2e7193dddb0d148087e87701f5ce783d831fc8`](https://github.com/wondping0/wondping0.github.io/commit/fa2e7193dddb0d148087e87701f5ce783d831fc8).
- [Pages run 39599220233](https://github.com/wondping0/wondping0.github.io/actions/runs/39599220233): completed / success. Build API: `built`, matching commit, no error.
- All four current browser files returned HTTP 200 and matched local SHA-256 hashes.
- Previous font files were removed from the public subtree. Existing personal
  site and q-agent assets were unchanged; both landing URLs returned HTTP 200.
- `npm run verify` passed: typecheck, lint, 503 tests, and production build.
  The 22 Postgres cases remained skipped without a configured test database.
- Warm-up tests cover wrong answer, correct answer, retry after success,
  exclusive pressed state, and the no-JavaScript explanation.
- Core color pair checks passed AA text contrast (minimum measured 5.28:1).
- Independent review checked the complete public diff; generator-inclusion copy
  was corrected to reflect the unlimited-licence requirement.
- Browser inventory still exposed no browser. Responsive CSS was inspected,
  but screenshot-based visual QA was not available in this session.

## Initial publication record

Published on **2026-10-21**.

| Evidence | Observed result |
| --- | --- |
| Public commit | [`c96470db59cddf94a2837d99252001604f81ae13`](https://github.com/wondping0/wondping0.github.io/commit/c96470db59cddf94a2837d99252001604f81ae13) |
| Pages deployment | [Run 39592131241](https://github.com/wondping0/wondping0.github.io/actions/runs/39592131241), completed / success |
| Pages build API | `built`, matching the public commit, no error |
| Public landing | HTTP 200 |
| Eight deployed files | Each HTTP 200; SHA-256 matches local source bytes |
| Existing homepage and q-agent page | Both HTTP 200; no existing repository files changed |
| Application verification | `npm run verify`: typecheck, lint, 503 tests passed, production build passed |
| Database coverage | 22 Postgres contract cases skipped; no test database configured |
| Production-server smoke check | Homepage and login HTTP 200; updated catalog heading present |
| Landing review | Independent code review passed after clarifying static flag behavior |
| Accessibility checks | Local fonts, visible focus, native keyboard buttons, reduced-motion CSS; measured core text contrast 7.92:1 or better |

Browser automation inventory contained no available browser or native app, so
this release does not claim screenshot-based desktop/mobile visual verification.
DOM interactions, static assets, actual production HTTP responses, deployment
status, and exact published bytes were verified separately.
