# SuperArtillery

TypeScript multiplayer artillery game with a browser client and Node.js server.

![Game Rules](img/Screenshot-rules.png)
![Gameplay](img/Screenshot-game-play.png)

## Quick Start

Prerequisites:

- Node.js 26+
- npm 10+

Install dependencies:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

Run locally in two terminals:

```bash
cd server
npm run dev
```

```bash
cd client
npm run dev
```

Server: http://localhost:3000
Client: http://localhost:5173
Swagger UI: http://localhost:3000/api/swagger

Cloud deployment:

- Client: [Open the deployed client](https://pro-duck400.github.io/SuperArtillery/)
- Server: Open the Railway service URL at `/api/v1/health`
- The deployed client uses the Railway server URL configured in GitHub Actions. Local client development uses `http://localhost:3000` by default.

## Where To Find Docs

Primary docs are in subfolders:

- [server/README.md](server/README.md): server setup, endpoints, runtime notes
- [client/README.md](client/README.md): client setup and runtime expectations
- [contracts/README.md](contracts/README.md): contract-first workflow and generation

Contract source of truth:

- [contracts/openapi/superartillery.yaml](contracts/openapi/superartillery.yaml)

Supporting docs:

- [docs/api/API.md](docs/api/API.md)
- [docs/SuperArtillery.Apple\]\[.Basic](docs/SuperArtillery.Apple][.Basic)

## Common Commands

```bash
npm run contracts:generate
cd server && npm run build
cd ../client && npm run build
```

## Deploy Server To Railway And Client To GitHub Pages

This repository includes a GitHub Actions workflow that deploys the server to Railway and builds and deploys the Vite client from `client/` to GitHub Pages.

URL of service deployed to Railway: [https://superartillery-server-production.up.railway.app/](https://superartillery-server-production.up.railway.app/api/v1/health)

1. Add the `RAILWAY_TOKEN`, `RAILWAY_SERVICE_ID`, and `VITE_SERVER_URL` repository secrets. `VITE_SERVER_URL` is the public Railway URL, including `https://` and without a trailing slash.
2. In Railway, create a project and service for this repository, leave the service root directory empty, and ensure the service uses `railway.toml` from the repository root.
3. Push to `main` (or run the workflow manually from Actions).
4. In GitHub repository settings, ensure Pages source is set to GitHub Actions.
5. After deployment, the site URL will look like:
	- `https://<your-username>.github.io/SuperArtillery/`

Important runtime note:

- The hosted client is static only. It still needs a reachable backend server for API and WebSocket.
- The deployed client is configured to use the Railway backend automatically.