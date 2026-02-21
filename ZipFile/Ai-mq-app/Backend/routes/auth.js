const express = require("express");
const { z } = require("zod");
const { execQuery } = require("../db");
const { comparePassword, signToken, requireAuth } = require("../auth");
const { TYPES } = require("tedious");

const router = express.Router();

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** POST /api/auth/login - returns { token, user: { userId, email, displayName, role } } */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = LoginBody.parse(req.body);
    const r = await execQuery(
      "SELECT UserId, Email, DisplayName, PasswordHash, Role FROM dbo.Users WHERE Email = @email AND IsActive = 1",
      [{ name: "email", type: TYPES.NVarChar, value: email }]
    );
    if (!r.rows.length) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const user = r.rows[0];
    const ok = await comparePassword(password, user.PasswordHash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const token = signToken({
      userId: user.UserId,
      email: user.Email,
      role: user.Role,
      displayName: user.DisplayName,
    });
    res.json({
      token,
      user: {
        userId: user.UserId,
        email: user.Email,
        displayName: user.DisplayName,
        role: user.Role,
      },
    });
  } catch (e) {
    if (e.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: e.errors });
    }
    throw e;
  }
});

/** GET /api/auth/me - return current user (requires auth) */
router.get("/me", requireAuth, (req, res) => {
  res.json({
    userId: req.user.userId,
    email: req.user.email,
    displayName: req.user.displayName,
    role: req.user.role,
  });
});

module.exports = router;
