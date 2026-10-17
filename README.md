# MAS.S90 Project

- `embodiment/` – the Three.js character app
- `hologram_booth.scad` – OpenSCAD model of the Pepper's ghost booth

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

### Controls

| Key | Action |
| --- | --- |
| `1`–`5` | Throw stone / tomato / paint / egg / pie |
| `E` | Evict |
| `T` | Talk test |
| `H` | Hide the buttons (booth mode) |
| Mouse | Drag to orbit, scroll to zoom |
