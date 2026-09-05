const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");

const STORAGE = process.env.STORAGE_CONNECTION_STRING;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TEACHER_EMAILS = (process.env.TEACHER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const STUDENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

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

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// ---------- Google auth (teachers / parents) ----------

async function verifyGoogleToken(credential) {
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

// Teacher allowlist lives in the "teachers" table (managed from the admin
// dashboard); the TEACHER_EMAILS app setting remains as an optional fallback.
async function resolveRole(email) {
  const normalized = String(email).toLowerCase();
  if (ADMIN_EMAILS.includes(normalized)) return "admin";
  if (TEACHER_EMAILS.includes(normalized)) return "teacher";
  try {
    const teachers = tableClient("teachers");
    await teachers.getEntity("teacher", normalized);
    return "teacher";
  } catch {
    return "parent";
  }
}

// ---------- Student sessions (teacher-issued username/password) ----------

function signSession(prefix, username, ttlMs) {
  const payload = b64url(
    JSON.stringify({ u: username, exp: Date.now() + ttlMs })
  );
  const sig = b64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(`${prefix}.${payload}`).digest()
  );
  return `${prefix}.${payload}.${sig}`;
}

function verifySession(expectedPrefix, token) {
  try {
    const [prefix, payload, sig] = token.split(".");
    if (prefix !== expectedPrefix || !payload || !sig) return null;
    const expected = b64url(
      crypto.createHmac("sha256", SESSION_SECRET).update(`${prefix}.${payload}`).digest()
    );
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.u || data.exp < Date.now()) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}

const signStudentToken = (u) => signSession("vst", u, STUDENT_TOKEN_TTL_MS);
const verifyStudentToken = (t) => verifySession("vst", t);
const signAdminToken = (u) => signSession("vad", u, ADMIN_TOKEN_TTL_MS);
const verifyAdminToken = (t) => verifySession("vad", t);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

const PW_WORDS = [
  "tiger", "lotus", "mango", "cobra", "delta", "gamma", "sigma", "vector",
  "matrix", "prime", "pearl", "coral", "falcon", "comet", "orbit", "pixel",
];

function generatePassword() {
  const w1 = PW_WORDS[crypto.randomInt(PW_WORDS.length)];
  const w2 = PW_WORDS[crypto.randomInt(PW_WORDS.length)];
  const n = crypto.randomInt(10, 100);
  return `${w1}${n}${w2}`;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16) || "student";
}

// ---------- Unified caller identity ----------

// Resolves the Authorization header to either a Google identity or a
// student session. Returns { kind, id, name, email? } or { reason }.
async function identify(request) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!bearer) return { reason: "no_bearer_token" };
  if (bearer.startsWith("vst.")) {
    if (!SESSION_SECRET) return { reason: "no_session_secret_configured" };
    const session = verifyStudentToken(bearer);
    if (!session) return { reason: "bad_student_token" };
    return { kind: "student", id: `stu~${session.username}`, username: session.username };
  }
  if (bearer.startsWith("vad.")) {
    if (!SESSION_SECRET) return { reason: "no_session_secret_configured" };
    const session = verifyAdminToken(bearer);
    if (!session) return { reason: "bad_admin_token" };
    return { kind: "admin", id: `adm~${session.username}`, name: "Admin", role: "admin" };
  }
  const { token, reason } = await verifyGoogleToken(bearer);
  if (!token) return { reason };
  return {
    kind: "google",
    id: token.sub,
    name: token.name || "",
    email: token.email,
    role: await resolveRole(token.email),
  };
}

function configError() {
  if (!STORAGE || !GOOGLE_CLIENT_ID) {
    return { status: 500, jsonBody: { error: "API not configured" } };
  }
  return null;
}

// ---------- Health ----------

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => ({
    status: 200,
    jsonBody: {
      hasGoogleClientId: !!GOOGLE_CLIENT_ID,
      hasStorageConnectionString: !!STORAGE,
      hasSessionSecret: !!SESSION_SECRET,
      hasAdminCredentials: !!(ADMIN_USERNAME && ADMIN_PASSWORD),
      teacherEmailsConfigured: TEACHER_EMAILS.length,
      node: process.version,
    },
  }),
});

// ---------- Google login (teachers / parents) ----------

app.http("login", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    const err = configError();
    if (err) return err;
    const header = request.headers.get("authorization") || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const { token, reason } = await verifyGoogleToken(bearer);
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
    return {
      status: 200,
      jsonBody: {
        sub: merged.rowKey,
        name: merged.name,
        email: merged.email,
        picture: merged.picture,
        phone: merged.phone,
        role: await resolveRole(token.email),
      },
    };
  },
});

// ---------- Student login ----------

app.http("studentLogin", {
  route: "studentlogin",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    const err = configError();
    if (err) return err;
    if (!SESSION_SECRET) {
      return { status: 500, jsonBody: { error: "API not configured", reason: "no_session_secret" } };
    }
    const body = await request.json().catch(() => null);
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!username || !password) {
      return { status: 400, jsonBody: { error: "Username and password required" } };
    }
    const students = tableClient("students");
    await ensureTable(students);
    let entity;
    try {
      entity = await students.getEntity("student", username);
    } catch {
      entity = null;
    }
    if (!entity || !checkPassword(password, entity.passwordHash)) {
      return { status: 401, jsonBody: { error: "Wrong username or password" } };
    }
    return {
      status: 200,
      jsonBody: {
        token: signStudentToken(username),
        student: {
          username,
          name: entity.name,
          school: entity.school,
          grade: entity.grade,
        },
      },
    };
  },
});

// ---------- Admin login (credentials from ADMIN_USERNAME/ADMIN_PASSWORD settings) ----------

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

app.http("adminLogin", {
  route: "adminlogin",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    const err = configError();
    if (err) return err;
    if (!SESSION_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
      return { status: 500, jsonBody: { error: "API not configured", reason: "no_admin_credentials" } };
    }
    const body = await request.json().catch(() => null);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
      return { status: 401, jsonBody: { error: "Wrong username or password" } };
    }
    return { status: 200, jsonBody: { token: signAdminToken(username) } };
  },
});

// ---------- Admin: manage the teacher allowlist ----------

app.http("teachers", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    const err = configError();
    if (err) return err;
    const who = await identify(request);
    if (!who.kind) {
      return { status: 401, jsonBody: { error: "Invalid token", reason: who.reason } };
    }
    if (who.role !== "admin") {
      return { status: 403, jsonBody: { error: "Admins only" } };
    }
    const teachers = tableClient("teachers");
    await ensureTable(teachers);

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      const action = body?.action || "add";
      const email = String(body?.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { status: 400, jsonBody: { error: "Enter a valid email address" } };
      }
      if (action === "remove") {
        try {
          await teachers.deleteEntity("teacher", email);
        } catch {}
        return { status: 200, jsonBody: { ok: true } };
      }
      await teachers.upsertEntity(
        {
          partitionKey: "teacher",
          rowKey: email,
          addedBy: who.id,
          addedAt: new Date().toISOString(),
        },
        "Merge"
      );
      return { status: 200, jsonBody: { ok: true } };
    }

    // GET — list allowlisted teacher emails
    const list = [];
    const iter = teachers.listEntities({
      queryOptions: { filter: `PartitionKey eq 'teacher'` },
    });
    for await (const e of iter) {
      list.push({ email: e.rowKey, addedAt: e.addedAt });
      if (list.length >= 200) break;
    }
    list.sort((a, b) => a.email.localeCompare(b.email));
    return { status: 200, jsonBody: { teachers: list } };
  },
});

// ---------- Teacher: manage students ----------

app.http("students", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    const err = configError();
    if (err) return err;
    const who = await identify(request);
    if (!who.kind) {
      return { status: 401, jsonBody: { error: "Invalid token", reason: who.reason } };
    }
    if (who.role !== "teacher" && who.role !== "admin") {
      return { status: 403, jsonBody: { error: "Teachers only" } };
    }
    const students = tableClient("students");
    await ensureTable(students);

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      const action = body?.action || "create";

      if (action === "reset") {
        const username = String(body?.username || "").trim().toLowerCase();
        let entity;
        try {
          entity = await students.getEntity("student", username);
        } catch {
          return { status: 404, jsonBody: { error: "Student not found" } };
        }
        if (entity.teacherSub !== who.id) {
          return { status: 403, jsonBody: { error: "Not your student" } };
        }
        const password = generatePassword();
        entity.passwordHash = hashPassword(password);
        await students.upsertEntity(entity, "Merge");
        return { status: 200, jsonBody: { username, password } };
      }

      // create
      const name = String(body?.name || "").trim().slice(0, 60);
      const school = String(body?.school || "").trim().slice(0, 80);
      const grade = String(body?.grade || "").trim().slice(0, 20);
      const parentPhone = String(body?.parentPhone || "").trim().slice(0, 20);
      if (!name) return { status: 400, jsonBody: { error: "Name required" } };

      // Unique username: name slug + 2 digits, retry on collision.
      let username = "";
      for (let i = 0; i < 8; i++) {
        const candidate = `${slugify(name)}${crypto.randomInt(10, 100)}`;
        try {
          await students.getEntity("student", candidate);
        } catch {
          username = candidate;
          break;
        }
      }
      if (!username) {
        return { status: 500, jsonBody: { error: "Could not allocate username, try again" } };
      }
      const password = generatePassword();
      await students.createEntity({
        partitionKey: "student",
        rowKey: username,
        name,
        school,
        grade,
        parentPhone,
        passwordHash: hashPassword(password),
        teacherSub: who.id,
        teacherEmail: who.email,
        createdAt: new Date().toISOString(),
      });
      return { status: 201, jsonBody: { username, password, name, school, grade, parentPhone } };
    }

    // GET — list this teacher's students (never returns password hashes)
    const list = [];
    const iter = students.listEntities({
      queryOptions: { filter: `PartitionKey eq 'student' and teacherSub eq '${who.id.replace(/'/g, "''")}'` },
    });
    for await (const e of iter) {
      list.push({
        username: e.rowKey,
        name: e.name,
        school: e.school,
        grade: e.grade,
        parentPhone: e.parentPhone,
        createdAt: e.createdAt,
      });
      if (list.length >= 200) break;
    }
    list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { status: 200, jsonBody: { students: list } };
  },
});

// ---------- Attempts (students and Google users) ----------

app.http("attempts", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request) => {
    const err = configError();
    if (err) return err;
    const who = await identify(request);
    if (!who.kind) {
      return { status: 401, jsonBody: { error: "Invalid token", reason: who.reason } };
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
        partitionKey: who.id,
        rowKey,
        testId: body.testId.slice(0, 80),
        score: Math.max(0, Math.min(10000, Math.round(body.score))),
        total: Math.max(0, Math.min(10000, Math.round(body.total))),
        completedAt,
        name: who.kind === "student" ? who.username : who.name,
        email: who.kind === "google" ? who.email : "",
        kind: who.kind,
      });
      return { status: 201, jsonBody: { ok: true } };
    }

    // GET — own attempts
    const list = [];
    const iter = attempts.listEntities({
      queryOptions: { filter: `PartitionKey eq '${who.id.replace(/'/g, "''")}'` },
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
