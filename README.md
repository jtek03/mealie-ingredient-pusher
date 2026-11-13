# Mealie Ingredient Pusher

A simple self-hosted web app that bulk-pushes ingredients to a [Mealie](https://mealie.io) recipe via the API — bypassing Mealie's broken bulk-add parser.

## Features

- Parses ingredients in any format: `Thyme (1 tbsp)` or `1 tbsp Thyme`
- Handles Unicode fractions (½ ¼ ¾ ⅓ etc.)
- Preview parse results before pushing
- Test your connection before sending anything
- Remembers your URL and token between sessions
- Proxies all Mealie API calls server-side (no CORS issues)

## Deploy on Unraid / Docker

### Option 1 — Docker Compose

```yaml
services:
  mealie-ingredient-pusher:
    image: ghcr.io/jtek03/mealie-ingredient-pusher:latest
    ports:
      - "3000:3000"
    restart: unless-stopped
```

### Option 2 — Unraid Community Apps / Template

Add a custom template pointing to:
- **Repository:** `ghcr.io/jtek03/mealie-ingredient-pusher:latest`
- **Port:** `3000`

### Option 3 — Build locally

```bash
git clone https://github.com/jtek03/mealie-ingredient-pusher
cd mealie-ingredient-pusher
docker compose up -d
```

Open http://localhost:3000

## Restricting which Mealie host it will talk to

The server forwards requests to whatever Mealie URL it is given. If it can be reached by anyone you do not trust, set an allowlist so it cannot be used as a relay into your network:

```
ALLOWED_MEALIE_HOSTS=10.10.1.175:9925,mealie.example.com
```

Entries are `host` or `host:port`. Any other host is refused. Without this variable the server allows any host and logs a warning at startup.

## Usage

1. Enter your Mealie base URL (e.g. `https://mealie.yourdomain.com`)
2. Paste your API token (Mealie → Profile → API Tokens)
3. Enter the recipe slug (the last part of the recipe URL)
4. Paste your ingredients — any format works
5. Hit **Preview parse** to check how they parsed
6. Hit **Push to Mealie**

## Ingredient formats supported

```
80/20 Ground Pork (1lb)
Thyme (1 tbsp)
Sage (7-8 leaves)
Garlic (2 cloves)
Smoked Paprika (½ tsp)
1/4 tsp Cayenne Pepper
2 tsp Fennel Seeds
Salt
```

## Development

```bash
npm install
npm run dev
```
