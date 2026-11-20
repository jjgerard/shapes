# Physical block set

Connector design for a printable, snap-together version of the game.

One kit, two ways to use it: **XP mode** (flat) and **X′ mode** (X-bar). The phrase pieces are
shared; only the heads come in two kinds. XP-heads fit only XP pieces and X′-heads fit only X′
pieces, so a head can't skip the bar level in X′ mode.

| File | What it is |
|---|---|
| `dump_rules.js` | Pulls categories, fragments and legal joins out of `data.js` into `rules.json`. |
| `spokes.py` | Assigns the circle-and-spokes keys, verifies them geometrically (and against every game tree), draws the sheet. |
| `SPOKES.md` | Generated report: kit sizes per mode, every piece, what it hangs from, what each arm takes. |
| `out/spokes.png/.svg` | One sheet drawing every piece's socket and plugs. |
| `coupon.py` | Builds the STL test coupon and checks the real meshes in 3D (seats every plug in every socket and measures overlap). |
| `coupon/` | The coupon: three `.stl` files, `COUPON.md` (how to print and what to test), `preview.png`. |
| `arms.py` | Lays out every game tree with real piece sizes to find the arm design; checks all 14 trees and draws the results. |
| `ARMS.md` | Generated: the arm design, why these numbers, tree sizes, and what is still open. |
| `out/arms_piece.*`, `out/arms_trees.*` | Drawings: one three-arm piece to scale, and the game's trees built with the chosen arms. |
| `hinge.py` | Designs the arm hinge: works out the torque it must hold from the game's trees, models the detent, builds the printable parts and checks the real meshes. |
| `HINGE.md` | Generated: the hinge design, the numbers, how to print and test it, and what is still open. |
| `hinge/` | The hinge coupon: `hinge_housing.stl`, `hinge_hub_arm.stl`, three lid thicknesses `hinge_lid_t*.stl`, plus `torque.png` and `parts.png`. |
| `stow.py` | What to do with unused arms: tests leaving them on, designs a snap-in arm, builds and checks the parts, and measures the tilting-children problem. |
| `STOW.md` | Generated: the findings and the snap-in arm design. |
| `arm_options.py` | Compares ways for the arm to move (swing, swing with a swivel, slide) on every game tree. |
| `ARM_OPTIONS.md` | Generated: the comparison, the swivel's load, and what the sliding model leaves out. |
| `fortify.py` | Finds where the arm would break (hand calculations from the game's loads plus a shove) and builds and checks a fortified version. |
| `FORTIFY.md` | Generated: break points, safety factors before and after, and what changed. Parts in `hinge/fortified/`. |
| `swivel.py` | Builds the swivel tip cartridge (arm tip, swivel hub, lids), checks free turn, detent and plumb child at every arm click, and runs the layouts. |
| `swivel_loads.py` | Recomputes the loads with real masses and writes the "weight problem" section of `SWIVEL.md`. |
| `SWIVEL.md` | Generated: cartridge design, checks, layout result, weight problem. Parts in `hinge/swivel/`. |
| `slide.py` | Designs the sliding arm (two-stage telescoping dovetail slide with detents, mount and plug insert), checks all settings on the real meshes, and re-runs the layouts with its real outline. |
| `SLIDE.md` | Generated: why a telescope, how it works, checks, loads, layouts, what is not settled. Parts in `hinge/slide/`. |
| `slide_coupon.py` | Builds the slide test coupon: the sliding arm at a third of the length in three clearance sets, plus a mount block. Print this first. |
| `SLIDE_COUPON.md` | Generated: what to print, what to test and write down, how to read the results. STLs in `slide_coupon/`. |
| `body.py` | Builds the 27 piece bodies (socket, arm grooves, posts) and 27 plug inserts, and checks on the meshes: arms fit, every plug seats in every child it is meant for and in no other. |
| `BODY.md` | Generated: body design, sizes and masses, checks, what is not settled. STLs in `body/`. |
| `out/spokes.json` | Spoke angles and key codes, for generating printable files later. |

Regenerate after any change to the game's rules (needs `shapely`):

```sh
node physical/dump_rules.js && python3 physical/spokes.py
```

The earlier "game silhouettes as connectors" variant is in git history (commit `ec9557d`).
