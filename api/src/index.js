const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");

const STORAGE = process.env.STORAGE_CONNECTION_STRING;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

function tableClient(name) {
  return TableClient.fromConnectionString(STORAGE, name);
}

async function ensureTable(client) {
  try {
    await client.createTable();
  } catch (e) {
    if (e.statusCode !== 409) throw e; // 409 = already exists
  }
}

// Verify a Google ID token. Returns { token } on success or { reason } on
// failure — reasons are codes only, never token contents.
async function verifyGoogleToken(request) {
  const header = request.headers.get("authorization") || "";
  const credential = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!credential) return { reason: "no_bearer_token" };
  if (!GOOGLE_CLIENT_ID) return { reason: "no_client_id_configured" };
  let res;
  try {
    res = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
        encodeURIComponent(credential)
    );
  } catch {
    return { reason: "tokeninfo_unreachable" };
  }
  if (!res.ok) return { reason: `tokeninfo_rejected_${res.status}` };
  const token = await res.json();
  if (token.aud !== GOOGLE_CLIENT_ID) {
    return {
      reason: `aud_mismatch (token aud ...${String(token.aud).slice(-25)} vs configured ...${GOOGLE_CLIENT_ID.slice(-25)})`,
    };
  }
  if (Number(token.exp) * 1000 < Date.now()) return { reason: "expired" };
  if (!token.sub || !token.email) return { reason: "missing_claims" };
  return { token };
}

function publicProfile(entity) {
  return {
    sub: entity.rowKey,
    name: entity.name || "",
    email: entity.email || "",
    picture: entity.picture || "",
    phone: entity.phone || "",
  };
}

// GET /api/health — config presence check (booleans only, never values).
app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => ({
    status: 200,
    jsonBody: {
      hasGoogleClientId: !!GOOGLE_CLIENT_ID,
      hasStorageConnectionString: !!STORAGE,
      node: process.version,
    },
  }),
});

// POST /api/login — verify Google token, upsert profile, optionally set phone.
app.http("login", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!STORAGE || !GOOGLE_CLIENT_ID) {
      return { status: 500, jsonBody: { error: "API not configured" } };
    }
    const { token, reason } = await verifyGoogleToken(request);
    if (!token) {
      return { status: 401, jsonBody: { error: "Invalid token", reason } };
    }

    const body = await request.json().catch(() => ({}));
    const phone =
      typeof body.phone === "string" ? body.phone.trim().slice(0, 20) : "";

    const profiles = tableClient("profiles");
    await ensureTable(profiles);

    let entity;
    try {
      entity = await profiles.getEntity("profile", token.sub);
    } catch {
      entity = null;
    }

    const merged = {
      partitionKey: "profile",
      rowKey: token.sub,
      name: token.name || (entity && entity.name) || "",
      email: token.email,
      picture: token.picture || (entity && entity.picture) || "",
      phone: phone || (entity && entity.phone) || "",
      lastLoginAt: new Date().toISOString(),
      createdAt: (entity && entity.createdAt) || new Date().toISOString(),
    };
    await profiles.upsertEntity(merged, "Merge");
    return { status: 200, jsonBody: publicProfile(merged) };
  },
});

// POST /api/attempts — save a completed attempt for the logged-in student.
// GET  /api/attempts — list the logged-in student's attempts (newest first).
app.http("attempts", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!STORAGE || !GOOGLE_CLIENT_ID) {
      return { status: 500, jsonBody: { error: "API not configured" } };
    }
    const { token, reason } = await verifyGoogleToken(request);
    if (!token) {
      return { status: 401, jsonBody: { error: "Invalid token", reason } };
    }

    const attempts = tableClient("attempts");
    await ensureTable(attempts);

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (
        !body ||
        typeof body.testId !== "string" ||
        typeof body.score !== "number" ||
        typeof body.total !== "number"
      ) {
        return { status: 400, jsonBody: { error: "Bad attempt payload" } };
      }
      const completedAt =
        typeof body.completedAt === "string"
          ? body.completedAt
          : new Date().toISOString();
      // Inverted-time row key so newest attempts sort first in the table.
      const rowKey = `${String(9999999999999 - Date.now())}~${body.testId.slice(0, 80)}`;
      await attempts.createEntity({
        partitionKey: token.sub,
        rowKey,
        testId: body.testId.slice(0, 80),
        score: Math.max(0, Math.min(10000, Math.round(body.score))),
        total: Math.max(0, Math.min(10000, Math.round(body.total))),
        completedAt,
        name: token.name || "",
        email: token.email,
      });
      return { status: 201, jsonBody: { ok: true } };
    }

    // GET
    const list = [];
    const iter = attempts.listEntities({
      queryOptions: { filter: `PartitionKey eq '${token.sub.replace(/'/g, "''")}'` },
    });
    for await (const e of iter) {
      list.push({
        testId: e.testId,
        score: e.score,
        total: e.total,
        completedAt: e.completedAt,
      });
      if (list.length >= 100) break;
    }
    return { status: 200, jsonBody: { attempts: list } };
  },
});
