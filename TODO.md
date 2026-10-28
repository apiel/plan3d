## Versions / updates

- [ ] Keep plan history (git-style snapshots) so a re-scan after renovation is a new version; diff between versions.
- [ ] Rescan one room and replace it in the plan, re-anchored through its door.
- [x] Optional sync: Google Drive (`src/drive.ts`), written, not tried yet: needs `CLIENT_ID` set (see README). Chosen over a GitHub repo (no backend OAuth, no tokens pasted). Never commit real plans to a public repo.

## 3D and home use

- [x] 3D view from the plan with three.js (extrude walls, openings), same stack as plinth3d. First version: no door leaves, no ceiling, one height for the whole plan, room names not shown. Not tried on the phone yet.
- [ ] Furniture placement from a small library, with real dimensions.

## Capture alternatives (only if the phone depth is not good enough)

- [ ] Bluetooth laser distance meter into the web page (Web Bluetooth), writes straight into wall lengths.

# IDEA from dev

- 3d plan should also take 8 picture of the room, which can be updated over time, to have a timeline

- ~~How can i share a plan with someone...?~~ partly: "Export plan (SVG)" is a picture of the plan anyone can open (browser, phone), and it can be imported back. Not yet: a link to open it in the app.

- Would there be way to kind of suggest door, windows and corner in the scan view? and then we could apply them or not

- ~~a wall added across a room should make 2 rooms, and move with the room~~ done: a wall ending on another wall is joined to it (that wall is split there, the halves held in line), and rooms are the areas closed in by walls: each can be selected, named, duplicated and deleted on its own. Moving still moves the whole connected group. Not yet: a measurement over a wall that got split (e.g. 291 cm) still holds but is no longer shown on the halves.




- AI export with instruction...


- ~~Give a way to name the file for save... give a name to the whole project~~ done: the ⋯ menu shows the plan's name (tap to rename), exports and Drive use it as the file name, and Drive saving goes back into the file the plan was loaded from. Not tried yet on Drive.
- ~~save the plan as SVG with metadata, so an AI chat can edit it~~ done: "Export plan (SVG)" writes a drawing of the plan with the plan JSON (exactly what "Export plan (JSON)" gives) in `<metadata id="plan3d-data">` and instructions for an AI in a comment at the top (`src/planfile.ts`). "Import plan" takes .svg or .json, ignores the drawing, checks the plan (missing ids, bad numbers) and says what changed; undo goes back. Not tried yet with Claude / ChatGPT / Gemini.



- we need to be able to see the window and door distance from the wholes.... kind of the same way as wall which are not connected. I am just worried that there is too much number.... maybe we would need a toggle... and also when toggle is off, if we put the more over a wall between 2 window or between a window and wall, ... it would show the value.