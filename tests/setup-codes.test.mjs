// Managed Supabase 16-digit setup-code backend tests.
//
// Run: node --test tests/setup-codes.test.mjs
//
// Two modes, zero required dependencies:
// - Integration (preferred): runs the real SQL in genuine PostgreSQL. Used
//   automatically when @electric-sql/pglite can be imported (dynamic import;
//   install it locally to enable: npm install --save-dev @electric-sql/pglite),
//   otherwise via the system psql client when SETUP_TESTS_LIVE=1 and
//   TEST_DATABASE_URL is set (point it at an EPHEMERAL database only: the
//   suite writes test circles, members, codes, and rate rows into the live
//   free360_* tables).
// - Static: file/contract checks that always run with plain node.
//
// Covers: generator format/leading zeros/expiry, hash-only storage, redeem
// lifecycle (ok/used/expired/invalid), separator normalization, persistent
// rate counters + windows + global backstop, concurrent redemption, rollback
// on circle-insert failure, already-member no-consume, privilege lockdown,
// explicit search_path, idempotent reapply with legacy-code invalidation and
// data preservation, and the create-circle Edge Function API contract shared
// with the frontend lane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const schemaSql = read("supabase/schema.sql");
const multiCircleSql = read("supabase/multi-circle.sql");
const hardeningSql = read("supabase/setup-code-security.sql");
const edgeSrc = read("supabase/functions/create-circle/index.ts");
const frontendCircle = read("src/lib/circle.ts");
const frontendSetupCode = read("src/lib/setup-code.ts");

const GROUPED = /^\d{4}-\d{4}-\d{4}-\d{4}$/;
const normalize = (v) => v.replace(/[ \-]/g, "");

// ---------------------------------------------------------------- static ---

test("all three SQL scripts exist and share the hardening block", () => {
    for (const [name, sql] of [
        ["schema.sql", schemaSql],
        ["multi-circle.sql", multiCircleSql],
        ["setup-code-security.sql", hardeningSql],
    ]) {
        assert.match(
            sql,
            /free360_redeem_setup_code/,
            `${name} defines redemption`,
        );
        assert.match(
            sql,
            /free360_setup_rate_limit/,
            `${name} defines rate limiting`,
        );
        assert.match(
            sql,
            /1150000000000000000/,
            `${name} uses rejection-sampled 16-digit generation`,
        );
        assert.match(
            sql,
            /interval '30 minutes'/,
            `${name} sets 30-minute expiry`,
        );
        assert.match(
            sql,
            /set search_path = ''/,
            `${name} pins an explicit search_path`,
        );
    }
});

test("legacy creation RPC grants nobody; redemption is service-only", () => {
    for (const [name, sql] of [
        ["schema.sql", schemaSql],
        ["multi-circle.sql", multiCircleSql],
    ]) {
        assert.doesNotMatch(
            sql,
            /grant execute[^;]*free360_create_circle[^;]*to authenticated/,
            `${name} never grants legacy creation to authenticated`,
        );
        assert.match(
            sql,
            /revoke all on function public\.free360_create_circle\(uuid, text\) from public, anon, authenticated/,
            `${name} revokes legacy creation`,
        );
    }
    assert.match(
        hardeningSql,
        /grant execute on function public\.free360_redeem_setup_code\(uuid, uuid, text\) to service_role/,
        "redemption granted to service_role",
    );
    assert.doesNotMatch(
        hardeningSql,
        /grant execute[^;]*free360_setup_rate_limit/,
        "rate limiter granted to nobody",
    );
    assert.doesNotMatch(
        hardeningSql,
        /grant execute[^;]*free360_new_setup_code/,
        "generator granted to nobody (admin-only)",
    );
});

test("legacy outstanding codes are invalidated ONCE and safely", () => {
    assert.match(
        hardeningSql,
        /where expires_at is null/,
        "invalidation touches only pre-expiry rows",
    );
    assert.match(
        hardeningSql,
        /expires_at = now\(\) - interval '1 second' where expires_at is null/,
        "legacy rows expire immediately",
    );
});

test("redemption returns statuses instead of raising (counters commit)", () => {
    const body = hardeningSql.match(
        /create or replace function public\.free360_redeem_setup_code[\s\S]*?^\$\$;/m,
    );
    assert.ok(body, "redeem body extractable");
    assert.doesNotMatch(
        body[0],
        /raise\s+(exception|notice)/i,
        "no raise in redemption path",
    );
    for (const s of [
        "ok",
        "invalid",
        "expired",
        "used",
        "rate_limited_user",
        "rate_limited_global",
        "already_member",
        "invalid_request",
    ]) {
        assert.match(body[0], new RegExp(`return '${s}'`), `returns '${s}'`);
    }
});

test("server normalization matches the frontend contract (spaces/hyphens only)", () => {
    assert.match(
        hardeningSql,
        new RegExp(String.raw`regexp_replace\(v_raw, '\[ \\\-\]', '', 'g'`),
        "SQL strips spaces/hyphens",
    );
    assert.match(
        frontendSetupCode,
        /\/\[ \\\-\]\/g/,
        "frontend strips the same separators",
    );
});

test("create-circle Edge Function honors the API contract", () => {
    assert.match(
        frontendCircle,
        /functions\.invoke\('create-circle'/,
        "frontend invokes create-circle",
    );
    for (const needle of [
        "getUser",
        "Bearer ",
        "p_user: user.id",
        "free360_redeem_setup_code",
        "{ ok: true }",
        "401",
        "400",
        "429",
        "409",
        "--no-verify-jwt",
    ]) {
        assert.match(
            edgeSrc,
            new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
            `edge function contains ${needle}`,
        );
    }
    assert.doesNotMatch(
        edgeSrc,
        /p_user:\s*(body|record)/,
        "never uses a client-supplied user id",
    );
    assert.doesNotMatch(
        edgeSrc,
        /record\.userId|body\.user/i,
        "no client identity field read",
    );
    assert.doesNotMatch(
        edgeSrc,
        /headers\.get\(\s*['"]x-/i,
        "never reads spoofable IP headers",
    );
    assert.doesNotMatch(edgeSrc, /console\./, "logs nothing secret");
});

// ------------------------------------------------------------- integration ---

const SETUP_SQL = [schemaSql, multiCircleSql, hardeningSql];
const MOCK_SQL = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
-- Mirror production, where the realtime publication always exists.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'uid') then
    execute 'create function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;`;

function esc(v) {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
}

async function pgliteBackend() {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    await db.exec(MOCK_SQL);
    for (let sql of SETUP_SQL) {
        sql = sql.replace(/^begin;$/gim, "").replace(/^commit;$/gim, "");
        await db.exec(sql);
    }
    return {
        kind: "pglite",
        q: async (sql, params = []) =>
            (await db.query(sql, params)).rows.map((r) => Object.values(r)),
        apply: async (sql) =>
            db.exec(sql.replace(/^begin;$/gim, "").replace(/^commit;$/gim, "")),
        close: async () => db.close(),
    };
}

function psqlBackend(url) {
    const run = (sql) => {
        const r = spawnSync(
            "psql",
            [url, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "\t", "-c", sql],
            { encoding: "utf8" },
        );
        if (r.status !== 0)
            throw new Error(`psql failed: ${(r.stderr || "").slice(0, 500)}`);
        return (r.stdout || "")
            .split("\n")
            .filter((l) => l.length > 0)
            .map((l) => l.split("\t"));
    };
    const runFile = (sql) => {
        const r = spawnSync(
            "psql",
            [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", "/dev/stdin"],
            { input: sql, encoding: "utf8" },
        );
        if (r.status !== 0)
            throw new Error(
                `psql script failed: ${(r.stderr || "").slice(0, 500)}`,
            );
    };
    runFile(MOCK_SQL);
    for (const sql of SETUP_SQL) runFile(sql);
    return {
        kind: "psql",
        q: async (sql, params = []) => {
            let s = sql;
            for (let i = params.length; i >= 1; i--)
                s = s.split(`$${i}`).join(esc(params[i - 1]));
            return run(s);
        },
        apply: async (sql) => runFile(sql),
        close: async () => {},
    };
}

let db = null;
const backendKind = await (async () => {
    try {
        db = await pgliteBackend();
        return "pglite";
    } catch (e) {
        console.log(`pglite unavailable: ${e.message?.slice(0, 200) ?? e}`);
        db = null;
    }
    if (process.env.SETUP_TESTS_LIVE === "1" && process.env.TEST_DATABASE_URL) {
        db = psqlBackend(process.env.TEST_DATABASE_URL);
        return "psql-live";
    }
    return null;
})();

const it = (name, fn) =>
    test(
        name,
        {
            skip: !db
                ? "no PostgreSQL backend (install @electric-sql/pglite or set SETUP_TESTS_LIVE=1 + TEST_DATABASE_URL)"
                : undefined,
        },
        fn,
    );
const val = async (sql, params) => (await db.q(sql, params))[0][0];
const redeem = (u, c, code) =>
    val("select public.free360_redeem_setup_code($1,$2,$3)", [u, c, code]);
const newUser = async () => {
    const id = randomUUID();
    await db.q("insert into auth.users(id) values ($1)", [id]);
    return id;
};
const resetRates = () => db.q("delete from public.free360_setup_rate_limits");

test("integration backend availability", () => {
    console.log(`backend: ${backendKind ?? "static-only"}`);
});

it("generator: grouped format, leading zeros, uniqueness, 30-minute expiry", async () => {
    const rows = await db.q(
        "select public.free360_new_setup_code() from generate_series(1,150)",
    );
    const codes = rows.map((r) => String(r[0]));
    assert.equal(
        codes.filter((c) => !GROUPED.test(c)).length,
        0,
        "all grouped XXXX-XXXX-XXXX-XXXX",
    );
    assert.equal(new Set(codes).size, codes.length, "all distinct");
    assert.ok(
        codes.some((c) => c.startsWith("0")),
        "leading zeros preserved (text, not number)",
    );
    assert.ok(
        codes.every((c) => normalize(c).length === 16),
        "normalize to 16 digits",
    );
    assert.equal(
        String(
            await val(
                `select (min(expires_at) - min(created_at)) = interval '30 minutes' from public.free360_setup`,
            ),
        ),
        "true",
        "30-minute expiry",
    );
});

it("storage is hash-only: typed columns, matching sha256, no plaintext", async () => {
    const cols = await db.q(
        `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='free360_setup'`,
    );
    const types = Object.fromEntries(
        cols.map(([n, t]) => [String(n), String(t)]),
    );
    assert.deepEqual(
        Object.keys(types).sort(),
        [
            "consumed_at",
            "consumed_by",
            "created_at",
            "expires_at",
            "secret_hash",
        ],
        "expected columns only",
    );
    assert.equal(types.secret_hash, "bytea", "hash column is bytea");
    assert.ok(
        !Object.values(types).some((t) => t.includes("char") || t === "text"),
        "no text column can hold plaintext",
    );
    const code = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    const digits = normalize(code);
    const expected = createHash("sha256").update(digits, "utf8").digest("hex");
    assert.equal(
        String(
            await val(
                `select encode(secret_hash,'hex') from public.free360_setup limit 1`,
            ),
        ).length,
        64,
        "hashes are 32 bytes",
    );
    assert.equal(
        Number(
            await val(
                `select count(*) from public.free360_setup where secret_hash = decode($1,'hex')`,
                [expected],
            ),
        ),
        1,
        "stored hash equals sha256(digits)",
    );
    assert.equal(
        Number(
            await val(
                `select count(*) from public.free360_setup where encode(secret_hash,'hex') like '%' || $1 || '%'`,
                [digits],
            ),
        ),
        0,
        "no hash hex contains the plaintext digits",
    );
});

it("redeem lifecycle: ok once, then used; expired; invalid; separators; overlong", async () => {
    await resetRates();
    const u = await newUser();
    const code = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    assert.equal(await redeem(u, randomUUID(), code), "ok", "first redeem ok");
    assert.equal(
        Number(
            await val(
                "select count(*) from public.free360_circles where id = (select circle_id from public.free360_members where user_id = $1)",
                [u],
            ),
        ),
        1,
        "circle + membership created",
    );
    assert.equal(
        await redeem(await newUser(), randomUUID(), code),
        "used",
        "second redeem used",
    );
    const u2 = await newUser();
    const exp = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    await db.q(
        `update public.free360_setup set expires_at = now() - interval '1 minute' where secret_hash = sha256(convert_to($1,'UTF8'))`,
        [normalize(exp)],
    );
    assert.equal(
        await redeem(u2, randomUUID(), exp),
        "expired",
        "past-expiry code expired",
    );
    assert.equal(
        await redeem(await newUser(), randomUUID(), "0000000000000000"),
        "invalid",
        "unknown digits invalid",
    );
    for (const bad of [
        "",
        "not-a-code",
        "123",
        "123456789012345",
        "12345678901234567",
        "1234-5678-9012-345X",
    ]) {
        assert.equal(
            await redeem(await newUser(), randomUUID(), bad),
            "invalid",
            `malformed ${JSON.stringify(bad)} invalid`,
        );
    }
    const spaced = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    ).replace(/-/g, " ");
    assert.equal(
        await redeem(await newUser(), randomUUID(), `  ${spaced}  `),
        "ok",
        "spaces/dashes normalize",
    );
    assert.equal(
        await redeem(await newUser(), randomUUID(), "1".repeat(65)),
        "invalid",
        "overlong input invalid",
    );
});

it("rate limits persist per user, reset with window, global backstop caps cycling", async () => {
    await resetRates();
    const u = await newUser();
    const cid = randomUUID();
    const seen = [];
    for (let i = 0; i < 12; i++)
        seen.push(await redeem(u, cid, "0000000000000000"));
    assert.deepEqual(
        seen.slice(0, 10),
        Array(10).fill("invalid"),
        "first 10 attempts counted as invalid",
    );
    assert.deepEqual(
        seen.slice(10),
        ["rate_limited_user", "rate_limited_user"],
        "then user-limited",
    );
    assert.ok(
        Number(
            await val(
                `select count from public.free360_setup_rate_limits where bucket = 'user:' || $1`,
                [u],
            ),
        ) >= 12,
        "counter committed on rejections",
    );
    await db.q(
        `update public.free360_setup_rate_limits set window_start = now() - interval '11 minutes' where bucket = 'user:' || $1`,
        [u],
    );
    assert.equal(
        await redeem(u, cid, "0000000000000000"),
        "invalid",
        "new window admits again",
    );
    await resetRates();
    for (let i = 0; i < 21; i++) {
        const v = await newUser();
        for (let j = 0; j < 10; j++)
            await redeem(v, randomUUID(), "0000000000000000");
    }
    const fresh = await newUser();
    const probe = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    assert.equal(
        await redeem(fresh, randomUUID(), probe),
        "rate_limited_global",
        "aggregate guesses capped project-wide",
    );
    await resetRates();
});

it("concurrent redemption of one code yields exactly one ok", async () => {
    await resetRates();
    const code = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    const a = await newUser();
    const b = await newUser();
    const [ra, rb] = await Promise.all([
        redeem(a, randomUUID(), code),
        redeem(b, randomUUID(), code),
    ]);
    assert.deepEqual([ra, rb].sort(), ["ok", "used"], "atomic consume");
});

it("failed circle insert rolls back the consume; member double-redeem keeps code", async () => {
    await resetRates();
    const owner = await newUser();
    const c1 = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    const circleId = randomUUID();
    assert.equal(await redeem(owner, circleId, c1), "ok", "setup circle");
    const other = await newUser();
    const c2 = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    assert.equal(
        await redeem(other, circleId, c2),
        "invalid_request",
        "duplicate circle id rejected",
    );
    const third = await newUser();
    assert.equal(
        await redeem(third, randomUUID(), c2),
        "ok",
        "unconsumed code stays valid",
    );
    const c3 = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    assert.equal(
        await redeem(owner, randomUUID(), c3),
        "already_member",
        "member rejected without consuming",
    );
    const fourth = await newUser();
    assert.equal(
        await redeem(fourth, randomUUID(), c3),
        "ok",
        "spared code redeemable",
    );
});

it("privileges locked down and search_path explicit", async () => {
    const priv = (role, fn) =>
        val(`select has_function_privilege($1,$2,'execute')::text`, [role, fn]);
    assert.equal(
        await priv("authenticated", "public.free360_create_circle(uuid,text)"),
        "false",
        "legacy RPC closed to authenticated",
    );
    assert.equal(
        await priv("anon", "public.free360_create_circle(uuid,text)"),
        "false",
        "legacy RPC closed to anon",
    );
    assert.equal(
        await priv(
            "authenticated",
            "public.free360_redeem_setup_code(uuid,uuid,text)",
        ),
        "false",
        "redemption closed to authenticated",
    );
    assert.equal(
        await priv("anon", "public.free360_redeem_setup_code(uuid,uuid,text)"),
        "false",
        "redemption closed to anon",
    );
    assert.equal(
        await priv(
            "service_role",
            "public.free360_redeem_setup_code(uuid,uuid,text)",
        ),
        "true",
        "redemption open to service_role",
    );
    assert.equal(
        await priv(
            "service_role",
            "public.free360_setup_rate_limit(text,integer,interval)",
        ),
        "false",
        "rate helper internal-only",
    );
    assert.equal(
        await priv("authenticated", "public.free360_new_setup_code()"),
        "false",
        "generator admin-only",
    );
    const tbl = (role, t) =>
        val(`select has_table_privilege($1,$2,'select')::text`, [role, t]);
    assert.equal(
        await tbl("authenticated", "public.free360_setup"),
        "false",
        "setup table unreadable",
    );
    assert.equal(
        await tbl("authenticated", "public.free360_setup_rate_limits"),
        "false",
        "rate table unreadable",
    );
    assert.equal(
        Number(
            await val(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'free360\\_%'
    and (p.proconfig is null or not (p.proconfig::text like '%search_path=%'))`),
        ),
        0,
        "every free360 function pins search_path",
    );
});

it("reapply is idempotent: legacy codes die once, data and fresh codes survive", async () => {
    await resetRates();
    const keeper = await newUser();
    const keepCode = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    const keepCircle = randomUUID();
    assert.equal(
        await redeem(keeper, keepCircle, keepCode),
        "ok",
        "pre-reapply redeem",
    );
    const before = await db.q(
        "select (select count(*) from public.free360_circles)::text as c, (select count(*) from public.free360_members)::text as m, (select count(*) from public.free360_setup)::text as s",
    );
    for (const sql of SETUP_SQL) await db.apply(sql);
    const fresh = String(
        (await db.q("select public.free360_new_setup_code()"))[0][0],
    );
    const freshUser = await newUser();
    assert.equal(
        await redeem(freshUser, randomUUID(), fresh),
        "ok",
        "post-reapply code works",
    );
    const after = await db.q(
        "select (select count(*) from public.free360_circles)::text as c, (select count(*) from public.free360_members)::text as m",
    );
    assert.ok(
        Number(after[0][0]) >= Number(before[0][0]) + 1,
        "circles preserved and added",
    );
    assert.ok(
        Number(after[0][1]) >= Number(before[0][1]) + 1,
        "members preserved and added",
    );
    assert.equal(
        await redeem(await newUser(), randomUUID(), keepCode),
        "used",
        "consumed code stays consumed, not resurrected",
    );
    assert.equal(
        String(
            await val(`select is_nullable from information_schema.columns
    where table_schema='public' and table_name='free360_setup' and column_name='expires_at'`),
        ),
        "NO",
        "expires_at NOT NULL: every new row carries expiry, so reapply can never invalidate fresh codes",
    );
});
