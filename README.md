# Mintay

Mintay is a Figma plugin and companion backend that reverse-engineers frontend code into editable Figma frames. Paste a React component, Next.js page, HTML/CSS snippet, Tailwind UI, or a GitHub file URL into the plugin, send it through Gemini, and Mintay rebuilds the interface on the Figma canvas with editable frames, text, spacing, fills, and layer names.

## Screenshots

Add screenshots here once you have local captures from the plugin UI and the generated Figma canvas output.

## Project Structure

```text
mintay/
├── backend/
├── plugin/
├── shared/
└── README.md
```

## Installation

### 1. Clone and install dependencies

```bash
git clone <your-repo-url> mintay
cd mintay/backend
npm install
cd ../plugin
npm install
```

### 2. Configure the backend

Copy `backend/.env.example` to `.env` and set your Gemini key:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash
PORT=3001
```

`PORT=3001` is only for local development. Hosted platforms like Render inject their own `PORT` value.

### 3. Start the backend locally

```bash
cd backend
npm run dev
```

### 4. Build the plugin

```bash
cd plugin
npm run build
```

### 5. Import the plugin into Figma

1. Open Figma Desktop.
2. Go to `Plugins` -> `Development` -> `Import plugin from manifest...`
3. Select [`plugin/manifest.json`](/C:/Users/DELL/mintay/plugin/manifest.json).
4. Run Mintay from the development plugins list.

## How To Use

1. Open Mintay in Figma.
2. Click the settings icon and add your Gemini API key.
3. Confirm the backend URL, which defaults to `http://localhost:3001`.
   For a deployed backend, replace this with your Render service URL.
4. Paste frontend code or switch to the GitHub URL tab and paste a file URL.
5. Choose `Auto`, `Mobile`, `Desktop`, or `Tablet` screen mode.
6. Click `Import to Figma`.
7. Wait for the parse to complete and Mintay will place generated frames on the current page.

## Supported Input Formats

- React components
- Next.js pages and route files
- HTML and CSS snippets
- Tailwind-based UI code
- GitHub blob or raw file URLs

## Backend Deployment

### Best Free Option: Render

As of March 22, 2026, Render still offers a free web service tier, while Railway's persistent paid plan starts at $5/month and only has a limited free trial plus a small free-credit tier. If you want to keep Mintay free for now, deploy the backend on Render.

Files prepared for this:

- [`render.yaml`](/C:/Users/DELL/mintay/render.yaml)
- [`backend/package.json`](/C:/Users/DELL/mintay/backend/package.json)

Deploy steps:

1. Push this repository to GitHub.
2. Create a new Render Web Service from that repository, or use Blueprint deploy with [`render.yaml`](/C:/Users/DELL/mintay/render.yaml).
3. If creating manually, set `Root Directory` to `backend`.
4. Set environment variables:
   `GEMINI_API_KEY`
   `GEMINI_MODEL=gemini-1.5-flash`
   Do not set `PORT` manually on Render.
5. Build command: `npm install && npm run build`
6. Start command: `npm start`
7. After deployment, open `https://your-render-service.onrender.com/health` and confirm you get an `ok: true` response.
8. Copy the Render URL and add it in Mintay settings as the backend URL.

Free-tier note:

- Render Free web services spin down after 15 minutes of inactivity, so the first request after idle can be slow.
- That is acceptable for testing and hobby use, but not ideal for a polished production plugin.

### Railway

Use Railway if you later want a better production experience and are okay paying. Railway is better for a more responsive plugin backend, but it is not the best choice if the main constraint is staying free.

## Plugin Deployment

1. Build the plugin from [`plugin/`](/C:/Users/DELL/mintay/plugin).
2. Verify the generated files inside `plugin/dist/`.
3. Open Figma Community publishing tools.
4. Submit the manifest and the built plugin bundle.
5. Update [`plugin/manifest.json`](/C:/Users/DELL/mintay/plugin/manifest.json) `allowedDomains` to include your deployed backend before publishing.

## How To Get A Gemini API Key

1. Open Google AI Studio.
2. Create or select a project.
3. Generate an API key.
4. Paste the key into Mintay settings inside the plugin.

## Known Limitations

- Hover states and animated states are not reconstructed automatically.
- Images are represented as editable placeholders instead of imported assets.
- Complex CSS grid layouts may be simplified into frames and auto-layout stacks.
- Custom or unavailable fonts may fall back to Inter inside Figma.
- Published plugins still need their backend domains declared in the manifest allowlist.

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Keep shared schema updates backward-compatible when possible.
4. Test both the backend parse flow and the plugin build flow before opening a PR.
5. Document any prompt or schema changes that affect generated output.

## License

MIT
