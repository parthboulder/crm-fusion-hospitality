# Security Protocol — docs/security.md

> Referenced on demand via `@docs/security.md`.
> Covers secrets management, API safety, and hardening for this stack.

## 1. Secrets & Credentials

### Files That Must NEVER Be Read, Logged, or Committed

| File | Contains | Location |
|------|----------|----------|
| `.env` | API keys, tokens, connection strings | Project root |
| `credentials.json` | Google OAuth client credentials | Project root |
| `token.json` | Google OAuth access/refresh tokens | Project root |
| `service-account*.json` | GCP service account keys | Project root |

### Rules

- All secrets live in `.env` and are loaded via `os.getenv()` in Python scripts
- Never print, log, or include secrets in error messages or Slack notifications
- Never commit any of the files above — they must be in `.gitignore`
- If a secret is accidentally logged or committed, rotate it immediately
- Never pass secrets as command-line arguments (visible in process lists)

### .gitignore Essentials

```
.env
.env.*
credentials.json
token.json
service-account*.json
*.pem
*.key
*.p12
.tmp/
__pycache__/
*.pyc
```

### .env Structure

```bash
# Copy to .env and fill in — NEVER commit this file
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SHEETS_CREDENTIALS_PATH=credentials.json
MODAL_TOKEN_ID=...
MODAL_TOKEN_SECRET=...
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

## 2. Google OAuth Security

- `credentials.json` contains your OAuth client ID/secret — treat as a private key
- `token.json` contains access and refresh tokens — if leaked, attacker has full access to your Google account scopes
- Never log the contents of either file
- If `token.json` is compromised: revoke the token in Google Cloud Console → OAuth consent screen → Revoke all tokens, then delete `token.json` and re-authenticate
- Scope OAuth to minimum required permissions (Sheets, Slides, Drive — not "all Google services")

## 3. Modal Webhook Security

- Webhook endpoints are public URLs — anyone with the URL can trigger them
- Never return sensitive data in webhook responses
- Never include secrets in Slack notification payloads
- Keep webhook tool access scoped: `send_email`, `read_sheet`, `update_sheet` only
- Monitor webhook execution via Slack stream for anomalies
- If a webhook URL is leaked, redeploy with a new slug: update `webhooks.json`, redeploy, update any callers

## 4. API Key Safety in Scripts

```python
# GOOD: Read from environment
import os
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise ValueError("OPENAI_API_KEY not set in environment")

# BAD: Hardcoded
api_key = "sk-abc123..."  # NEVER DO THIS

# BAD: Logged
print(f"Using key: {api_key}")  # NEVER DO THIS
logger.info(f"API key: {api_key}")  # NEVER DO THIS

# GOOD: Safe logging
logger.info("OpenAI API call initiated", extra={"model": "gpt-4", "tokens": 500})
```

## 5. Paid API Safeguards

Scripts that call paid APIs (OpenAI, Anthropic, Google) need guardrails:

- Add a `--dry-run` flag or confirmation prompt before execution
- Log estimated cost before running batch operations
- Set token/request limits in the script, not just in the API dashboard
- If a script loops over API calls, add rate limiting and a kill switch
- After hitting a rate limit, update the directive with the limit details

## 6. .tmp/ Directory

- All intermediate files go in `.tmp/` — scraped data, exports, processing artifacts
- Never commit `.tmp/` contents
- Everything in `.tmp/` should be regenerable from scripts
- Don't store secrets or credentials in `.tmp/` files
- Clean up `.tmp/` periodically — stale data can be confusing

## 7. Claude Code Hardening

The `.claude/settings.json` in this project blocks:
- Reading `.env`, `credentials.json`, `token.json`, and any `*secret*` files
- Writing to `.env` or credential files
- Network commands (`curl`, `wget`, `ssh`, `scp`, `nc`)
- Echoing environment variables containing TOKEN, SECRET, KEY, or PASSWORD
- Destructive commands (`rm -rf`, `sudo`)

If Claude needs information from `.env` to understand the project, tell it what variables exist (names only) — never the values.

## 8. Incident Response

If a secret is exposed (in a commit, log, Slack message, or error output):

1. **Rotate immediately** — generate new keys/tokens for the affected service
2. **Revoke the old credential** — don't just replace it, kill the old one
3. **Check access logs** — look for unauthorized usage between exposure and rotation
4. **Clean the exposure** — if committed to git, use `git filter-branch` or BFG Repo-Cleaner
5. **Update the directive** — document what happened and how to prevent it

### Rotation Quick Reference

| Secret | Where to Rotate |
|--------|----------------|
| OpenAI API key | platform.openai.com → API keys |
| Anthropic API key | console.anthropic.com → API keys |
| Google OAuth tokens | Delete `token.json`, re-authenticate |
| Google OAuth credentials | Google Cloud Console → Credentials → Reset secret |
| Modal tokens | modal.com → Settings → Tokens |
| Slack webhook URL | api.slack.com → Your Apps → Incoming Webhooks → Regenerate |
