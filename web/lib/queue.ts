const PgBoss = require("pg-boss");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const boss = new PgBoss(connectionString);

let started = false;

export async function enqueueJob(name: string, data: any) {
  if (!started) {
    await boss.start();
    started = true;
  }
  const jobId = await boss.send(name, data);
  return jobId;
}
