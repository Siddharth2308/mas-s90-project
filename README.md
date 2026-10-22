# MAS.S90 Project

- `embodiment/` – the Three.js character app
- `hologram_booth.scad` – OpenSCAD model of the Pepper's ghost booth
- `blender/` – scripts that build Pie's body in Blender and export it to `embodiment/public/models/pie.glb`

## Rebuilding Pie's body (optional)

Needs Blender 5.2, the MPFB extension and three CC0 MakeHuman asset packs
(`makehuman_system_assets_cc0.zip`, `visemes01.zip`, `faceunits01.zip` from
https://static.makehumancommunity.org/assets/assetpacks.html):

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender
$B --online-mode --command extension install -s -e mpfb               # once
$B --background --python blender/install_packs.py -- path/to/*.zip     # once
$B --background --python blender/make_human.py    # builds blender/human.blend + previews in blender/renders/
$B --background --python blender/export_human.py  # writes embodiment/public/models/pie.glb
```

Look, clothes, tints, cyborg seams and the emotion shape keys are set at the top of `make_human.py`.

## Running the app on your PC

1. Install [Node.js](https://nodejs.org) (the LTS version, 22 or newer).
2. Open a terminal in the `embodiment` folder:
   ```bash
   cd embodiment
   ```
3. Install the dependencies (one-time step):
   ```bash
   npm install
   ```
4. Start the app (do this any time you want to run it):
   ```bash
   npm run dev
   ```
5. Open the link it prints (usually http://localhost:5173) in Chrome.

Press `Ctrl+C` in the terminal to stop it.

### Talking to Pie (optional, one-time setup)

The robot answers out loud using Claude Code (Haiku) and a local Piper voice.

1. Install [Claude Code](https://claude.com/claude-code) and log in once by running `claude`.
2. Install the voice (needs Python 3):
   ```bash
   npm run setup:voice
   ```
3. Restart `npm run dev`.

Without Claude Code he answers with canned lines; without Piper he uses the browser's voice.
His personality is in `embodiment/quarantine/persona.md` (press `N` after editing it).
Claude Code runs inside `quarantine/` with all tools turned off, so visitors can only talk to it.

### Controls

| Key | Action |
| --- | --- |
| Hold `Space` | Talk (or type in the box and press Enter) |
| `N` | New visitor (fresh conversation) |
| `1` | Throw a pie |
| `2` | Throw a rock |
| `3` | Throw a tomato |
| `4` | Throw an egg |
| `5` | Throw a paint balloon |
| `E` | Evict |
| `T` | Talk test |
| `H` | Hide the buttons (booth mode) |
| Mouse | Drag to orbit, scroll to zoom |
