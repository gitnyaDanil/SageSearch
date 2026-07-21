# SageSearch Cloud proxy

This service is the only component allowed to call DeepSeek. It accepts a
SageSearch interpretation request and returns a schema-validated response; it
never receives local file metadata, paths, results, or document content.

## Required Cloud Run configuration

- `DEEPSEEK_API_KEY`: mounted from Secret Manager, never placed in source code

Optional variables are `DEEPSEEK_MODEL` (defaults to `deepseek-chat`),
`INTERPRET_RATE_LIMIT_MAX` (defaults to `20`), and
`INTERPRET_RATE_LIMIT_WINDOW_MS` (defaults to `60000`). The limiter is
in-memory and per Cloud Run instance, so configure Cloud Armor/API Gateway or
a shared store before relying on it for distributed abuse prevention.

## Deploy

With `gcloud` authenticated, set the DeepSeek secret value in the current
PowerShell process (do not put it in source control) and run:

```powershell
$env:DEEPSEEK_API_KEY = '...'
.\deploy.ps1 -Project YOUR_PROJECT -Region YOUR_REGION
```

The script creates or rotates the DeepSeek secret, deploys Cloud Run with a
maximum of two instances, and only after a successful deployment writes its
exact `/interpret` URL to `backend/config.json`. `/interpret` is public for
zero-setup jury use, but accepts only its strict schema and is limited to 20
requests per IP per minute per instance. For a public product, add user
authentication and Cloud Armor or API Gateway.
