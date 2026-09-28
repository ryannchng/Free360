# Run your own Free360 server

This option runs a **standalone Free360 server** in one Docker container. It uses Node.js and a persistent SQLite database. It does not run, call, or require Supabase. The existing managed Supabase option remains available for separate app builds.

The server stores random device IDs, hashes of device tokens and invitation secrets, encrypted location snapshots, and encrypted check-ins. The circle encryption key remains on members' phones and in one-time invitation QR codes. One server hosts one circle, with at most 20 devices. The server retains one latest snapshot per device and 100 recent check-ins.

## Start the server

1. Install Docker with Compose on the host. Copy `docker/.env.example` to `docker/.env` and replace the placeholder with a random setup code. Generate one with `openssl rand -hex 32`, or with Node.js using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Save the code privately; the owner enters it once in the app.
2. From this repository's `docker` directory, start the container:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

3. Put an HTTPS reverse proxy in front of `127.0.0.1:8080` and use a public URL that every group phone can reach, such as `https://group.example.com`. For example, with Caddy installed on the host, a Caddyfile can contain:

   ```caddyfile
   group.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

   Point that name to the host and allow ports 80 and 443 through its firewall so Caddy can obtain a certificate. See [Caddy's HTTPS guide](https://caddyserver.com/docs/quick-starts/https). The Compose file binds only to loopback so the HTTP API is not exposed directly. Forward request bodies and the `Authorization` header if you use another proxy. A phone on a mobile network cannot reach the server through `localhost` or a private LAN address.

4. Check `https://group.example.com/health`; it should return `{"ok":true}`. The SQLite database lives in the `free360-data` Docker volume and survives container replacement. Back up that volume regularly.

## Connect the mobile app

In the repository root, copy `.env.example` to `.env` and set:

```dotenv
EXPO_PUBLIC_BACKEND=self-hosted
EXPO_PUBLIC_SELF_HOSTED_URL=https://group.example.com
```

The `EXPO_PUBLIC_SUPABASE_*` values are not used in this mode. Install dependencies with `npm install` and run `npm start`, or build the app with the same two public variables in its EAS environment. Every member needs an app build configured with the same server URL.

On the owner's device, open **Create a private circle** and enter the setup code from `docker/.env`. The owner can then create one-time invitation QR codes for other devices. The QR includes the server URL, circle key, and invitation secret; keep it private until claimed. An invitation expires after 15 minutes and works once.

After creating the circle, remove `FREE360_SETUP_CODE` from `docker/.env` if desired and run `docker compose up -d` to recreate the container. The server needs that value only while initializing a fresh database; it stores a hash in SQLite. Do not remove the Docker volume when updating or restarting the server.

## Operations

Run `docker compose logs free360` to inspect server errors. Apply updates by pulling the repository changes and running `docker compose up -d --build`. Back up the Docker volume and the owner device: a server backup alone cannot recover a lost circle encryption key or owner device session. If the owner loses app data, existing members can still share, but no new invitations can be issued; set up a new server and circle. The API is designed to sit behind HTTPS. Keep the host, Docker, and TLS proxy updated.
