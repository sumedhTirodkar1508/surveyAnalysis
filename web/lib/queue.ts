import { PgBoss } from "pg-boss";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing — pg-boss cannot start");
}

const boss = new PgBoss(process.env.DATABASE_URL);

let started = false;

export async function enqueueJob(name: string, data: object | null): Promise<string | null> {
  if (!started) {
    await boss.start();
    started = true;
  }

  // pg-boss v10+ auto-creates the queue with all required defaults on first send()
  return boss.send(name, data);
}
