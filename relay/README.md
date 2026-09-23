# Free360 relay

This relay is intentionally small. It authenticates random device credentials, issues one-time join invitations, persists the last opaque location/paused envelope per device and up to 100 opaque check-in events per circle, and broadcasts them to connected circle members.

It cannot decrypt location data. See the repository [README](../README.md) for the supported deployment path, TLS setup, QR flow, and security model.
