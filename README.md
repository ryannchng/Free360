# Free360

Free360 is a private family location-sharing app built with Expo. A group runs its own Supabase project and its own Free360 app build. Members do not need a domain, a Supabase account, an email address, or a password. The app creates an anonymous Supabase Auth session for each device.

The app encrypts location snapshots, paused status, and check-ins on the device before uploading them. The Supabase project stores only encrypted envelopes, random device and circle IDs, invitation hashes and expiry times, and delivery timestamps. The circle encryption key stays on members' devices and in one-time invitation QR codes. The database retains one latest snapshot per device and the most recent 100 check-ins.

## Set up a group project

Each cloned deployment is configured for **one Supabase project and one circle**. The person setting up the group does these steps once:

1. Create a Supabase project. Enable **Anonymous Sign-Ins** under Authentication settings. Supabase supplies the project's HTTPS URL, so no custom domain or separate server is needed.
2. In the project's SQL Editor, run all of [`supabase/schema.sql`](supabase/schema.sql). Then run:

   ```sql
   select public.free360_new_setup_code();
   ```

   Copy the returned code privately. It can be used once to create this project's circle. The project stores only its hash. Running this command again after a setup code or circle exists will fail by design.
3. In the repository root, copy `.env.example` to `.env` and replace both placeholders with your project's URL and **publishable** key. Never place a `service_role` or secret key in the mobile app. Expo embeds `EXPO_PUBLIC_` values in the app bundle; the database's access rules protect the data.
4. Install dependencies and start Expo:

   ```bash
   npm install
   npm start
   ```

5. On the owner's device, open **You → Create a private circle**, enter a circle name and the setup code, and create the circle. Then open **Invite** to show a one-time QR code. Other members need an app build configured with the **same Supabase project** and can join by scanning that QR code. An invitation expires after 15 minutes and can be claimed only once.

For EAS builds, set the same two `EXPO_PUBLIC_SUPABASE_*` variables in the build environment. Each group that clones the repo uses its own values and distributes its own build. Invitation QR codes identify the project, so a QR from another group's build is rejected.

## How access works

The database allows only one circle. Its owner is the device that created it with the one-time setup code. Only that owner can issue invitations. A claim is atomic: one anonymous device session can consume an invitation, after which it is unavailable. The database limits a circle to 20 devices. Row-level security allows members to read only the encrypted snapshots and check-ins for their circle. Writes go through authenticated database functions that derive the sender from the Supabase session, rather than trusting a device ID supplied by the app.

Keep invitation QRs private until claimed: they contain the circle's encryption key. Supabase project administrators can see metadata and encrypted envelopes, but not plaintext coordinates or check-in text. The existing app does not rotate the group key when someone leaves. To permanently exclude a former member, create a fresh Supabase project and circle with the remaining members.

Anonymous sessions and the circle key live on each device. If a device loses its app data, it must join again with a new invitation. If the owner loses its app data, the existing circle cannot issue new invitations; create a fresh project and circle.

## Location behavior

Sharing is off until a member enables it. Foreground updates and check-ins upload through HTTPS; the app listens for new rows while open. The latest encrypted snapshot is queued on the device during an outage and retried after reconnect. Intermediate points are not retained. A stale map marker is not a safety confirmation.

Expo Go can preview the app, but continuous background location requires a development build. Test on physical Android and iOS devices before relying on background delivery; OS scheduling, permissions, connectivity, and force-quits can interrupt it. Free360 does not provide emergency response or automatic safety alerts.

```bash
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile development --platform android
```

## Verify the code

```bash
npx expo lint
npx tsc --noEmit
npx expo-doctor
```
