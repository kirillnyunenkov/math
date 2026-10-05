/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams. Logic lives in exams.js because PocketBase runs every
// handler in an isolated scope.
routerAdd("POST", "/api/ege/exams/assign", (e) => require(`${__hooks}/exams.js`).assign(e));
routerAdd("POST", "/api/ege/exams/{id}/move", (e) => require(`${__hooks}/exams.js`).move(e));
routerAdd("POST", "/api/ege/exams/{id}/cancel", (e) => require(`${__hooks}/exams.js`).cancel(e));
