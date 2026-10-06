# assigned-exam skill

`SKILL.md` is the tracked source of the Claude Code skill for preparing, uploading and assigning
own mock exams. `.claude/` is git-ignored, so the skill is installed by copying it.

Install (run in the owner's checkout, repo root):

```bash
mkdir -p .claude/skills/assigned-exam && cp tools/assigned-exam-skill/SKILL.md .claude/skills/assigned-exam/
```

Re-run the same command after the skill changes in the repository.

The folder also holds helpers the skill calls (they contain no exam content): `shkolkovo_extract.py` (dump of a saved
Школково variant), `render_svg.py` (SVG → PNG through headless Chrome) and `exam_build_lib.py` (`Exam.img/sol/short/long/write`
for a `build_exam.py` that lives next to the exam in `~/math-source/exams/<slug>/`). Run them with `/usr/bin/python3` where Pillow is needed.
