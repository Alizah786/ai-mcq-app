/**
 * One-time script to set bcrypt password hashes for seed users so you can log in.
 * Run from backend folder: node scripts/seed-passwords.js
 *
 * Default passwords (change in production):
 *   student1@test.com -> Student1!
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcrypt");
const { execQuery } = require("../db");
const { TYPES } = require("tedious");

const USERS = [
  { email: "student1@test.com", password: "Student1!" },
];

async function main() {
  for (const { email, password } of USERS) {
    const hash = await bcrypt.hash(password, 10);
    await execQuery(
      "UPDATE dbo.Student SET PasswordHash = @hash WHERE Email = @email",
      [
        { name: "hash", type: TYPES.NVarChar, value: hash },
        { name: "email", type: TYPES.NVarChar, value: email },
      ]
    );
    console.log("Updated password for", email);
  }
  console.log("Done. Log in with student1@test.com / Student1!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
