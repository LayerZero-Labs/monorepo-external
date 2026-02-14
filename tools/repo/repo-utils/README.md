# @layerzerolabs/repo-utils

Repository utilities for monorepo development.

## Commands

### `workspace-watch` - Auto Build on Changes

Watch workspace for changes and automatically run install/build commands.

```bash
pnpm --filter @layerzerolabs/repo-utils run watch
```

**What it watches:**

| File Change               | Action                                          |
| ------------------------- | ----------------------------------------------- |
| `package.json` add/change | `pnpm -w --filter <pkg> install`                |
| `package.json` delete     | `pnpm -w install`                               |
| `.ts` / `.tsx` change     | `pnpm -w --filter <pkg> run --if-present build` |

**Features:**

- **Debouncing:** Groups rapid changes to avoid redundant builds
- **Queue system:** Manages pending, running, and retry queues
- **Smart Rebuild:** Only rebuild package with changed files (not entire tree like turbo)

**Output:**

```
[watch] Workspace root: /path/to/monorepo
[watch] Watching 542 packages
[build] @layerzerolabs/vm-tooling: turbo hash 8d7a6b5c (no rebuild needed)
[build] @layerzerolabs/depcheck: success in 3.2s
```

---

## How It Works

1. **Detects changes** using file system watchers
2. **Identifies package** from file path
3. **Queues task** (install or build)
4. **Executes task** with concurrent limit
5. **Tracks success** via turbo hash to skip redundant rebuilds
6. **Retries failures** with exponential backoff

---

## Use Cases

```bash
# Development workflow - auto rebuild on save
pnpm --filter @layerzerolabs/repo-utils run watch

# Runs indefinitely, watching for changes
# Edit any .ts file → auto rebuilds that package
# Modify package.json → auto runs install
# Delete package.json → triggers workspace install
```

---

## Configuration

Default settings (hardcoded):

- **Max concurrent builds:** 3
- **Debounce delay:** 300ms
- **Retry delays:** 1s, 2s, 4s, 8s, 16s
- **Max retries:** 5

---

## Tips

- Run in a dedicated terminal
- Let it run in background during development
- Watch the logs to see what's rebuilding
- Turbo caching prevents unnecessary rebuilds
- Respects `--if-present` flag (won't fail if no build script)
