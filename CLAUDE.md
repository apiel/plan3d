# plan3d: context for Claude

Floor-plan app, started 2026-10-26 in a session inside the sibling repo plinth3d. Read README.md (idea, run, code map) and TODO.md (status, next steps) first.

Key decisions so far:
- Separate repo from plinth3d on purpose: different product. Same stack though (TypeScript, Vite 5, vitest; the user's Node is 18, so do not use Vite 6+). The editor is vanilla canvas, not React yet.
- Static site on GitHub Pages, no backend. Plans stay local (localStorage / JSON export). Never put real plans in a public repo.
- Capture target is the user's Pixel 9a (no LiDAR). WebXR depth-sensing works there. The user does not want to buy an iPhone or complicated hardware, so keep capture simple. Depth is a rough first pass; accuracy comes from manual measurements via the least-squares solver in `src/solver.ts`.
- The user is not a professional (renovating their own house and flat in spare time), prefers simple solutions, and tests on the phone over `chrome://flags` insecure-origin flag or USB `adb reverse`.
- The user explicitly does NOT want a manual workflow (tapping corners, drawing): the point of the app is automatic mapping from the phone camera, with manual measurements only to refine. Manual drawing exists in the editor as a secondary tool. Do not steer the capture back to tap-based.
- The scan pipeline (`src/scan.ts`, `src/scan/extract.ts`) was written and tested against synthetic rooms only, in a session without access to the phone. Expect real-data problems; the first job is to try it on the Pixel.
- Real scan data: the user can download raw keyframes from the editor after a scan ("Download last scan data") and replay them with `npm run replay -- file.json` (writes an SVG). Ask for such a file when debugging scan quality instead of guessing.
- End goal includes furniture in the plan (detected boxes exist; editing them is basic).
- Python is not needed for anything; use `npm run dev`.
