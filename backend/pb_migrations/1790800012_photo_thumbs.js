/// <reference path="../pb_data/types.d.ts" />
// Photo previews: the file fields of exam_photos and exam_feedback_photos list a 600 px wide thumbnail (height follows),
// which PocketBase makes on the first request with ?thumb=600x0 and keeps. Previews no longer download the full picture.
// The size must equal THUMB in exam-client-core.js and PH_THUMB in teacher.html (an unlisted size returns the original).
const COLLS = ["exam_photos", "exam_feedback_photos"];
migrate((app) => {
  for (const name of COLLS) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.getByName("file").thumbs = ["600x0"];
    app.save(c);
  }
}, (app) => {
  for (const name of COLLS) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.getByName("file").thumbs = [];
    app.save(c);
  }
});
