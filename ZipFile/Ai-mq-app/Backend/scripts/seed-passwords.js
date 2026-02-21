/**
 * One-time script to set bcrypt password hashes for seed users so you can log in.
 * Run from backend folder: node scripts/seed-passwords.js
 *
 * Default passwords (change in production):
 *   teacher1@example.com  -> Teacher1!
 *   teacher2@example.com -> Teacher2!
 *   student1@example.com -> Student1!
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcrypt");
const { execQuery } = require("../db");
const { TYPES } = require("tedious");

const USERS = [
  { email: "teacher1@example.com", password: "Teacher1!" },
  { email: "teacher2@example.com", password: "Teacher2!" },
  { email: "student1@example.com", password: "Student1!" },
];

async function main() {
  for (const { email, password } of USERS) {
    const hash = await bcrypt.hash(password, 10);
    await execQuery(
      "UPDATE dbo.Users SET PasswordHash = @hash WHERE Email = @email",
      [
        { name: "hash", type: TYPES.NVarChar, value: hash },
        { name: "email", type: TYPES.NVarChar, value: email },
      ]
    );
    console.log("Updated password for", email);
  }
  console.log("Done. Log in with e.g. teacher2@example.com / Teacher2!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
