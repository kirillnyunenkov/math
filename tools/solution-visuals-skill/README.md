# solution-visuals skill

`SKILL.md` is the tracked source of the Claude Code skill for adding figures, diagrams and tables
to the trainer's solutions. `.claude/` is git-ignored, so the skill is installed by copying it.

Install (run in the owner's checkout, repo root):

```bash
mkdir -p .claude/skills/solution-visuals && cp tools/solution-visuals-skill/SKILL.md .claude/skills/solution-visuals/
```

Re-run the same command after the skill changes in the repository.
