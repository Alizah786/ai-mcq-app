# AI MCQ Web Application – Implementation Plan

This plan maps the approved requirements to the existing codebase and implementation steps.

---

## 1. Application Overview

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| AI-powered MCQ generation and assessment | Planned | Backend AI service + quiz/attempt APIs |
| Role-based: Teacher and Student | Planned | `Users.Role`, JWT payload, route guards |
| Google Classroom–style UI | Exists | `AppLayout` + `Sidebar` (data from API next) |
| Class-based quizzes, instant result display | Partial | Quiz page exists; backend attempts/result API needed |

---

## 2. User Roles

- **Teacher**: Create classes, generate AI MCQs, publish quizzes, review results.
- **Student**: Join classes, attempt quizzes, view results after submit.
- **Storage**: `Users.Role` = `'Teacher'` \| `'Student'` (schema already in place).

---

## 3. Login & Authentication

| Requirement | Implementation |
|-------------|----------------|
| Email + password login | POST `/api/auth/login` → validate against `Users` (hash compare). |
| Role resolved after authentication | Return `role` in JWT payload and in login response. |
| Secure token-based (JWT) | Issue JWT on login; middleware validates token and attaches `req.user` (userId, email, role). |
| Protected routes | All `/api/*` except `/api/auth/login` require `Authorization: Bearer <token>`. |

**Backend**

- Use `bcrypt` (or similar) for password hash compare; hash on register (if added).
- JWT secret from env (`JWT_SECRET`), sensible expiry (e.g. 24h).
- Middleware: decode JWT → `req.user = { userId, email, role }`; 401 if missing/invalid.

**Frontend**

- Login page: call `/api/auth/login`, store token (e.g. `localStorage`) and user (e.g. `{ userId, email, role }`).
- `http.js`: send `Authorization: Bearer <token>` on every request; redirect to `/login` on 401.
- AppLayout: allow access only when authenticated; otherwise redirect to `/login`.

---

## 4. Layout & Navigation

| Requirement | Implementation |
|-------------|----------------|
| Persistent left sidebar | Already in `AppLayout.jsx` + `Sidebar.jsx`. |
| Classes expandable to quizzes | Sidebar loads classes from API; expand/collapse per class; list quizzes per class. |
| Role-based visibility | Teacher: show "Create Class", "Create Quiz", "Generate with AI". Student: hide those. |

**API for sidebar**

- `GET /api/classes` (or `/api/me/classes`) → list classes for current user (as member), each with nested or separate list of quizzes (only published for students; draft+published for teacher in classes they own).

---

## 5. Class Management

| Requirement | Implementation |
|-------------|----------------|
| Teacher creates classes | POST `/api/classes` (Teacher only): body `{ className, subject?, gradeLevel? }`. Insert `Classes`, generate unique `JoinCode` (e.g. 8-char alphanumeric), add `ClassMembers` row (Teacher). |
| System generates join codes | On create: generate and store `JoinCode`; return in response. |
| Students join via join code | POST `/api/classes/join` (Student only): body `{ joinCode }`. Look up class by `JoinCode`, insert `ClassMembers` (Student). |

**Backend**

- `GET /api/classes` → classes where user is in `ClassMembers`, with quizzes (filter by role: student = published only).
- Auth middleware + role check for create/join.

---

## 6. Quiz Management

| Requirement | Implementation |
|-------------|----------------|
| Quizzes belong to classes | Already in schema: `Quizzes.ClassId`. |
| Draft and Published states | `Quizzes.Status` = `'Draft'` \| `'Published'`. |
| Editable before publish | PUT `/api/quizzes/:id` allowed only when `Status = 'Draft'`; allow edit title, description, and optionally questions/options (or separate endpoints). |

**Endpoints**

- `GET /api/classes/:classId/quizzes` → list quizzes (students: published only; teacher: all).
- `POST /api/classes/:classId/quizzes` (Teacher) → create quiz (Draft), body e.g. `{ title, description? }`.
- `PUT /api/quizzes/:quizId` (Teacher) → update draft quiz (title, description; questions/options as needed).
- `POST /api/quizzes/:quizId/publish` (Teacher) → set `Status = 'Published'`, set `PublishedAtUtc`.

---

## 7. MCQ Quiz Page

| Requirement | Implementation |
|-------------|----------------|
| Radio button MCQs | Already in `Quiz.jsx` (radio per question). |
| Submit button at bottom | Exists. |
| No correct answers before submit | Backend must never return `correctOptionId` or `IsCorrect` in quiz/attempt payloads until after submit. Return only `optionId`, `label`, `text`. |

**Backend**

- `POST /api/quizzes/:quizId/attempts/start` → create `Attempts` row (InProgress), return quiz with questions and options **without** correct-answer fields. Frontend already expects `quiz.questions[].options[]` with `optionId`, `label`, `text`.
- `POST /api/attempts/:attemptId/submit` → accept `answers[]` (questionId, selectedOptionId), write `AttemptAnswers`, set attempt `SubmittedAtUtc`, `Status = 'Submitted'`, compute and insert `Marks`. Return success.
- `GET /api/attempts/:attemptId/result` → return score + per-question detail including **correctOptionId**, **selectedOptionId**, **explanation** (for display). Only allowed for submitted attempts and only for the attempt owner (or teacher).

---

## 8. Result Display Logic

| Requirement | Implementation |
|-------------|----------------|
| Results on same page | Current Quiz page already stays on same page and shows result. |
| Correct answers green, wrong selected red | Already in `getOptionStyle` / `renderBadge`. |
| Explanations if available | Already in Quiz page when `detail.explanation` exists. |

Backend must return in result API: `score`, `total`, `scorePercent`, `details[]` with `questionId`, `correctOptionId`, `selectedOptionId`, `explanation`.

---

## 9. Data & Security

| Requirement | Implementation |
|-------------|----------------|
| Correct answers hidden until submit | All quiz/attempt GET responses for "taking quiz" must exclude `IsCorrect` and must not send correct option id; result only after submit. |
| Server-side result calculation | In submit handler: compare `SelectedOptionId` to option where `IsCorrect = 1`, compute score, write `Marks`. |
| Role-based authorization | Middleware: require Teacher for create class, create/publish quiz, trigger AI; require Student for join class, start attempt. |

---

## 10. Non-Functional Requirements

- **Responsive UI**: Use existing layout; add responsive breakpoints if needed.
- **Fast performance**: Indexes already in schema; keep queries simple; optional caching later.
- **Scalable architecture**: Stateless API; DB connection pooling already via tedious (per-request connection in current db.js; can add pool later).

---

## 11. AI Instructions & Prompt Specification (MANDATORY)

| Rule | Implementation |
|------|----------------|
| AI triggered ONLY by Teacher | Middleware: allow AI endpoint only when `req.user.role === 'Teacher'`. |
| AI outputs STRICT JSON only | Prompt instructs "output only valid JSON, no markdown, no extra text"; parse with `JSON.parse`; on failure treat as invalid. |
| Each question exactly 4 options | Validate parsed JSON: every question has `options` length 4. |
| Only ONE correct per question | Validate: exactly one option has `correctLabel` matching. |
| No repeated/ambiguous questions | Prompt text; optional duplicate check in validation. |
| Difficulty matches requested level | Include in prompt; validate parsed `difficulty` against request. |
| Correct answers not obvious | Prompt instruction. |
| Explanation null if not requested | If `includeExplanation: false`, validate explanations are null. |
| Invalid output → regenerate | On validation failure, retry generation (see retries). |
| Max 3 regeneration attempts | Loop up to 3 times (initial + 2 retries); then return 500 or structured error. |
| Log all AI requests/responses | Table or file log: timestamp, userId, request params, raw response, validation result. |
| Correct answers never to frontend before submit | AI response is used only server-side to insert into `Questions` + `Options`; never sent to client in quiz-taking payloads. |

---

## 12. AI Output JSON Contract

Server-side validation and DB mapping:

- `quizTitle` → `Quizzes.Title`
- `subject` → store if needed (e.g. on Class or Quiz metadata)
- `gradeLevel` → store if needed
- `difficulty` → `Questions.Difficulty` (Easy | Medium | Hard)
- `questions[]`:
  - `questionText` → `Questions.QuestionText`
  - `options[]` with labels A–D → `Options.OptionLabel`, `OptionText`
  - `correctLabel` (A|B|C|D) → set `Options.IsCorrect = 1` for that option only
  - `explanation` → `Questions.Explanation` (string or null)
  - `topicTag` → `Questions.TopicTag`

---

## Implementation Order

1. **Backend: Auth** – Login (email/password + bcrypt), JWT issue, auth middleware, role on `req.user`.
2. **Backend: Core APIs** – Classes (CRUD + join), Quizzes (CRUD + publish), Attempts (start, submit, result). Enforce: no correct answers in start/quiz payloads; result only after submit.
3. **Backend: AI service** – Prompt builder, HTTP call to OpenAI (or configured provider), strict JSON parse, validator (4 options, one correct, difficulty, etc.), max 3 retries, logging, Teacher-only route. Persist to `Quizzes`/`Questions`/`Options`.
4. **Frontend: Auth** – Login form → call login API, store token and user; http.js attach token; 401 → redirect to login; AppLayout guard.
5. **Frontend: Sidebar & role** – Load classes (and quizzes) from API; expand/collapse; show Create Class / Create Quiz / Generate AI only for Teacher.
6. **Frontend: Class/Quiz flows** – Create class, join class (Student), create quiz, edit draft, publish; "Generate with AI" opens modal/page with subject, grade, difficulty, count → call AI API → redirect to quiz or quiz list.
7. **Frontend: Quiz taking** – Already in place; ensure API contract matches (start returns no correct; result returns details with correctOptionId, explanation).
8. **Polish** – Error messages, loading states, responsive tweaks.

---

## Files to Add/Change (Summary)

**Backend**

- `backend/.env` – `JWT_SECRET`, `OPENAI_API_KEY` (or similar), existing DB vars.
- `backend/auth.js` – login handler, JWT sign, optional register; middleware `requireAuth`, `requireRole('Teacher')`.
- `backend/routes/` or inline in `index.js` – auth, classes, quizzes, attempts (start, submit, result).
- `backend/ai/` or `backend/services/ai.js` – prompt, call AI, parse JSON, validate, retry, log, save to DB.

**Frontend**

- `frontend/mcq-ui/src/api/http.js` – add `Authorization: Bearer <token>`, 401 → redirect to login.
- `frontend/mcq-ui/src/context/AuthContext.jsx` (or similar) – hold user + token, login/logout.
- `frontend/mcq-ui/src/pages/Login.jsx` – call login API, on success save token/user and navigate to dashboard.
- `frontend/mcq-ui/src/layout/AppLayout.jsx` – require auth; redirect to login if no token.
- `frontend/mcq-ui/src/components/Sidebar.jsx` – fetch classes (+ quizzes), role-based buttons, expand/collapse.
- New pages/modals: Create Class, Join Class (Student), Create Quiz, Edit Quiz (draft), Generate with AI (Teacher).
- Dashboard – optional; show recent classes or instructions.

**DB**

- Existing schema is sufficient. Optional: `AiRequestLog` table for AI request/response logging (or use file log).

This plan is intended for direct implementation and aligns with the approved Google Classroom–style UI and the mandatory AI and security requirements.
