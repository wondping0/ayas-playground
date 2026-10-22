# Contributing to Aya's Playground

Bug reports, documentation improvements, accessible interfaces, and focused patches
are welcome. The project is in development; discuss large architectural changes
in an issue first.

## Get started

1. Fork and clone the repository.
2. Use Node.js 22 (see `.nvmrc`) and run `npm ci`.
3. Copy `.env.example` to `.env.local`, then set your own development secrets.
4. Start `npm run dev`. Docker and Postgres are optional for UI work.
5. Create a branch such as `fix-catalog-empty-state`.

See [README](README.md#quick-start) for Docker verification and seed accounts.
Never run the demo seed against a real marketplace.

## Before changing code

Read [AGENTS.md](AGENTS.md) for conventions and the
[memory index](docs/memory-index.md) for the relevant contract.

- Keep business rules in Catalog, Forge, or Commerce; route handlers stay thin.
- Never execute uploaded code outside the Forge sandbox.
- Keep the stub runner unable to pass verification.
- Bind publication to a passing verification of the exact bundle version.
- Route order changes through the state machine and verified payment webhooks.
- Use the shared store contract suite for persistence changes.
- Edit generated agent guidance in `.wondev/`, then run `npx wondev@1.1.1 build`.

Add a failing regression test before fixing behavior. Cover malformed input and
boundary cases. UI changes should preserve keyboard navigation, visible focus,
readable contrast, and reduced-motion preferences.

## Verify your patch

```sh
npm run verify
```

This runs TypeScript, lint, Vitest, and a production build. GitHub Actions also
runs the store contract against a disposable Postgres database. For local testing,
follow [conventions](.wondev/memory/conventions.md): the suite truncates tables and
must use a dedicated database whose name includes `test`.

For landing changes, run `npm test -- landing`, preview at mobile and desktop
widths, and include screenshots when browser rendering is available. Follow
[publishing](landing/PUBLISHING.md) for the separate website repository.

## Open a pull request

Keep each PR focused. Explain the problem, the resulting behavior, and commands
actually run. Include reproduction steps for bugs and screenshots for visual
changes. Do not include secrets, private seller bundles, runtime artifacts, or
unrelated formatting changes.

Commit messages should describe an action, such as `Fix expired delivery links`.
Do not weaken assertions or bypass hooks to make checks pass. Document any
verification you could not perform.

## Vulnerabilities and conduct

Report suspected vulnerabilities privately to **wondev.support@gmail.com**.
Include affected versions, reproduction steps, and impact; do not post secrets,
customer data, or exploit details in public issues before coordination.
For ordinary help, see [SUPPORT.md](SUPPORT.md).

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are provided under
the [MIT license](LICENSE). This software license does not change the commercial
licences of third-party challenge bundles.
