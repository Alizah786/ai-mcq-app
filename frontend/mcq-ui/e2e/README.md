# E2E Testing (Playwright)

## Install

From `frontend/mcq-ui`:

```bash
npm install
npm run test:e2e:install
```

## Run

```bash
npm run test:e2e
```

Headed mode:

```bash
npm run test:e2e:headed
```

UI mode:

```bash
npm run test:e2e:ui
```

## What this test covers

- Manager account creation (API)
- Manager creates student, class, quiz, and questions (API)
- One question is hidden for students
- Quiz is published
- Student logs in via UI
- Student opens quiz and hidden question is not visible

Additional specs:

- `hidden-question-student-visibility.spec.js`
- `disclaimer-ack-required.spec.js`
- `manager-toggle-hidden-question-ui.spec.js`

## Notes

- Playwright config starts:
  - backend on `http://127.0.0.1:4000`
  - frontend on `http://127.0.0.1:5173`
- Requires your SQL DB and backend `.env` to be valid.
- GitHub Actions workflow (`.github/workflows/playwright-e2e.yml`) runs when required secrets are configured.
