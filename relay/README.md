# Free360 relay

This relay is intentionally small. It authenticates random device credentials, issues one-time join invitations, persists the last opaque envelope per device, and broadcasts opaque envelopes to connected circle members.

It cannot decrypt location data. See the repository [README](../README.md) for the supported deployment path, TLS setup, QR flow, and security model.
