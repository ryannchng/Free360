import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFree360Server } from "./server.mjs";

async function start(databasePath = ":memory:", setupCode = "a".repeat(64)) {
    const instance = createFree360Server({ databasePath, setupCode });
    await new Promise((resolve) =>
        instance.server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${instance.server.address().port}`;
    const close = async () => {
        await new Promise((resolve) => instance.server.close(resolve));
        instance.db.close();
    };
    return { url, close };
}

async function call(url, path, { method = "GET", token, body } = {}) {
    const response = await fetch(`${url}${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
}

test("owner, invitation, membership, encrypted updates, and replay protection", async () => {
    const app = await start();
    try {
        const owner = (await call(app.url, "/v1/sessions", { method: "POST" }))
            .data;
        const guest = (await call(app.url, "/v1/sessions", { method: "POST" }))
            .data;
        const outsider = (
            await call(app.url, "/v1/sessions", { method: "POST" })
        ).data;
        const circleId = randomUUID();
        const inviteId = randomUUID();
        const envelope = {
            version: 1,
            nonce: "a".repeat(32),
            ciphertext: "b".repeat(64),
        };

        assert.equal(
            (
                await call(app.url, "/v1/circle", {
                    method: "POST",
                    token: owner.token,
                    body: { circleId, setupCode: "wrong" },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await call(app.url, "/v1/circle", {
                    method: "POST",
                    token: owner.token,
                    body: { circleId, setupCode: "a".repeat(64) },
                })
            ).status,
            201,
        );
        assert.equal(
            (
                await call(app.url, "/v1/circle", {
                    method: "POST",
                    token: guest.token,
                    body: { circleId: randomUUID(), setupCode: "a".repeat(64) },
                })
            ).status,
            409,
        );
        assert.equal(
            (
                await call(app.url, "/v1/invites", {
                    method: "POST",
                    token: guest.token,
                    body: { inviteId, secret: "s".repeat(44) },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await call(app.url, "/v1/invites", {
                    method: "POST",
                    token: owner.token,
                    body: { inviteId, secret: "s".repeat(44) },
                })
            ).status,
            201,
        );
        assert.equal(
            (
                await call(app.url, "/v1/invites/claim", {
                    method: "POST",
                    token: guest.token,
                    body: { inviteId, circleId, secret: "bad" },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await call(app.url, "/v1/invites/claim", {
                    method: "POST",
                    token: guest.token,
                    body: { inviteId, circleId, secret: "s".repeat(44) },
                })
            ).status,
            200,
        );
        assert.equal(
            (
                await call(app.url, "/v1/invites/claim", {
                    method: "POST",
                    token: outsider.token,
                    body: { inviteId, circleId, secret: "s".repeat(44) },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await call(app.url, `/v1/updates?circleId=${circleId}`, {
                    token: outsider.token,
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await call(app.url, "/v1/snapshot", {
                    method: "PUT",
                    token: guest.token,
                    body: { envelope },
                })
            ).status,
            200,
        );
        assert.equal(
            (
                await call(app.url, "/v1/events", {
                    method: "POST",
                    token: owner.token,
                    body: { envelope },
                })
            ).status,
            200,
        );
        const updates = await call(
            app.url,
            `/v1/updates?circleId=${circleId}`,
            { token: guest.token },
        );
        assert.equal(updates.status, 200);
        assert.equal(updates.data.snapshots.length, 1);
        assert.equal(updates.data.events.length, 1);
        assert.equal(updates.data.snapshots[0].device_id, guest.deviceId);
        assert.equal(
            (
                await call(
                    app.url,
                    `/v1/updates?circleId=${circleId}&after=${updates.data.revision}`,
                    { token: guest.token },
                )
            ).data.events.length,
            0,
        );
        assert.equal(
            (
                await call(app.url, "/v1/snapshot", {
                    method: "PUT",
                    token: outsider.token,
                    body: { envelope },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await call(app.url, "/v1/push-token", {
                    method: "POST",
                    token: outsider.token,
                    body: { token: "ExpoPushToken[outsider]" },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await call(app.url, "/v1/push-token", {
                    method: "POST",
                    token: owner.token,
                    body: { token: "invalid" },
                })
            ).status,
            400,
        );
        assert.equal(
            (
                await call(app.url, "/v1/push-token", {
                    method: "POST",
                    token: owner.token,
                    body: { token: "ExpoPushToken[owner]" },
                })
            ).status,
            200,
        );
        assert.equal(
            (
                await call(app.url, "/v1/push-token", {
                    method: "POST",
                    token: guest.token,
                    body: { token: "ExpoPushToken[guest]" },
                })
            ).status,
            200,
        );
        const realFetch = globalThis.fetch;
        const deliveries = [];
        globalThis.fetch = async (url, options) => {
            if (url === "https://exp.host/--/api/v2/push/send") {
                deliveries.push(JSON.parse(options.body));
                return Response.json({
                    data: [{ status: "ok", id: "ticket" }],
                });
            }
            return realFetch(url, options);
        };
        try {
            assert.equal(
                (
                    await call(app.url, "/v1/notify", {
                        method: "POST",
                        token: outsider.token,
                        body: {},
                    })
                ).status,
                403,
            );
            assert.equal(
                (
                    await call(app.url, "/v1/notify", {
                        method: "POST",
                        token: owner.token,
                        body: {},
                    })
                ).status,
                200,
            );
            assert.equal(deliveries.length, 1);
            assert.deepEqual(
                deliveries[0].map((item) => item.to),
                ["ExpoPushToken[guest]"],
            );
            assert.equal(
                (
                    await call(app.url, "/v1/notify", {
                        method: "POST",
                        token: owner.token,
                        body: {},
                    })
                ).status,
                200,
            );
            assert.equal(
                deliveries.length,
                1,
                "repeated calls must be throttled",
            );
        } finally {
            globalThis.fetch = realFetch;
        }
    } finally {
        await app.close();
    }
});

test("location history keeps the latest 2000 points per device and snapshots can be pulled in full", async () => {
    const app = await start();
    try {
        const owner = (await call(app.url, "/v1/sessions", { method: "POST" }))
            .data;
        const guest = (await call(app.url, "/v1/sessions", { method: "POST" }))
            .data;
        const circleId = randomUUID();
        const inviteId = randomUUID();
        const envelope = {
            version: 1,
            nonce: "a".repeat(32),
            ciphertext: "b".repeat(64),
        };
        assert.equal(
            (
                await call(app.url, "/v1/circle", {
                    method: "POST",
                    token: owner.token,
                    body: { circleId, setupCode: "a".repeat(64) },
                })
            ).status,
            201,
        );
        assert.equal(
            (
                await call(app.url, "/v1/invites", {
                    method: "POST",
                    token: owner.token,
                    body: { inviteId, secret: "s".repeat(44) },
                })
            ).status,
            201,
        );
        assert.equal(
            (
                await call(app.url, "/v1/invites/claim", {
                    method: "POST",
                    token: guest.token,
                    body: { inviteId, circleId, secret: "s".repeat(44) },
                })
            ).status,
            200,
        );
        assert.equal(
            (
                await call(app.url, `/v1/history?circleId=${circleId}`, {
                    token: guest.token,
                })
            ).data.history.length,
            0,
        );
        for (let index = 0; index < 2001; index++) {
            assert.equal(
                (
                    await call(app.url, "/v1/history", {
                        method: "PUT",
                        token: guest.token,
                        body: { envelope },
                    })
                ).status,
                200,
            );
        }
        assert.equal(
            (
                await call(app.url, "/v1/history", {
                    method: "PUT",
                    token: guest.token,
                    body: { envelope: { ...envelope, ciphertext: "c" } },
                })
            ).status,
            400,
        );
        const history = await call(
            app.url,
            `/v1/history?circleId=${circleId}`,
            { token: owner.token },
        );
        assert.equal(history.status, 200);
        assert.equal(history.data.history.length, 2000);
        assert.equal(history.data.history[0].device_id, guest.deviceId);
        assert.equal(history.data.history.at(-1).device_id, guest.deviceId);
        assert.equal(
            (
                await call(app.url, `/v1/history?circleId=${circleId}`, {
                    token: guest.token,
                })
            ).status,
            200,
        );
        assert.equal(
            (
                await call(app.url, `/v1/snapshots?circleId=${circleId}`, {
                    token: guest.token,
                })
            ).data.snapshots.length,
            0,
        );
        assert.equal(
            (
                await call(app.url, "/v1/snapshot", {
                    method: "PUT",
                    token: guest.token,
                    body: { envelope },
                })
            ).status,
            200,
        );
        const snapshots = await call(
            app.url,
            `/v1/snapshots?circleId=${circleId}`,
            { token: owner.token },
        );
        assert.equal(snapshots.status, 200);
        assert.equal(snapshots.data.snapshots.length, 1);
        assert.equal(snapshots.data.snapshots[0].device_id, guest.deviceId);
    } finally {
        await app.close();
    }
});

test("SQLite survives restart and retains only the latest 100 events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "free360-server-"));
    const path = join(directory, "group.sqlite");
    let app = await start(path);
    try {
        const owner = (await call(app.url, "/v1/sessions", { method: "POST" }))
            .data;
        const circleId = randomUUID();
        const envelope = {
            version: 1,
            nonce: "a".repeat(32),
            ciphertext: "b".repeat(64),
        };
        assert.equal(
            (
                await call(app.url, "/v1/circle", {
                    method: "POST",
                    token: owner.token,
                    body: { circleId, setupCode: "a".repeat(64) },
                })
            ).status,
            201,
        );
        for (let index = 0; index < 101; index++) {
            assert.equal(
                (
                    await call(app.url, "/v1/events", {
                        method: "POST",
                        token: owner.token,
                        body: { envelope },
                    })
                ).status,
                200,
            );
        }
        await app.close();
        app = await start(path, "");
        const updates = await call(
            app.url,
            `/v1/updates?circleId=${circleId}`,
            { token: owner.token },
        );
        assert.equal(updates.status, 200);
        assert.equal(updates.data.events.length, 100);
        assert.equal(
            (
                await call(app.url, "/v1/circle", {
                    method: "POST",
                    token: owner.token,
                    body: { circleId: randomUUID(), setupCode: "a".repeat(64) },
                })
            ).status,
            409,
        );
    } finally {
        await app.close();
        await rm(directory, { recursive: true, force: true });
    }
});
