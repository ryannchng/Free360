# Free360

Free360 is a no-account, self-hosted family location-sharing app built with Expo and React Native. It uses OpenStreetMap for the map and a small relay that you run yourself.

There is no Supabase project, email/password sign-up, central Free360 user database, or third-party location service.

## How the private-circle model works

Each phone generates its own random device credential and stores it in the phone's encrypted secure storage. A circle owner points Free360 at their self-hosted relay, creates a circle, then shows a one-time QR invitation.

The QR code lets another phone join without creating an account. It contains the relay address, one-time invite capability, and the circle's end-to-end encryption key. The relay gives the joining phone a separate device credential and immediately invalidates the invite.

Location envelopes are encrypted on the phone before being sent. The relay stores and forwards only:

- random circle and device identifiers
- hashes of relay credentials
- expiry data for one-time invitations
- the most recent encrypted location-or-paused envelope for each device
- up to 100 encrypted check-in events per circle

It never receives a name, email address, unencrypted coordinates, or the circle encryption key.

Keep an invitation QR private until it is claimed. It is a one-time bearer invitation, much like a physical key. If a person should permanently lose access, create a new circle for the remaining group; automatic group-key rotation is intentionally left for the next hardening pass.

## Host a relay

You need a small always-on machine with Docker Compose, a domain name such as `relay.example.com`, and inbound ports 80 and 443 open. A low-cost VPS or a home server with a publicly reachable domain both work. The provided Caddy proxy automatically obtains and renews HTTPS certificates.

1. Point a DNS `A`/`AAAA` record for your relay domain to the machine.
2. Open ports 80 and 443 in the host firewall/router.
3. On the host, copy this repository and enter the relay directory.

   ```bash
   cd relay
   cp .env.example .env
   ```

4. Edit `.env` and replace `relay.example.com` with your real domain.
5. Start the relay and its TLS proxy:

   ```bash
   docker compose up -d --build
   ```

6. Confirm it is available:

   ```bash
   curl https://your-relay-domain.example/healthz
   ```

   It should return `{"status":"ok","protocol":1}`.

The mobile app connects to `wss://your-relay-domain.example/ws`. Do not expose the relay's internal port 8080 to the internet; the provided Compose configuration keeps it internal to Caddy.

Useful host commands:

```bash
docker compose logs -f relay
docker compose pull
docker compose up -d
```

The relay state is retained in Docker's `relay-data` volume. Back up that volume as part of your normal host backup routine. It contains encrypted envelopes and credential hashes, not readable coordinates, but should still be protected.

## Create and join a circle

1. Install Free360 on the owner phone.
2. Open the **You** tab, choose **Set up a private relay**, enter `wss://your-relay-domain.example/ws`, and create a circle.
3. In **You → Private relay**, choose **Invite**. The app creates a QR code that expires after 15 minutes and works once.
4. On the other phone, open Free360 and choose **I have an invitation QR**, then scan the code.
5. Each phone can enable location sharing. The relay receives encrypted location envelopes only.

Check-ins are real encrypted events: they are acknowledged by the relay before the app says they were sent, retained for the most recent 100 events, and replayed after reconnect. The relay cannot read their text. Locations are snapshots, not a route history.

If the relay is temporarily unreachable, the app keeps only the latest encrypted location or paused status on the device and retries it after the relay reconnects. Intermediate location points are intentionally not retained. The map labels the relay as offline and marks locations stale after five minutes; a stale marker is **not** a safety confirmation. Pausing stops the native background task first, then queues an encrypted paused status if delivery fails. The app checks the native task registration on launch so its switch reflects background sharing that persisted across a restart.

The owner can generate another invitation whenever a new person needs to join. No one creates a Free360 account at any point.

## Run the mobile app

Install dependencies once:

```bash
npm install
```

Start the development server:

```bash
npm start
```

Expo Go can preview the interface, the map, QR scanning, secure storage, and foreground location. Continuous background location requires a development build because Expo Go does not support it.

Background delivery depends on device permissions, OS scheduling, connectivity, and the relay being reachable. It is not guaranteed at a fixed interval, especially after a force-quit. Test on physical Android and iOS devices with a development build before relying on it. Free360 does not currently provide automatic safety alerts, arrival notifications, saved places, or emergency response.

To test the complete background-location configuration, create a development build with EAS:

```bash
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile development --platform android
```

The build service is only used to package the app; it is not part of the relay or location-sharing data path. Native app stores also require clear disclosure and platform approval for background location use.

## Verification

```bash
npx expo lint
npx tsc --noEmit
npx expo-doctor
npx expo export --platform android --output-dir /tmp/free360-export
```

The relay protocol can also be checked locally from the `relay` directory:

```bash
npm install
npm start
```

Then request `http://localhost:8080/healthz` from the same machine. Use the Docker/Caddy setup, not plain `ws://`, for real mobile devices.
