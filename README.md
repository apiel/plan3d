# plan3d

Floor plans from a phone: capture a room roughly, tighten it with the measurements you trust, view it in 3D.

Static site, everything runs in the browser (TypeScript + Vite, no backend), so it deploys as is to GitHub Pages.

## Idea

Renovation planning keeps going wrong because measurements are forgotten or the plan is never updated. The workflow this app is aiming for:

1. **Scan** a room with the phone (Android, WebXR depth): turn on the spot and walk around, the app builds the outline by itself. The result is approximate: walls a few cm off. (Drawing by hand in the editor also works, for use at a computer.)
2. **Tighten** it. Type in the measurements you trust (a wall measured with a tape or laser, a door width) and mark right-angle corners. A least-squares solver finds the corner positions that best satisfy everything: measured values count far more than capture values. The capture is trusted for the room's shape (each wall's direction and relative length), not its size: every room has its own scale, so measuring one wall stretches or shrinks the walls you did not measure in proportion, and further measurements share out the rest. The more you enter, the more accurate the plan.
3. **Join** rooms through shared doors to build the whole flat.
4. **Update** after renovation work by recapturing one room.
5. **Customise** at home: furniture, 2D and 3D views.

## Run

```
npm install
npm run dev        # editor at http://localhost:5173 (Vite picks the next port if taken)
npm test           # solver tests
npm run build      # typecheck + production build into dist/
```

Node 18 is enough (Vite 5, same as plinth3d).

### Pages

- **Scan room (phone)** in the editor starts the AR scan straight away (if the phone or browser lacks something, the editor says what is missing). Turn slowly aiming at walls, floor and ceiling, walk around the room, then Finish: the outline is added to the plan and you are back in the editor. A top-down mini map shows what has been seen so far. Optionally, while scanning, put the centre cross on each corner and tap **Corner**; for a door or window tap **Door**/**Window** at one side of it (aim at the wall just beside the frame), then aim at the other side, where a dashed line follows the cross with the width under it, and tap the button again, now labelled "2nd side". Marks are drawn over the camera view. The fourth button cancels a half-placed door or window ("Cancel door"), removes the mark under the cross (it turns red, "Remove"), or otherwise undoes the last mark ("Undo").
- `index.html` is the plan editor, phone first: the plan fills the screen, with one **Scan room** button, three tool icons (add a wall, a door, a window) and a ⋯ menu for the rest (square all corners, fit, export/import, last scan data, clear). Wall tool: tap corners one after the other (tapping an existing corner starts from it or closes the shape; tap the last corner again to stop). Door/window tool: tap a wall, then type the width. Tap a wall or its length to type the measured length, tap a door or window to change its type or width, tap a corner to make it a right angle or delete it; drag corners, pan with one finger, pinch or scroll to zoom. Furniture from scans is left out of the plan for now. Doors are drawn as a leaf with its swing arc, windows as thin lines across the wall. Plans are kept in `localStorage` and can be exported and imported as JSON.
- `depth.html` is the phone test page for WebXR depth sensing. See below.

## How the scan works

`src/scan.ts` collects keyframes while you move (every 15 cm or 12° of turning): the camera position and about 700 depth points in world coordinates. `src/scan/extract.ts` then:

1. Finds floor and ceiling from the spread of point heights (ARCore's world is gravity aligned, y up).
2. Takes walls from a band just under the ceiling (1.5 m above the floor up to the ceiling), above most furniture, so a sofa or desk against a wall does not move the wall. Falls back to a wide band if too little was seen up there.
3. Carves free space along every camera-to-point ray, stopping at walls (so a stray reading behind a wall cannot open it); floor and ceiling points are free space themselves. A cell needs 3 rays to count as free.
4. Cleans the free region (closing, hole filling, largest component), traces its outline and simplifies it.
5. Finds the dominant wall direction, rotates the capture to match, and snaps walls to it so rooms come out with clean right angles.
6. Groups the points between the floor and the wall band, inside the room, into furniture boxes (size and height), extended to the wall when they stand against one.

Marks change steps 4 and 5. With 3 or more marked corners, the marks define the outline instead of the traced free region: the traced outline only decides their order (so L shapes work), and each wall between two marks is refitted to the wall-band points along its middle 70%, because many depth points place a wall better than one reading at a corner. A fitted corner more than 30 cm from its mark falls back to the mark. So mark every corner, or none. Door and window marks become openings on the nearest wall (within 75 cm). A mark outside the room (a window at the back of a deep recess, or depth that went through the glass) goes to the wall that the line from the phone to it crosses first; each mark keeps where the phone was for that. Openings are stored as an offset from the wall's first corner plus a width, and scale with their wall when the solver rescales the room; a width typed in the editor stays fixed.

The extraction is covered by tests on synthetic rooms (rectangle, rotated rectangle, L shape, noisy readings with stray points, a furnished room). On a real phone (first try, furnished room, before the upper-band change) the result was "not bad but messy".

### Debugging a real scan

After a scan, the editor offers **Download last scan data** (raw keyframes and marks as JSON; kept in memory until the page is reloaded). On the computer:

```
npm run replay -- scan-....json
```

prints floor/ceiling, wall lengths, doors/windows and furniture, and writes `scan-....svg`: raw top-down points on the left (green: wall band, grey: lower, red: camera positions, pink squares: marked corners, blue/cyan lines: marked doors/windows), the extracted room and furniture on the right. Use it to tune the constants at the top of `src/scan/extract.ts`, and add good files as test fixtures.

## Depth test on a phone

`depth.html` checks whether the phone gives usable depth through WebXR and measures between two points, to compare with a tape. Aim the crosshair at a point and tap, then aim at a second point and tap.

WebXR needs a secure context (Chrome on Android):

- **Over USB:** `npm run dev`, `adb reverse tcp:5173 tcp:5173` (use the port Vite printed), open `http://localhost:5173/depth.html` on the phone.
- **Same WiFi, no cable:** open `http://<computer-ip>:5173/depth.html` on the phone, after enabling `chrome://flags/#unsafely-treat-insecure-origin-as-secure` for that exact address and relaunching Chrome. `ufw` on the computer may need the port opened for the LAN.
- **GitHub Pages:** HTTPS, works without flags once deployed.

Result on a Pixel 9a: depth works, measurements are "not perfect, but not bad". Not yet compared systematically against a tape, nor on blank white walls.

## Code

| File | What |
| --- | --- |
| `src/model.ts` | Plan data model (points, walls, constraints) and edit helpers. Metres, y down. |
| `src/solver.ts` | Least-squares adjustment (Levenberg-Marquardt, numeric Jacobian): capture shape per room at a free scale, measured distances, right angles. `SIGMA` sets how much each kind of fact is trusted. |
| `src/solver.test.ts` | Solver tests (vitest). |
| `src/main.ts` | Canvas editor and side panel. |
| `src/scan.ts` | AR scan, started from the editor: collects depth keyframes, crosshair marks drawn over the camera, mini map, adds the room to the plan. |
| `src/scan/extract.ts` | Keyframes to room outline (see above). |
| `src/scan/extract.test.ts` | Extraction tests on synthetic rooms. |
| `scripts/replay.ts` | Replays a downloaded scan through the extraction and writes an SVG. |
| `src/storage.ts` | Plan persistence in `localStorage`. |
| `src/xr.ts` | WebXR matrix helpers shared by the scan code. |
| `src/depth-test.js` | WebXR depth test page logic (plain JS, predates the scan). |

See [TODO.md](TODO.md) for what is next.
