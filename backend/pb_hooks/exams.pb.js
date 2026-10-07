/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams. Logic lives in exams.js because PocketBase runs every
// handler in an isolated scope.
routerAdd("POST", "/api/ege/exams/assign", (e) => require(`${__hooks}/exams.js`).assign(e));
routerAdd("GET", "/api/ege/exams/mine", (e) => require(`${__hooks}/exams.js`).mine(e));
routerAdd("GET", "/api/ege/exams/summary", (e) => require(`${__hooks}/exams.js`).summary(e));
routerAdd("POST", "/api/ege/exams/history", (e) => require(`${__hooks}/exams.js`).histAdd(e));
routerAdd("GET", "/api/ege/exams/history", (e) => require(`${__hooks}/exams.js`).histList(e));
routerAdd("DELETE", "/api/ege/exams/history/{id}", (e) => require(`${__hooks}/exams.js`).histDel(e));
routerAdd("GET", "/api/ege/exams/{id}", (e) => require(`${__hooks}/exams.js`).get(e));
routerAdd("POST", "/api/ege/exams/{id}/move", (e) => require(`${__hooks}/exams.js`).move(e));
routerAdd("POST", "/api/ege/exams/{id}/cancel", (e) => require(`${__hooks}/exams.js`).cancel(e));
routerAdd("POST", "/api/ege/exams/{id}/answers", (e) => require(`${__hooks}/exams.js`).answers(e));
routerAdd("POST", "/api/ege/exams/{id}/away", (e) => require(`${__hooks}/exams.js`).away(e));
routerAdd("POST", "/api/ege/exams/{id}/finish", (e) => require(`${__hooks}/exams.js`).finish(e));
routerAdd("POST", "/api/ege/exams/{id}/done", (e) => require(`${__hooks}/exams.js`).done(e));
routerAdd("POST", "/api/ege/exams/{id}/via-tg", (e) => require(`${__hooks}/exams.js`).viaTg(e));
routerAdd("GET", "/api/ege/exams/{id}/photos", (e) => require(`${__hooks}/exams.js`).photoList(e));
routerAdd("POST", "/api/ege/exams/{id}/photos", (e) => require(`${__hooks}/exams.js`).addPhoto(e));
routerAdd("DELETE", "/api/ege/exams/{id}/photos/{pid}", (e) => require(`${__hooks}/exams.js`).delPhoto(e));
routerAdd("POST", "/api/ege/exams/{id}/check", (e) => require(`${__hooks}/exams.js`).check(e));
// The same work the cron does, callable on demand (tests, a manual kick).
routerAdd("POST", "/api/ege/exams/tick", (e) => {
  if (!e.hasSuperuserAuth()) return e.json(403, { message: "forbidden" });
  require(`${__hooks}/exams.js`).tick();
  return e.json(200, { ok: true });
});
cronAdd("exams-tick", "* * * * *", () => require(`${__hooks}/exams.js`).tick());
