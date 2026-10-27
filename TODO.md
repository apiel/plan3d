# TODO

Status: the whole chain exists, including furniture boxes and raw scan download/replay. the scan (started from the editor's Scan button) collects depth on the phone, `src/scan/extract.ts` turns it into an outline (tested on synthetic rooms only), the editor opens it, and the solver tightens it with measurements. The depth test page works on a Pixel 9a. **Nothing of the scan has run on a real phone yet**, and the editor UI has only been typechecked, built and loaded empty, not clicked through.

## Next

- [ ] **Scan the (emptier) renovation house** with the editor's Scan button, **download the scan data** for each room, and compare wall lengths with a tape. First real try (furnished room, older version) was "not bad but messy"; since then walls come from the band under the ceiling and furniture is detected separately.
- [ ] **Try the crosshair marks on the Pixel** (Corner / Door / Window / Remove in the scan; marks drawn over the camera, dashed line while placing a door/window): does the cross turn green on walls and in corners, is the distance under it right, do door edges land on the wall or the room behind (aim beside the frame), do fully marked rooms come out cleaner than unmarked ones. Download the scan data: marks are in it and replay uses them.
- [ ] Replay the downloaded files (`npm run replay -- file.json`), look at the SVG, tune the constants in `src/scan/extract.ts` (`WALL_BAND_FROM`, `FREE_MIN`, `OCC_MIN`, `STUB`, furniture thresholds). Turn good files into test fixtures (they are big: maybe keep a subsampled copy).
- [ ] Check on real data: is the world really y-up (the extraction relies on it); is the depth grid orientation right (24 columns by 32 rows, portrait); is the ceiling seen (if not, walls come from a lower band that includes furniture).
- [ ] Better scan guidance: show which directions are still uncovered, warn when the floor or ceiling was never seen (floor height is estimated from the lowest 2% of points).
- [~] Click through the editor in a browser: in use on desktop and phone, fixes made as found.
- [x] Commit, push, GitHub Pages (workflow in `.github/workflows/pages.yml`), live at apiel.github.io/plan3d.
- [ ] Test depth accuracy properly: known tape distances, textured vs blank white wall, short vs long, note the error. Decides how much to trust `SIGMA.sensor` (currently 5 cm).

## Plan editor

- [x] Detect doors from the scan instead of leaving them as ragged edges (`seeThroughOpenings`, `cutNecks` in `src/scan/extract.ts`): free space seen through a doorway is cut off at necks under ~1.1 m, and stretches of wall the phone saw through at hip and chest height become doors. Window detection (wall under the sill, open above) was removed after the first real try: it put windows all over the plan (depth noise past the walls). Stairs from the scan did not show up in that try either: **need the scan data file** to see why. Synthetic tests only. A closed door, or glass that stops the depth, cannot be seen this way: mark those. Rooms narrower than ~1.1 m skip the cut. Check on real scans: `NECK`, `SEE_*`, `LOW_BAND`/`MID_BAND`, `JOG`.
- [ ] Doors and windows: openings come from scan marks, drawn with plan symbols; type, width and delete in the editor. Added by hand with the door/window tools. Hinge side and swing flip done, widths shown on the plan. Still missing: slide it along the wall, measured sizes as constraints, window sill and height.
- [x] Join rooms through a shared door (`src/rooms.ts`): select a door, Join rooms, tap the same door in the other room; the second room moves and turns onto it (one wall thickness apart) and stays attached when measurements rescale it. Not tried on the phone.
- [x] More constraints: parallel walls, equal length (wall panel: Parallel to… / Same length…, then tap the other wall), fixed angle (corner panel: Angle field). Not done: horizontal/vertical.
- [x] Least certain walls from the solver covariance: wall panel shows ± cm, and the unmeasured wall worth measuring next in each room is orange.
- [x] Undo/redo (`src/history.ts`): buttons under the tools, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y.
- [x] Multiple rooms in one plan: each Scan room adds one, tap a room's floor to select it and delete it.
- [ ] Flat/house level (several floors), several plans, rename.
- [x] Touch support on the editor (pinch zoom, pan, bigger tap areas): done, to check on the phone.
- [x] Wall thickness: per wall (default 10 cm), set in the wall panel, outward from the room's inner face. Not tried on the phone.
- [ ] Ceiling height and room name per room.

## Versions / updates

- [ ] Keep plan history (git-style snapshots) so a re-scan after renovation is a new version; diff between versions.
- [ ] Rescan one room and replace it in the plan, re-anchored through its door.
- [x] Optional sync: Google Drive (`src/drive.ts`), written, not tried yet: needs `CLIENT_ID` set (see README). Chosen over a GitHub repo (no backend OAuth, no tokens pasted). Never commit real plans to a public repo.

## 3D and home use

- [ ] 3D view from the plan with three.js (extrude walls, openings), same stack as plinth3d.
- [ ] Furniture: shelved for now (the scan still detects boxes, the plan leaves them out; the editor drops old ones on load). When it comes back: rotate boxes, resize, name them, and show heights in 3D. Detected boxes are axis aligned with the room; a diagonal sofa comes out as its bounding box. Tall furniture (wardrobes) reaches the wall band and dents the wall instead.
- [ ] Furniture placement from a small library, with real dimensions.
- [ ] Reuse parts of plinth3d (3D viewport, objects) where it makes sense, via copy or a shared package.

## Capture alternatives (only if the phone depth is not good enough)

- [ ] Bluetooth laser distance meter into the web page (Web Bluetooth), writes straight into wall lengths.
- [ ] Cheap 2D spinning LiDAR (LDROBOT LD06/LD19 or similar) plus ESP32 sending over Bluetooth, scan-match several positions. WiFi from an HTTPS page is blocked (mixed content), so use Bluetooth.

## Maybe

- [ ] Convert the editor to React like plinth3d if the UI grows.
- [ ] Import RoomPlan / Polycam / Magicplan exports.

# IDEA from dev

- ~~when camera is on there should be a cross/point in the center and then button which allow us to place corner of the room, to place door, place window (place furniture)~~ corners, doors and windows done (see Next); furniture marks still open: tap on an object to keep the nearest detected box and name it.


- 3d plan should also take 8 picture of the room, which can be updated over time, to have a timeline

- ~~the right angle symbol look like there is a pilone in the room~~ done: the angle is only drawn at the selected corner (also while dragging), square at 90°, otherwise an arc and the value.

- give name to room

- ~~we need to be able to place stair case~~ done: stairs tool in the editor (straight flight: width, length, steps, turn, up/down, drag to move), and **Stairs** in the scan (3 marks: both ends of the bottom step's edge, then the top edge; steps counted from the height). Scan marks not tried on the phone. Not yet: L/U-shaped stairs, linking floors.

- ~~ctrl+z ctrl+shift+z should work for undo redo~~ done.

- when adding a wall manually i am not able to set angle to 90degree



- How can i share a plan with someone...?

- Now i was adding manually a wall in middle of another wall. Would be great to see his distance from the other walls...


- Would there be way to kind of suggest door, windows and corner in the scan view? and then we could apply them or not