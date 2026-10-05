# Run your own Free360 server

This option runs a **standalone Free360 server** in one Docker container. It uses Node.js and a persistent SQLite database. It does not run, call, or require Supabase. The same release APK also supports managed Supabase projects.

The server stores random device IDs, hashes of device tokens and invitation secrets, encrypted location snapshots, encrypted check-ins, and encrypted 24-hour location trail points. The circle encryption key remains on members' phones and in one-time invitation QR codes. One server hosts one circle, with at most 20 devices. The server retains one latest snapshot per device, 100 recent check-ins, and the last 2000 trail points per device within 24 hours. The history table is created automatically on restart, so updating an existing server only requires rebuilding the container.

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

Install the release APK, open **Create a private circle**, select **Self-hosted**, and enter your server's HTTPS URL. Enter your display name, circle name and the setup code from `docker/.env`. The connection is saved on the phone; no mobile `.env`, repository checkout or custom build is required.

The owner can then create one-time invitation QR codes. Members install the same APK and scan the owner's QR; their server connection is configured automatically. The QR includes the backend type, server URL, circle key and invitation secret; keep it private until claimed. An invitation expires after 15 minutes and works once.

After creating the circle, remove `FREE360_SETUP_CODE` from `docker/.env` if desired and run `docker compose up -d` to recreate the container. The server needs that value only while initializing a fresh database; it stores a hash in SQLite. Do not remove the Docker volume when updating or restarting the server.

## Operations

For home activity push alerts, rebuild the server and install an EAS development build with FCM/APNs credentials. Each receiving member enables notifications in **You → Your name, home and notifications**. The travelling phone must enable background location sharing and sync the circle's saved homes. Names and homes remain encrypted; push messages contain a generic home activity notice and open the Activity screen for details. The server needs outbound HTTPS access to `exp.host`. If Expo push security is enabled, set `EXPO_ACCESS_TOKEN` in `docker/.env`; Compose passes it to the server. The server sends at most one push per minute per sender and never sends to the sender's own token.

Run `docker compose logs free360` to inspect server errors. Apply updates by pulling the repository changes and running `docker compose up -d --build`. Back up the Docker volume and the owner device: a server backup alone cannot recover a lost circle encryption key or owner device session. If the owner loses app data, existing members can still share, but no new invitations can be issued; set up a new server and circle. The API is designed to sit behind HTTPS. Keep the host, Docker, and TLS proxy updated.
