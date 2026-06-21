# skill-dispatcher

Interactive CLI for linking a local inventory of Agent skills into any target project.

The tool expects skills to live beside the CLI under:

```text
inventory/.agents/skills/
```

When it runs, it opens a terminal UI, lets you select one or more skills, asks for a destination path, then creates links under:

```text
<destination>/.agents/skills/
```

## Behavior

- Each direct child directory in `.agents/skills/` is treated as one skill.
- Selected skills are linked into the destination project.
- Existing matching links are skipped.
- Existing non-matching files, directories, or links are reported as conflicts and are not overwritten.
- If one skill fails to link, the tool continues with the remaining selected skills and reports a final summary.

## Platform Links

- Windows: creates NTFS junctions with `fs.symlink(source, target, "junction")`.
- macOS and other non-Windows platforms: creates directory symlinks with `fs.symlink(source, target, "dir")`.

The tool never copies skill directories.

## Development

Install dependencies:

```powershell
npm install
```

Run in development mode:

```powershell
npm run dev
```

Build:

```powershell
npm run build
```

Run the built CLI:

```powershell
node dist/skill-dispatcher.js
```

Run tests:

```powershell
npm test
```

## Project Layout

```text
src/
  skill-dispatcher.tsx   Single-file CLI: skill discovery, linking, and Ink TUI
```

## Local Skill Inventory

The repository keeps `.agents/skills/.gitkeep` so the expected inventory directory exists. Actual skill directories under `.agents/skills/` are ignored by Git, so you can keep a local skill collection there without committing it.
