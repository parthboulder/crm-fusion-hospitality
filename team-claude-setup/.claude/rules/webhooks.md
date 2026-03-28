---
globs: ["execution/modal_webhook.py", "execution/webhooks.json", "directives/add_webhook.md", "directives/*webhook*"]
---

# Webhook Rules

- Never modify `execution/modal_webhook.py` unless absolutely necessary — it's shared infrastructure
- When adding a webhook, always follow the full flow in `directives/add_webhook.md`
- Every webhook must have a corresponding directive file in `directives/`
- Every webhook must have an entry in `execution/webhooks.json`
- After adding or modifying a webhook, deploy with `modal deploy execution/modal_webhook.py`
- Test the endpoint after deployment — don't assume it works
- Webhook tool access is scoped: only `send_email`, `read_sheet`, `update_sheet` are available
- Never expose secrets in webhook responses or Slack messages
