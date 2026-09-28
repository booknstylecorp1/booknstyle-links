# /pro/ — BookNStyle Pro billing page

`https://app.booknstyle.com/pro/` — where pros start or manage their Pro plan.

Why it exists: Google Play doesn't let the Android app sell the Pro plan, so
pros pay here and the app just unlocks what they paid for. The iPhone app may
open Stripe Checkout in Safari (Apple 3.1.1(a), US); Stripe then comes back to
`/pro/?checkout=success&from=app`, which shows an "Open BookNStyle" button.

- `index.html` — the page (styles inline).
- `app.js` — the page's script. Only `textContent` for anything from the
  server; only sends the browser to `checkout.stripe.com` / `billing.stripe.com`.
- supabase-js is loaded from jsDelivr at a pinned version with an SRI hash. To
  upgrade, change the version and the `integrity` hash together:
  `curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<v>/dist/umd/supabase.js | openssl dgst -sha384 -binary | openssl base64 -A`

Nothing else on this site links here (the Android app opens the site's
`/book/` pages). Pros get here from the welcome email (send-pro-welcome-emails)
or by typing the address. The `/pro/` path is not in the app-link files
(`.well-known/`), so it always opens in the browser.

## Server pieces

- Migration 044: `get_my_pro_plan()` (the signed-in user's own plan),
  `get_billing_config()` / `app_config` (the iPhone switch).
- Edge function `stripe-create-subscription-checkout`:
  `{ plan, return_to: 'web' }` starts Checkout;
  `{ action: 'portal', return_to: 'web' }` opens Stripe's billing page
  (update card, invoices, cancel at period end).

## Supabase Auth settings (Dashboard → Authentication), one time

1. **URL Configuration → Redirect URLs**: add `https://app.booknstyle.com/pro/`
   (keep the existing `booknstyle://auth-callback` and `booknstyle://**`).
   Leave the Site URL as it is.
2. **Email Templates → Magic Link** (the email `signInWithOtp` sends to an
   existing user): it must contain `{{ .Token }}`, or pros get a link but no
   code. Suggested:
   - Subject: `Your BookNStyle sign-in code`
   - Body:
     ```html
     <h2>Your BookNStyle sign-in code</h2>
     <p>Enter this code on the BookNStyle billing page:</p>
     <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
     <p>It works once and expires soon. If you didn't ask for it, ignore this email.</p>
     ```
   The app itself never sends this email (it doesn't use magic links), so
   changing it affects only this page.
3. **Emails / SMTP Settings**: must use the custom sender (Resend). Supabase's
   built-in sender only delivers to your own team's addresses and a few an hour.
4. **Rate Limits → emails sent per hour**: check it's high enough for launch
   (each code is one email).
5. Nothing to change for passwords, Apple, Google or Facebook.
