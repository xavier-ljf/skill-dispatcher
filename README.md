# skill-dispatcher

Interactive CLI for linking a local inventory of Agent skills into any target project.

The tool expects skills to live beside the CLI under:

```text
inventory/.agents/skills/
```

When it runs, it opens a terminal UI, lets you select one or more skills, asks for a destination path (defaulting to `<cwd>/.agents/skills/`), then creates links directly under the entered path.

## Behavior

- Each direct child directory in `.agents/skills/` is treated as one skill.
- Selected skills are linked into the destination project.
- Existing matching links are skipped.
- Existing non-matching files, directories, or links are reported as conflicts and are not overwritten.
- If one skill fails to link, the tool continues with the remaining selected skills and reports a final summary.

## Skills Lock File

Adding skills with [`npx skills add`](https://github.com/vercel-labs/skills) command populates `skills-lock.json`, recording each skill's source.

Example of populating the inventory:

```shell
cd inventory
npx skills add https://github.com/anthropics/skills -a universal -y --skill frontend-design
npx skills add obra/superpowers -a universal -y
```

When the lock file is present, skills in the selection list are grouped under their `source` (e.g. `owner/repo`). When the lock file is absent, the list falls back to a flat alphabetical view.

## Platform Links

- Windows: creates NTFS junctions with `fs.symlink(source, target, "junction")`.
- macOS and other non-Windows platforms: creates directory symlinks with `fs.symlink(source, target, "dir")`.

The tool never copies skill directories.

## Usage

```shell
npm install && npm run build && npm link
```

Then run `skill-dispatcher` from any project.
