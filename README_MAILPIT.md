# Scoops + Mailpit local email setup

This package connects the Scoops prototype to Mailpit for:

- Parent-email verification during account creation
- A welcome email after successful verification
- A six-digit code for the protected Parent Section

## Start it

1. Make sure Mailpit is running.
2. Confirm the Mailpit inbox opens at `http://localhost:8025`.
3. Put these files in the same folder:
   - `scoops_mailpit_connected.html`
   - `server.js`
   - `package.json`
4. Open Terminal in that folder.
5. Run:

```bash
npm start
```

No `npm install` is required because the server uses only Node's built-in modules.

6. Open Scoops at:

```text
http://localhost:3000
```

Do not open the HTML file by double-clicking it. Serving Scoops through `server.js` keeps the page and email API connected correctly.

## Test account verification

1. On the Scoops login screen, choose **Create account**.
2. Enter a parent email and the child profile details.
3. Choose **Create account**.
4. Open Mailpit at `http://localhost:8025`.
5. Open the verification email and copy its six-digit code.
6. Enter the code in Scoops.
7. Mailpit will receive the welcome email after verification succeeds.

Mailpit captures every address locally, so the parent email does not need to be a real inbox while testing.

## Test Parent Section access

1. Log into Scoops.
2. Choose the Parent Section icon in the top-right corner.
3. Confirm or enter the parent email.
4. Choose **Send code**.
5. Read the code in Mailpit.
6. Enter it in Scoops and choose **Verify and enter**.

## Ports

- Scoops local app and API: `3000`
- Mailpit web inbox: `8025`
- Mailpit SMTP: `1025`

Environment variables can override the defaults:

```bash
PORT=3001 MAILPIT_SMTP_HOST=127.0.0.1 MAILPIT_SMTP_PORT=1025 npm start
```

## Important prototype limitation

The current Scoops login and account data still use browser `localStorage`, including the prototype password. This is suitable only for local demonstrations. A public version needs real server-side authentication, password hashing, a database, rate limiting, secure sessions, and children’s-privacy/legal review.
