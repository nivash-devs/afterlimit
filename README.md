# afterlimit

Your AI hit its limit. Your work didn't.

`afterlimit` lets you switch between Claude Code and Codex mid-task without re-explaining your project. Both agents keep one shared handoff note up to date while they work. When one runs out of usage, a single command starts the other with that note, so it picks up at the next step instead of from zero.

```bash
npx afterlimit init
```

## How it works

`init` creates `HANDOFF.md` and adds a short instruction block to `CLAUDE.md` and `AGENTS.md`, the files Claude Code and Codex read when they start. From then on, each agent updates the note after every meaningful step.

The note has nine sections. Two of them are what other switchers miss:

- **Tried and failed.** Approaches that didn't work and why, so the next agent doesn't retry them.
- **Decisions.** Choices made and the reason for each, so the next agent doesn't undo them.

The rest are Goal, Current state, Done so far, Open questions, Next step, Files and Commands.

## Commands

```bash
npx afterlimit init          # create HANDOFF.md and set up both agents
npx afterlimit check         # see which sections are filled
npx afterlimit request       # print a prompt that makes the current agent write the note
npx afterlimit to codex      # start Codex with the handoff
npx afterlimit to claude     # start Claude Code with the handoff
```

`to` options:

- `--print` prints the pickup prompt instead of starting the agent, so you can paste it into a chat app.
- `--strict` stops if any section of the note is missing.

## Notes

- Runs only on your machine. Nothing is uploaded anywhere.
- It starts the official `claude` and `codex` commands with a first message. It never touches your login or tokens.
- Needs Node 18 or newer, and whichever agent you switch to installed.

## License

MIT
