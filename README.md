# AI MCQ App

## Admin Analytics Date Range

- AppAdmin analytics is available at `/admin/analytics`.
- All admin analytics endpoints accept optional `from` and `to` query params in `YYYY-MM-DD`.
- If omitted, the backend defaults to the last 7 days in UTC, inclusive of the `to` date by day.
- Endpoints:
  - `GET /api/admin/usage/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `GET /api/admin/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `GET /api/admin/users/at-risk?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Usage reporting is driven by `dbo.UsageEvent`.
- Profit/loss snapshots are persisted in `dbo.ProfitLossSnapshot`.
