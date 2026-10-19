# Product

Users can sign up with name/email/password, verify their address, sign in, sign out,
resend verification and reset a password. The private dashboard shows a searchable
user table with cursor pagination. Verified users can read the sample list,
including emails; no administrator role is defined.

- Verification is required before signin/private access; signup and verification
  never automatically sign in.
- Exact, untransformed passwords contain 8–128 characters. HIBP checks new passwords
  in staging/production; refusal/outage consumes reset links without changing passwords.
- Verification expires after 24 hours and reset after one hour; reset is single-use
  and revokes sessions. Sessions last seven days and renew after one day.
- Email request responses do not reveal whether an account exists.
- Sensitive auth quotas allow 5 requests/minute per socket peer/endpoint; general
  auth allows 100, users 120 and identity 30. All are shared in PostgreSQL.
- Email and public paths follow the selected locale. Code identifiers and API
  paths remain English. Auth callbacks preserve the public locale.
- Search is case-insensitive with literal SQL wildcards, bounded to 100 characters;
  pages default to 20 users. Previous pages come from the frontend cache.

There is no additional domain, OAuth, MFA, payment, storage or durable job system.
Better Auth RS is an alpha dependency; migrating existing Nest accounts is separate work.
