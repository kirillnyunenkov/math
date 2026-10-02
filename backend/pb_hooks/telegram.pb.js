/// <reference path="../pb_data/types.d.ts" />
// Telegram bot: registration and sign-in links. Logic lives in tg.js because
// PocketBase runs every handler in an isolated scope.
routerAdd("POST", "/api/tg/webhook", (e) => require(`${__hooks}/tg.js`).webhook(e));
routerAdd("GET", "/api/ege/leads", (e) => require(`${__hooks}/tg.js`).leads(e));
