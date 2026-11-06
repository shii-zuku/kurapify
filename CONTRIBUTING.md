# Contributing

Thanks for wanting to help. Kurapify is a small project; a few ground rules keep it pleasant to work on.

## Before you start

- **Open an issue first** for anything bigger than a bug fix or a small polish, so the direction fits before you spend the time.
- Read the notes in [`web/docs`](web/docs) for the part you are touching (sign-in, queue and player, lyrics, Automix, the Apple Music design measurements). They record decisions and the things that were tried and did not work.

## Set up

```bash
corepack pnpm --dir web install
corepack pnpm --dir web/app dev        # the player in a browser, http://localhost:5173
```

For the desktop window, see "Install and run" in the [README](README.md).

## Checks

Run these before you open a pull request:

```bash
corepack pnpm --dir web -r typecheck
corepack pnpm --dir web/app exec vitest run
```

Parsers are tested against **real captured responses** in `web/fixtures`, not hand-written ones. If you change how a response is read, refresh the fixture (`web/scripts/capture-fixtures.mjs`) and test against it.

## Style

- TypeScript in strict mode, with `noUncheckedIndexedAccess`. No `any` without a comment saying why.
- Match the code around you: its naming, its comment density, its idiom. Comments say **why**, not what.
- React hooks go above every early `return` in a component. A menu that swaps between views once broke the app by skipping hooks.
- UI text is English. Keep strings short and in the voice of the rest of the interface.
- Animations respect the app's own motion setting (`lib/motionPref.ts`), and anything that only paints stops while the window is minimised (`lib/frameScheduler.ts`).

## Pull requests

- One change per pull request, with a description of what and why. A screenshot helps for anything visible.
- By contributing you agree that your work is released under the project's license, the **GNU General Public License v3.0**.
- Keep third-party notices intact: do not remove or rewrite a copyright header, a `NOTICE` file or an attribution. See [NOTICE.md](NOTICE.md).

## Security

Do not post cookies, tokens or session data in an issue. If you find a vulnerability, report it privately to the maintainers rather than in public.
