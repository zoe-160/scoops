# Scoops + Mailpit local setup

This corrected package fixes two issues:

- The account form no longer closes when the shaded background is clicked. Use the X button to close it.
- Email requests always target the Scoops local API on port 3000 and now show a useful error when the page is opened through GitHub Pages, a file preview, or Live Server.

## Replace the local project files

Put these four files together in the root of the local Scoops GitHub project folder:

- `index.html`
- `server.js`
- `package.json`
- `README_MAILPIT.md`

Back up the current files first, then replace them with these versions.

## Start Scoops

1. Start Mailpit and confirm its inbox opens at `http://localhost:8025`.
2. Open Terminal in the Scoops project folder.
3. Run:

```bash
npm start
```

4. Keep that Terminal window open.
5. Open Scoops only at:

```text
http://localhost:3000
```

Do not test the email flow from GitHub Pages, by double-clicking `index.html`, or through VS Code Live Server. GitHub Pages cannot run `server.js`, and an HTTPS GitHub page cannot call the local HTTP server.

## Quick checks

Open `http://localhost:3000/api/health`. It should show JSON containing `"ok": true`.

Mailpit uses:

- Web inbox: `http://localhost:8025`
- SMTP: `127.0.0.1:1025`

## Development limitation

Mailpit captures email locally. It does not deliver to the real Gmail address entered in the form. A public release needs a hosted backend and a real transactional email provider.
