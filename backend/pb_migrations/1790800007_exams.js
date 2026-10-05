/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams: the teacher's own exams, opened to one student for a
// fixed time window. Students never read these collections directly — only
// through the routes in pb_hooks/exams.js, which decide by the server clock
// what may be shown. `users` is deliberately not touched.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const teacher = '@request.auth.role = "teacher"';
  const own = 'user = @request.auth.id || @request.auth.role = "teacher"';
  const userRel = { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true };
  const created = { type: "autodate", name: "created", onCreate: true, onUpdate: false };
  const num = (name) => ({ type: "number", name, onlyInt: true });   // unix seconds, 0 = not set

  const exams = new Collection({
    type: "base", name: "exams",
    listRule: teacher, viewRule: teacher, createRule: teacher, updateRule: teacher, deleteRule: teacher,
    fields: [
      { type: "text", name: "title", required: true, max: 120 },
      { type: "bool", name: "full" },                              // a full variant: show the test score
      { type: "json", name: "tasks", required: true, maxSize: 5000000 },
      { type: "json", name: "key", required: true, maxSize: 2000000 },
      created,
    ],
  });
  app.save(exams);

  const assignments = new Collection({
    type: "base", name: "exam_assignments",
    listRule: teacher, viewRule: teacher, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      userRel,
      // no cascade: an exam that was assigned cannot be deleted by accident
      { type: "relation", name: "exam", required: true, collectionId: exams.id, maxSelect: 1, cascadeDelete: false },
      { ...num("start"), required: true }, { ...num("duration"), required: true },
      num("opened"), num("finished"), num("photos_done"), num("settled"), num("checked"),
      num("p1"), { type: "bool", name: "via_tg" },
      { type: "json", name: "answers", maxSize: 20000 },
      { type: "json", name: "ok", maxSize: 20000 },
      { type: "json", name: "part2", maxSize: 100000 },
      { type: "json", name: "log", maxSize: 400000 },
      num("m_hour"), num("m_open"),                                // bot messages already sent
      created,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_exas_user_exam ON exam_assignments (user, exam)",
      "CREATE INDEX idx_exas_start ON exam_assignments (start)",
    ],
  });
  app.save(assignments);

  app.save(new Collection({
    type: "base", name: "exam_photos",
    listRule: own, viewRule: own, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      userRel,
      { type: "relation", name: "assignment", required: true, collectionId: assignments.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "n", required: true, max: 8 },
      { type: "file", name: "file", required: true, maxSelect: 1, maxSize: 10485760, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      created,
    ],
    indexes: ["CREATE INDEX idx_exph_assignment ON exam_photos (assignment, n)"],
  }));
}, (app) => {
  for (const c of ["exam_photos", "exam_assignments", "exams"]) app.delete(app.findCollectionByNameOrId(c));
});
