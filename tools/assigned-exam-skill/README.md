# assigned-exam skill

`SKILL.md` is the tracked source of the Claude Code skill for preparing, uploading and assigning
own mock exams. `.claude/` is git-ignored, so the skill is installed by copying it.

Install (run in the owner's checkout, repo root):

```bash
mkdir -p .claude/skills/assigned-exam && cp tools/assigned-exam-skill/SKILL.md .claude/skills/assigned-exam/
```

Re-run the same command after the skill changes in the repository.
