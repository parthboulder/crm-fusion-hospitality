---
globs: ["execution/**/*.py", "execution/**"]
---

# Execution Layer Rules

These are deterministic scripts. Treat them differently than orchestration work.

- Never hardcode API keys, tokens, or secrets — always read from environment variables via `os.getenv()`
- Never `print()` secrets, tokens, or credentials — not even for debugging
- Always include error handling with specific exceptions — no bare `except:` blocks
- Log errors with enough context to debug (function name, input shape, status code) but never log sensitive data
- If a script calls a paid API (OpenAI, Anthropic, Google, etc.), add a confirmation check or dry-run mode before executing
- Include a docstring at the top of every script explaining: what it does, what inputs it expects, what it outputs
- Keep scripts single-purpose — one script does one thing
- If a script is growing past 150 lines, split it into functions or separate scripts
- Always use `if __name__ == "__main__":` for scripts that should be runnable standalone
- Test scripts with sample/mock data before running against production APIs
- When modifying an existing script, run it after changes to verify it still works
