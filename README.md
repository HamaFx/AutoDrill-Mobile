# AutoDrill (iOS / Android / PC)

Adds tools for automatically filling resource patches with drills — a
JavaScript edition of [AutoDrill](https://github.com/Pointifix/AutoDrill)
that also runs on **iPhone and iPad**.

The original mod is a Java mod. iOS cannot load Java mods at all (the iOS
build of Mindustry compiles everything ahead of time and does not allow
loading new code), so this edition is a full port to Mindustry's
JavaScript mod format, which iOS *does* support. Nothing about the tool
itself changed: same buttons, same layouts, same settings.

## Features

- **Mechanical / Pneumatic drill**: fills the tapped ore patch with drills in
  the classic modulo-6 lattice and wires them together with an item-bridge
  network, exiting in the chosen direction.
- **Laser / Airblast drill**: finds the best non-overlapping drill layout with
  a branch-and-bound search, places water extractors and power nodes next to
  each drill, and (optionally) routes every drill's output into a connected
  conveyor/duct tree. The tree automatically merges into the nearest existing
  belt, container or core (within ~24 tiles) so patches drain straight into
  your logistics; if nothing is nearby, the tree exits at the patch edge for
  you to connect (when nothing is nearby, the exit aims toward your core).
  Every drill gets a connection when physically possible —
  drills sealed inside a dense cluster get a mechanical-style bridge jump into
  the network (item bridges hop over the blocking drills), or a stub belt to
  extend when no jump is possible.
  Toggle it via **Place Conveyor Routing** in the mod settings; with the
  toggle off the fill behaves exactly as before.
- **Plasma bore (Erekir)**: fills wall ore with plasma bores, routes ducts
  back to the base direction and chains beam nodes.
- Automatic detection of the mineralled patch, minimum-ore thresholds and max
  tile counts are all configurable per drill type.

## Install

**Option A — in game (recommended)**

1. Update Mindustry to **8.158 or newer**.
2. Mods → Import Mod → Import from GitHub → `HamaFx/AutoDrill-Mobile`
   (or pick the `.zip` route below).
3. Enable the mod and restart the game when asked.

**Option B — import a `.zip` file (works on iOS and any other platform)**

1. Download `AutoDrill-iOS.zip` (or build it from this folder with
   `zip -r AutoDrill-iOS.zip mod.hjson icon.png LICENSE README.md bundles/ sprites/ scripts/`).
2. On iPhone/iPad: open the zip in the **Files** app and share it to
   Mindustry, or use **Mods → Import Mod → Import File** in game and pick the
   zip (`IOSLauncher` handles the Files picker).
3. On Android/PC the same **Import File** flow works, or drop the unpacked
   folder into the `mods/` directory of your Mindustry data folder.

**Enabling:** open the mod list, make sure AutoDrill is enabled (green), and
restart when asked.

## Usage

- Activate with the toggle button next to the minimap or the activation key
  (default `H` on keyboard devices).
- While active, tap any ore tile: a toolbar appears above the tile with the
  drills that can mine it.
- Mechanical/pneumatic/plasma bore ask for an output direction first.
- On mobile you can enable *Preview Plans Before Building (Mobile)* in the mod
  settings: plans land in Mindustry's native placement preview (the green
  checkmark) instead of being queued immediately.

## Settings

Settings → Auto Drill contains the activation key, the toggle-button
visibility, per-drill max-tile / minimum-ore sliders, the optimization quality
and the water-extractor / power-node toggle, plus a single
"Reset to Defaults" button for the whole category.

## Layout

```
AutoDrill-iOS/
├── mod.hjson                 # Mod metadata (iosCompatible, hidden)
├── icon.png                  # Mod icon
├── bundles/                  # Localizations (en, de, ru)
├── sprites/                  # logo / settings / tutorial images
└── scripts/
    ├── main.js               # Entry point: HUD button, tap handling, settings
    ├── direction.js          # Cardinal directions and axis projections
    ├── util.js               # Placement validation, flood fill, plan commit
    ├── bridgeDrill.js        # Mechanical/Pneumatic drill + item bridge layouts
    ├── optimizationDrill.js  # 3x3/4x4/5x5 drill optimizer (+ extractors/nodes)
    └── wallDrill.js          # Erekir plasma bore, duct and beam-node routing
```

## Notes for maintainers

The scripts deliberately avoid a handful of JavaScript features that the
Mindustry iOS JavaScript engine (Rhino 1.7.x in interpreter mode,
`optimizationLevel = -1`) mis-executes:

- no `const` declarations inside function bodies that run more than once
  (blocks/loops) — use `let`;
- locals captured by nested functions must be `const` (or held in a single
  `const` state object) — captured `let`/`var` locals are shared between calls;
- public Java fields shadow same-named methods in Rhino: `Element.visible` is a
  field, so dynamic visibility is set via the `visibility` field instead of
  calling `visible(Boolp)`;
- never use JavaScript `Set`/`Map`: `Set.add` routes through `java.util.HashMap.putIfAbsent`,
  which does not exist in RoboVM's JDK and hard-crashes the app — use arc's `IntSet`
  (already imported by `global.js`) or plain objects for visited-sets;
- no template literals (`${...}` is not interpolated);
- no `for (const x of ...)` (syntax error in that engine);
- top-level declarations always get an initializer;
- never subclass Java classes (`extend`/`JavaAdapter`); implement interfaces
  with `cons`/`run`/`boolp` and use scene composition instead.

## License

GPL-3.0, same as the original mod. See `LICENSE`.
