# Batchroom

## Run the UI

```bash
npm install
npm run dev
```

## Run the application API

```bash
npm run api
```

The API listens on `http://localhost:8787` by default. Set `VITE_API_URL` in `.env` when the API is hosted elsewhere.

### API endpoints

- `GET /health`
- `GET /api/providers/openai/models`
- `GET /api/providers/gemini/models`
- `POST /api/providers/openai/generate`
- `POST /api/providers/gemini/generate`

Provider API keys are sent per request using the `x-provider-api-key` header and are not persisted by this server. The browser still holds the key in memory for the current session.

> Provider API behavior and model availability can change. Verify the enabled image model and account permissions before production use. Do not expose this development API publicly without authentication, rate limiting, request limits, and HTTPS.
