# TODO

Status: the whole chain exists, including furniture boxes and raw scan download/replay. the scan (started from the editor's Scan button) collects depth on the phone, `src/scan/extract.ts` turns it into an outline (tested on synthetic rooms only), the editor opens it, and the solver tightens it with measurements. The depth test page works on a Pixel 9a. **Nothing of the scan has run on a real phone yet**, and the editor UI has only been typechecked, built and loaded empty, not clicked through.

## Next

- [ ] **Scan the (emptier) renovation house** with the editor's Scan button, **download the scan data** for each room, and compare wall lengths with a tape. First real try (furnished room, older version) was "not bad but messy"; since then walls come from the band under the ceiling and furniture is detected separately.
- [ ] **Try the crosshair marks on the Pixel** (Corner / Door / Window / Remove in the scan; marks drawn over the camera, dashed line while placing a door/window): does the cross turn green on walls and in corners, is the distance under it right, do door edges land on the wall or the room behind (aim beside the frame), do fully marked rooms come out cleaner than unmarked ones. Download the scan data: marks are in it and replay uses them.
- [ ] Replay the downloaded files (`npm run replay -- file.json`), look at the SVG, tune the constants in `src/scan/extract.ts` (`WALL_BAND_FROM`, `FREE_MIN`, `OCC_MIN`, `STUB`, furniture thresholds). Turn good files into test fixtures (they are big: maybe keep a subsampled copy).
- [ ] Check on real data: is the world really y-up (the extraction relies on it); is the depth grid orientation right (24 columns by 32 rows, portrait); is the ceiling seen (if not, walls come from a lower band that includes furniture).
- [ ] Better scan guidance: show which directions are still uncovered, warn when the floor or ceiling was never seen (floor height is estimated from the lowest 2% of points).
- [ ] Click through the editor in a browser and fix whatever is broken (draw room, set length, right angle, drag, import/export).
- [ ] Commit, push, enable GitHub Pages (a workflow that runs `npm run build` and publishes `dist/`). `base` is already `./`.
- [ ] Test depth accuracy properly: known tape distances, textured vs blank white wall, short vs long, note the error. Decides how much to trust `SIGMA.sensor` (currently 5 cm).

## Plan editor

- [ ] Detect doors from the scan (gaps in the wall band seen from inside) instead of leaving them as ragged edges.
- [ ] Doors and windows: openings exist (from scan marks, drawn on the wall). Still missing: add/edit/delete them in the editor, measured sizes as constraints, window sill and height.
- [ ] Join rooms through a shared door: pick the same door in two rooms, align them, wall thickness between.
- [ ] More constraints: parallel walls, horizontal/vertical, equal length, fixed angle (not only 90°).
- [ ] Highlight which walls are least certain (e.g. from the solver covariance) so you know what to measure next.
- [ ] Undo/redo.
- [ ] Multiple rooms and a flat/house level, several plans, rename.
- [ ] Touch support on the editor (pinch zoom, pan) for use on the phone.
- [ ] Ceiling height and room name per room.

## Versions / updates

- [ ] Keep plan history (git-style snapshots) so a re-scan after renovation is a new version; diff between versions.
- [ ] Rescan one room and replace it in the plan, re-anchored through its door.
- [ ] Optional sync: commit the plan JSON to a private GitHub repo via the API. Never commit real plans to a public repo.

## 3D and home use

- [ ] 3D view from the plan with three.js (extrude walls, openings), same stack as plinth3d.
- [ ] Furniture: rotate boxes, resize, name them, and show heights in 3D. Detected boxes are axis aligned with the room; a diagonal sofa comes out as its bounding box. Tall furniture (wardrobes) reaches the wall band and dents the wall instead.
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
