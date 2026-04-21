# Supabase email templates

Branded HTML for the three user-facing auth emails. Single source of truth —
edit the files, push via the script, then verify in the Dashboard
(Auth → Email Templates → preview).

## Files

- `confirmation.html` — email confirmation on signup (`{{ .ConfirmationURL }}`)
- `magic_link.html`   — passwordless sign-in link
- `recovery.html`     — password reset

Greeting is "Hi there," — no personalization. Keeps templates simple and
avoids the Dashboard preview issue with Go-template control flow, and
works uniformly for email-signup and OAuth users (OAuth metadata doesn't
populate `first_name`).

## Push to a Supabase project

Requires the CLI to be logged in (`npx supabase login` stores a token under
`~/.supabase/access-token`) or `SUPABASE_ACCESS_TOKEN` set.

```
scripts/push-email-templates.sh dev    # jizysywayotcmapgnbrc
scripts/push-email-templates.sh prod   # aocqmabbcqrpkcuabzbr
```

The script PATCHes `mailer_subjects_*` + `mailer_templates_*_content` via
the Management API — surgical, never touches SMTP / OAuth / other auth
fields configured in the Dashboard.
