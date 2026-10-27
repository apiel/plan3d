## Versions / updates

- [ ] Keep plan history (git-style snapshots) so a re-scan after renovation is a new version; diff between versions.
- [ ] Rescan one room and replace it in the plan, re-anchored through its door.
- [x] Optional sync: Google Drive (`src/drive.ts`), written, not tried yet: needs `CLIENT_ID` set (see README). Chosen over a GitHub repo (no backend OAuth, no tokens pasted). Never commit real plans to a public repo.

## 3D and home use

- [ ] 3D view from the plan with three.js (extrude walls, openings), same stack as plinth3d.
- [ ] Furniture placement from a small library, with real dimensions.

## Capture alternatives (only if the phone depth is not good enough)

- [ ] Bluetooth laser distance meter into the web page (Web Bluetooth), writes straight into wall lengths.

# IDEA from dev

- 3d plan should also take 8 picture of the room, which can be updated over time, to have a timeline

- How can i share a plan with someone...?

- Would there be way to kind of suggest door, windows and corner in the scan view? and then we could apply them or not

- ~~a wall added across a room should make 2 rooms, and move with the room~~ done: a wall ending on another wall is joined to it (that wall is split there, the halves held in line), and rooms are the areas closed in by walls: each can be selected, named, duplicated and deleted on its own. Moving still moves the whole connected group. Not yet: a measurement over a wall that got split (e.g. 291 cm) still holds but is no longer shown on the halves.




- AI export with instruction...