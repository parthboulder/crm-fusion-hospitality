# Claude Code Setup Guide

5-minute setup. Adds security rules and project intelligence to Claude Code. Works in VS Code or Antigravity.

---

## What's in the zip

```
CLAUDE.md                  ← Project brain (3-layer architecture)
.claude/
  settings.json            ← Blocks Claude from reading secrets
  rules/
    execution.md           ← Rules for execution/ scripts
    directives.md          ← Rules for directives/ SOPs
    webhooks.md            ← Rules for webhook files
docs/
  security.md              ← Full security protocol
global-CLAUDE.md           ← Global rules (goes in your home directory, not the project)
```

---

## VS Code Setup

### 1. Add files to the project

1. Open the project in VS Code
2. Unzip `team-claude-setup.zip` on your computer
3. Drag `CLAUDE.md` into the project root in VS Code's sidebar (replace if one exists)
4. Right-click the project root → New Folder → name it `.claude`
5. Open `.claude` → right-click → New Folder → name it `rules`
6. Drag `settings.json` into `.claude/`
7. Drag `execution.md`, `directives.md`, `webhooks.md` into `.claude/rules/`
8. If there's no `docs/` folder, right-click project root → New Folder → `docs`
9. Drag `security.md` into `docs/`

### 2. Set up global rules (one-time, all projects)

Open a terminal in VS Code (Ctrl+` or Cmd+`):

**Mac/Linux:**
```bash
mkdir -p ~/.claude
cp /path/to/unzipped/global-CLAUDE.md ~/.claude/CLAUDE.md
```

**Windows:**
```powershell
mkdir -Force ~\.claude
copy "C:\path\to\unzipped\global-CLAUDE.md" "$HOME\.claude\CLAUDE.md"
```

If mkdir says "already exists" — that's fine, just run the copy.

### 3. Test it

Open Claude Code in VS Code and type:

```
cat .env
```

If Claude refuses, you're done.

---

## Antigravity Setup

### 1. Add files to the project

1. Open the project in Antigravity
2. Unzip `team-claude-setup.zip` on your computer
3. Drag `CLAUDE.md` into the project root in Antigravity's sidebar (replace if one exists)
4. Right-click the project root → New Folder → name it `.claude`
5. Open `.claude` → right-click → New Folder → name it `rules`
6. Drag `settings.json` into `.claude/`
7. Drag `execution.md`, `directives.md`, `webhooks.md` into `.claude/rules/`
8. If there's no `docs/` folder, right-click project root → New Folder → `docs`
9. Drag `security.md` into `docs/`

### 2. Set up global rules (one-time, all projects)

Open a terminal in Antigravity (Ctrl+` or Cmd+`):

**Mac/Linux:**
```bash
mkdir -p ~/.claude
cp /path/to/unzipped/global-CLAUDE.md ~/.claude/CLAUDE.md
```

**Windows:**
```powershell
mkdir -Force ~\.claude
copy "C:\path\to\unzipped\global-CLAUDE.md" "$HOME\.claude\CLAUDE.md"
```

If mkdir says "already exists" — that's fine, just run the copy.

### 3. Test it

Open a Claude Code window in Antigravity and type:

```
cat .env
```

If Claude refuses, you're done.

---

## Rules

- Don't delete or edit `settings.json` — it's the security firewall
- Don't commit `.env`, `credentials.json`, or `token.json`
- Don't tell Claude to ignore the security rules
- Don't put secrets in directives or docs

## Troubleshooting

If `cat .env` isn't blocked, check:

1. Is `CLAUDE.md` in the project root?
2. Is `.claude/settings.json` in the project root (not nested inside another folder)?
3. Are the three `.md` files inside `.claude/rules/` (not loose in `.claude/`)?
4. Is `docs/security.md` in the project's `docs/` folder?
5. Did you copy `global-CLAUDE.md` to `~/.claude/CLAUDE.md`?

If all five are yes, restart Claude Code (close and reopen the session).
