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
| `out/spokes.json` | Spoke angles and key codes, for generating printable files later. |

Regenerate after any change to the game's rules (needs `shapely`):

```sh
node physical/dump_rules.js && python3 physical/spokes.py
```

The earlier "game silhouettes as connectors" variant is in git history (commit `ec9557d`).
