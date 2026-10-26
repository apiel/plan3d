# TODO

Status: the whole chain exists. `scan.html` collects depth on the phone, `src/scan/extract.ts` turns it into an outline (tested on synthetic rooms only), the editor opens it, and the solver tightens it with measurements. The depth test page works on a Pixel 9a. **Nothing of the scan has run on a real phone yet**, and the editor UI has only been typechecked, built and loaded empty, not clicked through.

## Next

- [ ] **Try `scan.html` on the Pixel in a real room** and fix what breaks. Things to check: does the mini map fill with green wall points; is the world really y-up (the extraction relies on it); is the depth view orientation right (grid is 24 columns by 32 rows, portrait); does Finish give a sensible outline; how far off are the wall lengths against a tape. If it fails, log the keyframes (export them as JSON) and replay them through `extractRoom` on the computer to debug without the phone.
- [ ] Tune the extraction on real data: `FREE_MIN`, closing radius, `STUB`, band `lo`/`hi` in `src/scan/extract.ts`. Furniture against a wall currently pushes the wall inwards.
- [ ] Add a way to export the raw keyframes from the scan page (for replay and tests).
- [ ] Better scan guidance: show which directions are still uncovered, warn when the floor or ceiling was never seen (floor height is estimated from the lowest 2% of points).
- [ ] Click through the editor in a browser and fix whatever is broken (draw room, set length, right angle, drag, import/export).
- [ ] Commit, push, enable GitHub Pages (a workflow that runs `npm run build` and publishes `dist/`). `base` is already `./`.
- [ ] Test depth accuracy properly: known tape distances, textured vs blank white wall, short vs long, note the error. Decides how much to trust `SIGMA.sensor` (currently 5 cm).

## Plan editor

- [ ] Detect doors from the scan (gaps in the wall band seen from inside) instead of leaving them as ragged edges.
- [ ] Doors and windows as openings on a wall (position along the wall, width), with measured sizes as constraints.
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
- [ ] Furniture placement from a small library, with real dimensions.
- [ ] Reuse parts of plinth3d (3D viewport, objects) where it makes sense, via copy or a shared package.

## Capture alternatives (only if the phone depth is not good enough)

- [ ] Bluetooth laser distance meter into the web page (Web Bluetooth), writes straight into wall lengths.
- [ ] Cheap 2D spinning LiDAR (LDROBOT LD06/LD19 or similar) plus ESP32 sending over Bluetooth, scan-match several positions. WiFi from an HTTPS page is blocked (mixed content), so use Bluetooth.

## Maybe

- [ ] Convert the editor to React like plinth3d if the UI grows.
- [ ] Import RoomPlan / Polycam / Magicplan exports.
