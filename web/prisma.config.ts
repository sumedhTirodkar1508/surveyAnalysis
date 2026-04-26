import { defineConfig } from "prisma/config";
import { config } from "dotenv";
import { resolve } from "path";

// Prisma CLI does not load .env.local automatically — load it explicitly
config({ path: resolve(__dirname, ".env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
