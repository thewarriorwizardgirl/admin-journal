# Journal admin

Standalone React admin UI for creating, editing, searching, and deleting journal
posts. It uses the separate backend API and does not host or modify the public
journal frontend.

## Run locally

1. Start MongoDB/backend from `../backend` after configuring `MONGODB_URI`.
2. To use the sign-in screen locally, set `ADMIN_EMAIL`,
   `ADMIN_PASSWORD_HASH`, and `SESSION_SECRET` in the backend's `.env`, and set
   `ADMIN_AUTH_DISABLED=false`. Create a password hash with
   `npm run hash-password` from the backend folder. Alternatively, the backend
   can bypass login only for local development with
   `NODE_ENV=development` and `ADMIN_AUTH_DISABLED=true`.
3. Copy `.env.example` to `.env` and set `VITE_API_URL` if the API is not at
   `http://localhost:4000`.
4. Run `npm install` and `npm run dev`; the admin UI is at
   `http://localhost:5174`.

The public journal uses port `5173`; the admin app uses port `5174`. The
backend's `CLIENT_ORIGINS` must include `http://localhost:5174`. The admin
sign-in screen creates a secure backend session; post-management requests use
that HttpOnly cookie. For production, configure the same admin credentials and
session secret on the backend host, set `ADMIN_AUTH_DISABLED=false`, and add
the exact deployed admin origin to `CLIENT_ORIGINS`. Both the admin and API
must use HTTPS for production session cookies.

For media uploads, configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
and `CLOUDINARY_API_SECRET` in the backend environment. The API signs uploads;
the Cloudinary API secret must never be placed in the admin app. The editor can
upload cover images, cover videos, and inline story images.

## Build

```sh
npm run build
```

For deployment, configure `VITE_API_URL` to the separately deployed API URL at
build time. Do not put database credentials in this app; MongoDB access is
handled only by the backend.
