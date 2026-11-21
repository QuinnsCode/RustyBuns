// The server half of a Wasp app, as `wasp build` emits it: Express on node:http, Postgres from
// DATABASE_URL, listening on PORT. Nothing here knows about Rusty Buns.
import express from "express";
import pg from "pg";

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(express.urlencoded({ extended: false }));

const count = async () => (await db.query('SELECT "value" FROM "Counter" WHERE "id" = 1')).rows[0]?.value ?? 0;

app.get("/", async (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><title>express-example</title><link rel="stylesheet" href="/app.css"></head>
<body><h1 id="count">count: ${await count()}</h1>
<form method="post" action="/increment"><button>+1</button></form></body></html>`);
});

app.post("/increment", async (_req, res) => {
  await db.query('INSERT INTO "Counter" ("id", "value") VALUES (1, 1) ON CONFLICT ("id") DO UPDATE SET "value" = "Counter"."value" + 1');
  res.redirect(303, "/");
});

app.listen(Number(process.env.PORT ?? 3001), "127.0.0.1");
