# ui-build · mode: compose

Loaded on demand from `../SKILL.md` → *Modes*.

- **When:** the screen can be assembled mostly from existing components (library or shared layer) with little or no new styling.
- **Steps:**
  1. Map each region of the requested screen to an existing component; list the gaps.
  2. For each gap prefer, in order: a prop/variant of an existing component, composition of two existing ones, a new component placed where the repo puts that kind of piece (`memory.md` → Architecture, `W convention`: a shared library or the feature; the scope rule only as "profile default" when the repo shows none).
  3. Lay out with the project's grid and spacing tokens; keep the page rhythm of sibling screens (header pattern, toolbar placement, content width).
  4. Wire data and all states as in build steps 7–9.
  5. Verify visually against one sibling screen side by side.
- **Output:** component map (reused vs new), files created, gaps proposed for the shared layer.
