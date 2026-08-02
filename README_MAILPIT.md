# Scoops + Mailpit local prototype

This package contains:

- `index.html` — Scoops frontend, including Parent Section progress-report controls
- `server.js` — local Node server, verification emails, welcome email, parent PIN email, and progress-report emails
- `package.json` — starts the local server
- `WEEKLY_PROGRESS_EMAIL_PREVIEW.html` — standalone preview of the report email

## Start the prototype

Keep two Terminal windows open.

### Terminal 1: Mailpit

From the location of your downloaded Mailpit executable, run Mailpit and leave it open. Mailpit must listen on:

- Web inbox: `http://localhost:8025`
- SMTP: `127.0.0.1:1025`

### Terminal 2: Scoops

Open Terminal in this Scoops folder and run:

```bash
npm start
```

Then open:

- Scoops: `http://localhost:3000`
- Mailpit inbox: `http://localhost:8025`

Do not test the email features through GitHub Pages, an HTTPS preview, or VS Code Live Server.

## Progress reports

Inside the protected Parent Section, a parent can:

- Turn the automatic weekly report on or off
- Select the weekly send day
- Preview a report inside Scoops
- Request an email report for the past 7 days, month, 3 months, 6 months, year, or all time

This local prototype stores learning activity in the current browser. A scheduled report cannot be sent while Scoops, the Node server, or Mailpit is closed. When a weekly report becomes due, Scoops sends it the next time the app opens while both local services are running.

Before enough real activity has been recorded, the report uses clearly labeled prototype sample data so the email design can be reviewed.
