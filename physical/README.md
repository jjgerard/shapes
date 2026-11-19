# Physical block set

Connector design for a printable, snap-together version of the game.

| File | What it is |
|---|---|
| `dump_rules.js` | Pulls categories, fragments and legal joins out of `data.js` into `rules.json`. |
| `spokes.py` | Assigns the circle-and-spokes keys, verifies them geometrically, draws the sheets. |
| `SPOKES.md` | Generated report: every piece, what it hangs from, what each arm takes. |
| `out/spokes_*.png/.svg` | Drawings of every piece's socket and plugs. |
| `out/spokes_*.json` | Spoke angles and key codes, for generating printable files later. |

Regenerate after any change to the game's rules (needs `shapely`):

```sh
node physical/dump_rules.js && python3 physical/spokes.py
```

The earlier "game silhouettes as connectors" variant is in git history (commit `ec9557d`).
