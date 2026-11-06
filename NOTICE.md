# Notice

Kurapify is licensed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)). It is built on the work of other people and projects, whose licenses require these credits to stay with the code. Thank you to all of them.

## Where Kurapify comes from

Kurapify began as a desktop adaptation of **BitChord**, an open-source YouTube Music client by **Kushagra Singh** (<https://github.com/kushagrasinghx/BitChord>), released under the GPL-3.0. The web player and its companion extension in `web/` are derived from that project: the page-to-extension bridge, the YouTube playback and sign-in design, the lyrics and queue models, and much of the structure. The desktop shell (`desktop/`) and the changes made since, such as the interface, the full-screen player, the library, folders and menus, are this project's own work. Under GPL-3.0 section 5, this is a modified version, and every file keeps the notices it came with.

## Components with their own licenses

| Component | Where | Author and license |
|---|---|---|
| **AutoMix** (DJ engine, beat analysis) | `web/app/src/playback/automix/` | David Finnegan, [AGPL-3.0](https://github.com/heydavidf/automix). Those files carry their own headers and stay under the AGPL (see `NOTICE.md` in that folder) |
| **Orchard** (beat and vocal front ends the analysis follows) | `web/app/src/playback/automix/analysis/models.ts` | SFG545, AGPL-3.0-or-later ([Orchard](https://github.com/SFG5453/Orchard)) |
| **essentia.js** (audio analysis) | dependency | Music Technology Group, Universitat Pompeu Fabra, AGPL-3.0 |
| **am-lyrics** (synced lyrics component) | dependency | [`@uimaxbai/am-lyrics`](https://www.npmjs.com/package/@uimaxbai/am-lyrics), by binimum and contributors |
| **YouTube.js** (InnerTube client) | dependency | LuanRT and contributors, MIT |
| **googlevideo** (SABR streaming) | dependency | LuanRT and contributors, MIT |
| **Shaka Player** | dependency | Google, Apache-2.0 |
| **hls.js** | dependency | Dailymotion and contributors, Apache-2.0 |
| **Beat This!** and **open-unmix** model weights | `web/app/public/models/` | CPJKU (Beat This!) and Sony / Inria (open-unmix), MIT |
| **Inter** (variable font) | dependency | Rasmus Andersson, SIL OFL 1.1, through Fontsource |
| **Lucide** icons | dependency | Lucide contributors, ISC |
| React, Vite, Tailwind CSS, Zustand, TanStack Query and others | dependencies | their authors, MIT |
| **Electron** | `desktop/` | OpenJS Foundation, MIT |

The full list, with versions and license texts, is in each package's own `package.json` and `node_modules` after `pnpm install`.

## Not affiliated

Kurapify is not affiliated with, endorsed by, or connected to YouTube, Google, Apple Inc. or Spotify AB. "YouTube", "YouTube Music", "Apple Music", "Spotify" and other names are trademarks of their respective owners and are used only to say what Kurapify works with. The interface follows the look of Apple Music from public measurements (`web/docs/apple-music-dom.md`); it uses no Apple code or assets.
