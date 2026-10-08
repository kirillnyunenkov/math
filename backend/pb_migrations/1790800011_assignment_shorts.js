/// <reference path="../pb_data/types.d.ts" />
// exam_assignments.shorts: the numbers of the short-answer tasks of the assigned exam, kept on the row so that the
// autosave route does not have to load and parse the whole exam (with its pictures) on every request.
migrate((app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.add(new JSONField({ name: "shorts", maxSize: 2000 }));
  app.save(asg);
  const rows = app.findAllRecords("exam_assignments"), cache = {};   // exam id -> its short numbers: each exam is parsed once
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], eid = r.getString("exam");
    if (!(eid in cache)) {
      let tasks = [];
      // a json field comes out of getString as text, same as J() in pb_hooks/exams.js
      try { tasks = JSON.parse(app.findRecordById("exams", eid).getString("tasks")) || []; } catch (_) {}
      const shorts = [];
      for (let j = 0; j < tasks.length; j++) if (tasks[j] && tasks[j].kind === "short") shorts.push(String(tasks[j].n));
      cache[eid] = shorts;
    }
    r.set("shorts", cache[eid]);
    app.saveNoValidate(r);   // the value is computed here; validation could only make a live startup fail
  }
}, (app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.removeByName("shorts");
  app.save(asg);
});
