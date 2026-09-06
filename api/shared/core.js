// Shared logic for all API functions (classic v3 programming model:
// handlers receive (context, req) and set context.res).

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

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json" },
    body,
  };
}

function getBearer(req) {
  // SWA's edge replaces the standard Authorization header before requests
  // reach managed functions, so the client sends our token in a custom
  // header instead. Authorization remains as a fallback for local dev.
  const headers = req.headers || {};
  const custom = headers["x-vidaivi-auth"] || headers["X-Vidaivi-Auth"] || "";
  if (custom) return custom.startsWith("Bearer ") ? custom.slice(7) : custom;
  const header = headers.authorization || headers.Authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.rawBody || req.body || "{}");
  } catch {
    return {};
  }
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
    await tableClient("teachers").getEntity("teacher", normalized);
    return "teacher";
  } catch {
    return "parent";
  }
}

// ---------- Sessions (students and admins) ----------

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

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
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
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 16) || "student"
  );
}

// ---------- Unified caller identity ----------

async function identify(req) {
  const bearer = getBearer(req);
  if (!bearer) return { reason: "no_bearer_token" };
  if (bearer.startsWith("vst.")) {
    if (!SESSION_SECRET) return { reason: "no_session_secret_configured" };
    const session = verifySession("vst", bearer);
    if (!session) return { reason: "bad_student_token" };
    return { kind: "student", id: `stu~${session.username}`, username: session.username };
  }
  if (bearer.startsWith("vad.")) {
    if (!SESSION_SECRET) return { reason: "no_session_secret_configured" };
    const session = verifySession("vad", bearer);
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

function misconfigured(context) {
  if (!STORAGE || !GOOGLE_CLIENT_ID) {
    json(context, 500, { error: "API not configured" });
    return true;
  }
  return false;
}

// ---------- Handlers ----------

const handlers = {};

handlers.health = async (context) => {
  json(context, 200, {
    hasGoogleClientId: !!GOOGLE_CLIENT_ID,
    hasStorageConnectionString: !!STORAGE,
    hasSessionSecret: !!SESSION_SECRET,
    hasAdminCredentials: !!(ADMIN_USERNAME && ADMIN_PASSWORD),
    teacherEmailsConfigured: TEACHER_EMAILS.length,
    model: "v3",
    node: process.version,
  });
};

handlers.login = async (context, req) => {
  if (misconfigured(context)) return;
  const { token, reason } = await verifyGoogleToken(getBearer(req));
  if (!token) return json(context, 401, { error: "Invalid token", reason });

  const body = getBody(req);
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
  json(context, 200, {
    sub: merged.rowKey,
    name: merged.name,
    email: merged.email,
    picture: merged.picture,
    phone: merged.phone,
    role: await resolveRole(token.email),
  });
};

handlers.studentlogin = async (context, req) => {
  if (misconfigured(context)) return;
  if (!SESSION_SECRET) {
    return json(context, 500, { error: "API not configured", reason: "no_session_secret" });
  }
  const body = getBody(req);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!username || !password) {
    return json(context, 400, { error: "Username and password required" });
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
    return json(context, 401, { error: "Wrong username or password" });
  }
  json(context, 200, {
    token: signSession("vst", username, STUDENT_TOKEN_TTL_MS),
    student: {
      username,
      name: entity.name,
      school: entity.school,
      grade: entity.grade,
    },
  });
};

handlers.adminlogin = async (context, req) => {
  if (misconfigured(context)) return;
  if (!SESSION_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return json(context, 500, { error: "API not configured", reason: "no_admin_credentials" });
  }
  const body = getBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
    return json(context, 401, { error: "Wrong username or password" });
  }
  json(context, 200, { token: signSession("vad", username, ADMIN_TOKEN_TTL_MS) });
};

handlers.teachers = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "admin") return json(context, 403, { error: "Admins only" });

  const teachers = tableClient("teachers");
  await ensureTable(teachers);

  if (req.method === "POST") {
    const body = getBody(req);
    const action = body.action || "add";
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(context, 400, { error: "Enter a valid email address" });
    }
    if (action === "remove") {
      try {
        await teachers.deleteEntity("teacher", email);
      } catch {}
      return json(context, 200, { ok: true });
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
    return json(context, 200, { ok: true });
  }

  const list = [];
  const iter = teachers.listEntities({
    queryOptions: { filter: `PartitionKey eq 'teacher'` },
  });
  for await (const e of iter) {
    list.push({ email: e.rowKey, addedAt: e.addedAt });
    if (list.length >= 200) break;
  }
  list.sort((a, b) => a.email.localeCompare(b.email));
  json(context, 200, { teachers: list });
};

handlers.students = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }
  const students = tableClient("students");
  await ensureTable(students);

  if (req.method === "POST") {
    const body = getBody(req);
    const action = body.action || "create";

    if (action === "remove") {
      const username = String(body.username || "").trim().toLowerCase();
      let entity;
      try {
        entity = await students.getEntity("student", username);
      } catch {
        return json(context, 404, { error: "Student not found" });
      }
      if (entity.teacherSub !== who.id) {
        return json(context, 403, { error: "Not your student" });
      }
      // Remove the student's attempt history too, so no orphan rows are left
      // pointing at a login that no longer exists.
      const attempts = tableClient("attempts");
      await ensureTable(attempts);
      let removedAttempts = 0;
      try {
        const iter = attempts.listEntities({
          queryOptions: { filter: `PartitionKey eq 'stu~${username.replace(/'/g, "''")}'` },
        });
        for await (const a of iter) {
          await attempts.deleteEntity(a.partitionKey, a.rowKey);
          removedAttempts++;
        }
      } catch {
        // Best effort: the student record still goes, below.
      }
      await students.deleteEntity("student", username);
      return json(context, 200, { ok: true, username, removedAttempts });
    }

    if (action === "reset") {
      const username = String(body.username || "").trim().toLowerCase();
      let entity;
      try {
        entity = await students.getEntity("student", username);
      } catch {
        return json(context, 404, { error: "Student not found" });
      }
      if (entity.teacherSub !== who.id) {
        return json(context, 403, { error: "Not your student" });
      }
      const password = generatePassword();
      entity.passwordHash = hashPassword(password);
      await students.upsertEntity(entity, "Merge");
      return json(context, 200, { username, password });
    }

    const name = String(body.name || "").trim().slice(0, 60);
    const school = String(body.school || "").trim().slice(0, 80);
    const grade = String(body.grade || "").trim().slice(0, 20);
    const parentPhone = String(body.parentPhone || "").trim().slice(0, 20);
    if (!name) return json(context, 400, { error: "Name required" });

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
      return json(context, 500, { error: "Could not allocate username, try again" });
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
      teacherEmail: who.email || "",
      createdAt: new Date().toISOString(),
    });
    return json(context, 201, { username, password, name, school, grade, parentPhone });
  }

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
  json(context, 200, { students: list });
};

// Teacher/admin: attempts for one of their students (?username=...) or all.
handlers.reports = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }
  const students = tableClient("students");
  const attempts = tableClient("attempts");
  await ensureTable(students);
  await ensureTable(attempts);

  const wanted = String((req.query && req.query.username) || "").trim().toLowerCase();

  // Collect this teacher's students (optionally just one).
  const roster = [];
  const iter = students.listEntities({
    queryOptions: { filter: `PartitionKey eq 'student' and teacherSub eq '${who.id.replace(/'/g, "''")}'` },
  });
  for await (const e of iter) {
    if (wanted && e.rowKey !== wanted) continue;
    roster.push({
      username: e.rowKey,
      name: e.name,
      school: e.school,
      grade: e.grade,
      parentPhone: e.parentPhone,
    });
    if (roster.length >= 200) break;
  }
  if (wanted && !roster.length) {
    return json(context, 404, { error: "Student not found" });
  }

  // Attach each student's attempts (newest first via inverted-time row keys).
  for (const s of roster) {
    s.attempts = [];
    const aIter = attempts.listEntities({
      queryOptions: { filter: `PartitionKey eq 'stu~${s.username.replace(/'/g, "''")}'` },
    });
    for await (const a of aIter) {
      s.attempts.push({
        testId: a.testId,
        score: a.score,
        total: a.total,
        completedAt: a.completedAt,
      });
      if (s.attempts.length >= 100) break;
    }
  }
  roster.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  json(context, 200, { students: roster });
};

// ---------- Tests (DB-backed; Phase 1 of the product plan) ----------
//
// Table "tests": PK "test", RK = test id. Questions are stored as JSON
// chunked across qc0..qcN string properties (Table Storage caps one string
// property at 64KB). Taxonomy fields (board/klass/subject) are stored from
// day one even though the UI is fixed to CBSE/12/Maths for now.

const TEST_STATUSES = ["draft", "published", "archived"];
const Q_CHUNK = 30000;

function chunkQuestions(entity, questions) {
  const raw = JSON.stringify(questions);
  const count = Math.max(1, Math.ceil(raw.length / Q_CHUNK));
  for (let i = 0; i < count; i++) {
    entity[`qc${i}`] = raw.slice(i * Q_CHUNK, (i + 1) * Q_CHUNK);
  }
  entity.chunkCount = count;
}

function unchunkQuestions(entity) {
  let raw = "";
  for (let i = 0; i < (entity.chunkCount || 0); i++) raw += entity[`qc${i}`] || "";
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function validateQuestions(input) {
  if (!Array.isArray(input) || !input.length || input.length > 60) {
    return { error: "Provide between 1 and 60 questions" };
  }
  const out = [];
  const seen = new Set();
  for (const q of input) {
    if (!q || typeof q !== "object") return { error: "Bad question entry" };
    const id = String(q.id || "").trim().slice(0, 40);
    const type = q.type;
    if (!id || seen.has(id)) return { error: `Question ids must be unique (${id || "missing"})` };
    seen.add(id);
    if (!["mcq", "numeric", "long"].includes(type)) return { error: `Unknown question type: ${type}` };
    if (typeof q.q !== "string" || !q.q.trim()) return { error: `Question ${id}: text required` };
    if (typeof q.solution !== "string" || !q.solution.trim()) return { error: `Question ${id}: solution required` };
    const marks = Number(q.marks);
    if (!Number.isFinite(marks) || marks < 1 || marks > 20) return { error: `Question ${id}: marks must be 1-20` };
    const clean = {
      id,
      chapter: String(q.chapter || "").slice(0, 60),
      topic: String(q.topic || "").slice(0, 60),
      type,
      q: String(q.q).slice(0, 4000),
      solution: String(q.solution).slice(0, 8000),
      marks: Math.round(marks),
    };
    if (type === "mcq") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
        return { error: `Question ${id}: mcq needs 2-6 options` };
      }
      clean.options = q.options.map((o) => String(o).slice(0, 500));
      const answer = Number(q.answer);
      if (!Number.isInteger(answer) || answer < 0 || answer >= clean.options.length) {
        return { error: `Question ${id}: answer must index an option` };
      }
      clean.answer = answer;
    } else if (type === "numeric") {
      const answer = Number(q.answer);
      if (!Number.isFinite(answer)) return { error: `Question ${id}: numeric answer required` };
      clean.answer = answer;
      const tol = Number(q.tolerance);
      clean.tolerance = Number.isFinite(tol) && tol >= 0 ? tol : 0;
    }
    out.push(clean);
  }
  return { questions: out };
}

function testMeta(e) {
  const questions = unchunkQuestions(e);
  return {
    id: e.rowKey,
    title: e.title,
    chapter: e.chapter,
    teacher: e.teacher || null,
    order: typeof e.order === "number" ? e.order : 99,
    access: e.access === "open" ? "open" : "login",
    status: e.status,
    platform: !!e.platform,
    ownerSub: e.ownerSub,
    questionCount: questions.length,
    totalMarks: questions.reduce((s, q) => s + (q.marks || 0), 0),
    updatedAt: e.updatedAt,
  };
}

function testFull(e) {
  return { ...testMeta(e), questions: unchunkQuestions(e) };
}

async function studentTeacherSub(username) {
  try {
    const s = await tableClient("students").getEntity("student", username);
    return s.teacherSub || "";
  } catch {
    return "";
  }
}

function canManageTest(who, entity) {
  if (who.role === "admin") return entity.platform || entity.ownerSub === who.id;
  return who.role === "teacher" && entity.ownerSub === who.id;
}

handlers.tests = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });

  const tests = tableClient("tests");
  await ensureTable(tests);
  const isStaff = who.role === "teacher" || who.role === "admin";

  if (req.method === "POST") {
    if (!isStaff) return json(context, 403, { error: "Teachers only" });
    const body = getBody(req);
    const action = body.action || "create";

    if (["publish", "unpublish", "archive", "delete"].includes(action)) {
      const id = String(body.id || "").trim();
      let entity;
      try {
        entity = await tests.getEntity("test", id);
      } catch {
        return json(context, 404, { error: "Test not found" });
      }
      if (!canManageTest(who, entity)) return json(context, 403, { error: "Not your test" });
      if (action === "delete") {
        if (entity.status !== "draft") return json(context, 400, { error: "Only drafts can be deleted — archive instead" });
        await tests.deleteEntity("test", id);
        return json(context, 200, { ok: true });
      }
      entity.status = action === "publish" ? "published" : action === "archive" ? "archived" : "draft";
      entity.updatedAt = new Date().toISOString();
      await tests.updateEntity(entity, "Replace");
      return json(context, 200, { ok: true, status: entity.status });
    }

    if (action !== "create" && action !== "update") {
      return json(context, 400, { error: `Unknown action: ${action}` });
    }
    const t = body.test || {};
    const title = String(t.title || "").trim().slice(0, 120);
    if (!title) return json(context, 400, { error: "Title required" });
    const checked = validateQuestions(t.questions);
    if (checked.error) return json(context, 400, { error: checked.error });

    if (action === "create") {
      let id = String(t.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
      if (!id) id = `${slugify(title)}-${crypto.randomInt(100, 1000)}`;
      try {
        await tests.getEntity("test", id);
        return json(context, 409, { error: `Test id already exists: ${id}` });
      } catch {}
      const entity = {
        partitionKey: "test",
        rowKey: id,
        title,
        chapter: String(t.chapter || "").slice(0, 60),
        teacher: String(t.teacher || "").slice(0, 60),
        order: Number.isFinite(Number(t.order)) ? Number(t.order) : 99,
        access: t.access === "open" ? "open" : "login",
        status: "draft",
        platform: !!t.platform && who.role === "admin",
        ownerSub: who.id,
        ownerEmail: who.email || "",
        board: "CBSE",
        klass: "12",
        subject: "Maths",
        forkedFromId: String(t.forkedFromId || "").slice(0, 60),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      chunkQuestions(entity, checked.questions);
      await tests.createEntity(entity);
      return json(context, 201, { test: testMeta(entity) });
    }

    // update
    const id = String(t.id || "").trim();
    let entity;
    try {
      entity = await tests.getEntity("test", id);
    } catch {
      return json(context, 404, { error: "Test not found" });
    }
    if (!canManageTest(who, entity)) return json(context, 403, { error: "Not your test" });
    // Clear old chunks before writing new ones (Replace drops absent props).
    for (let i = 0; i < (entity.chunkCount || 0); i++) delete entity[`qc${i}`];
    entity.title = title;
    entity.chapter = String(t.chapter || "").slice(0, 60);
    entity.teacher = String(t.teacher || "").slice(0, 60);
    if (Number.isFinite(Number(t.order))) entity.order = Number(t.order);
    if (t.access) entity.access = t.access === "open" ? "open" : "login";
    entity.updatedAt = new Date().toISOString();
    chunkQuestions(entity, checked.questions);
    await tests.updateEntity(entity, "Replace");
    return json(context, 200, { test: testMeta(entity) });
  }

  // GET ?id=... → full test (if visible), GET → metadata list.
  const wantedId = String((req.query && req.query.id) || "").trim();
  const teacherSub = who.kind === "student" ? await studentTeacherSub(who.username) : "";

  function visible(e) {
    if (isStaff) return canManageTest(who, e) || (e.platform && e.status === "published");
    if (e.status !== "published") return false;
    if (e.platform) return true;
    return who.kind === "student" && !!teacherSub && e.ownerSub === teacherSub;
  }

  if (wantedId) {
    let entity;
    try {
      entity = await tests.getEntity("test", wantedId);
    } catch {
      return json(context, 404, { error: "Test not found" });
    }
    if (!visible(entity)) return json(context, 403, { error: "Not available" });
    return json(context, 200, { test: testFull(entity) });
  }

  const list = [];
  const iter = tests.listEntities({ queryOptions: { filter: `PartitionKey eq 'test'` } });
  for await (const e of iter) {
    if (visible(e)) list.push(testMeta(e));
    if (list.length >= 200) break;
  }
  list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  json(context, 200, { tests: list });
};

handlers.attempts = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });

  const attempts = tableClient("attempts");
  await ensureTable(attempts);

  if (req.method === "POST") {
    const body = getBody(req);
    if (
      !body ||
      typeof body.testId !== "string" ||
      typeof body.score !== "number" ||
      typeof body.total !== "number"
    ) {
      return json(context, 400, { error: "Bad attempt payload" });
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
    return json(context, 201, { ok: true });
  }

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
  json(context, 200, { attempts: list });
};

module.exports = { handlers };
