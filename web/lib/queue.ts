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

  // Ensure the queue metadata exists in the pgboss.queue table.
  // This is required when the consumer is a non-SDK poller (like our Python worker)
  // because send() may fail if it doesn't find the queue definition.
  try {
    await boss.createQueue(name);
  } catch (e) {
    // Ignore error if queue already exists
  }

  return boss.send(name, data);
}
