// Run with: node prisma/seed.js
require("dotenv").config({ path: ".env.local" });

const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

// Match exactly how lib/db.ts initializes the client
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  const email = "admin@gmail.com";
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists. Skipping.`);
    return;
  }

  const hash = await bcrypt.hash("adminpassword123", 12);
  const user = await db.user.create({
    data: {
      name: "Admin",
      email,
      passwordHash: hash,
      role: "ADMIN",
    },
  });
  console.log(`✅ Admin user created: ${user.email}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
