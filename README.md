# Payment Organizer public website

Public GitHub Pages site for Payment Organizer. It contains the landing page, passwordless account entry, authenticated user portal, configurable downloads/developer content, contact form, privacy policy, and terms.

The site does not store or receive personal payments, income, expenses, debts, balances, financial notes, or financial reminders. Those records remain local in the Flutter application.

## Published files

- `index.html`: landing page, registration/login dialogs, FAQ, and contact.
- `portal.html`: private user portal guarded by a server-validated bearer session.
- `privacy.html` and `terms.html`: owner-review legal drafts.
- `styles.css`: shared responsive and accessible design system.
- `api.js`: versioned Apps Script client and session-scoped token storage.
- `app.js` and `portal.js`: page behavior.
- `public-config.js`: deployment-safe public fields; no secrets.
- `assets/brand/`: original Payment Organizer brand asset.

## Configure without secrets

Set the new platform Apps Script `/exec` URL in `public-config.js` only after the dedicated backend has been installed and verified. The URL is public by nature. Never place Script Properties, `.clasp.json`, administrator emails, spreadsheet IDs, tokens, codes, internal notes, exports, or financial records in this repository.

Developer biography/photo/links and screenshots remain hidden when their configuration values are empty. Download buttons appear only when the backend enables a platform and returns a real HTTPS URL.

## Deployment

1. Verify the dedicated Apps Script backend and new Google Sheets schema.
2. Configure the approved API URL and owner-provided public profile/legal values.
3. Run the static, accessibility, responsive, auth, portal, and contact tests.
4. Review the complete Git diff for secrets and personal data.
5. Commit and push `main`, then publish it with GitHub Pages.

The independent administrator frontend and all private platform projects live outside this public repository under the ignored `_private/` workspace.
