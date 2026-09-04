/**
 * One place where every server-side process gets its Firestore handle.
 *
 * server.ts (the web service) deliberately does NOT use this — it never touches
 * Firestore. The background worker and the cron jobs do, and they run somewhere
 * that has no Application Default Credentials: Render has no `gcloud` login and
 * no GCP metadata server. Without an explicit credential the Admin SDK throws
 * "Could not load the default credentials" the first time you read a collection,
 * and it throws it at read time, not at startup, so the service looks healthy
 * right up until the moment it has work to do.
 *
 * Credential resolution, in order:
 *   1. FIREBASE_SERVICE_ACCOUNT — the service-account JSON key. Accepts the raw
 *      JSON or a base64 copy of it. Prefer base64 on Render: the dashboard's
 *      textarea is happy to eat a newline out of the middle of a private key,
 *      and base64 has no newlines to lose.
 *   2. Application Default Credentials — how this runs on your machine.
 *
 * Project id and database id come from the environment first and from
 * firebase-applet-config.json second, because that file is gitignored and is
 * generated at build time by scripts/setup-firebase-config.cjs.
 */

import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

interface AppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

function readAppletConfig(): AppletConfig {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as AppletConfig;
  } catch {
    // Generated at build time. Absent is fine as long as the env vars are set.
    return {};
  }
}

function parseServiceAccount(raw: string): admin.ServiceAccount {
  const trimmed = raw.trim();
  const text = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (err: any) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not valid JSON (and not valid base64-encoded " +
        `JSON either): ${err.message}. Paste the whole service-account key file, ` +
        "or base64 it first.",
    );
  }

  // A pasted key often arrives with its newlines escaped as the two characters
  // backslash-n. The JWT signer needs real newlines; given the escaped form it
  // fails with an opaque OpenSSL "DECODER routines::unsupported".
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  if (!parsed.private_key || !parsed.client_email) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT parsed, but has no private_key/client_email. " +
        "That usually means the Firebase *web* config was pasted instead of a " +
        "service-account key (Project settings -> Service accounts -> Generate new private key).",
    );
  }

  return parsed as unknown as admin.ServiceAccount;
}

let cachedApp: admin.app.App | null = null;
let cachedDb: Firestore | null = null;

export function initAdmin(): admin.app.App {
  if (cachedApp) return cachedApp;
  if (admin.apps.length > 0) {
    cachedApp = admin.app();
    return cachedApp;
  }

  const config = readAppletConfig();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (raw) {
    const serviceAccount = parseServiceAccount(raw);
    cachedApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId:
        process.env.VITE_FIREBASE_PROJECT_ID ||
        config.projectId ||
        (serviceAccount as { projectId?: string }).projectId,
    });
    return cachedApp;
  }

  console.warn(
    "[firebase-admin] FIREBASE_SERVICE_ACCOUNT is not set. Falling back to " +
      "Application Default Credentials. That works locally; on Render it will " +
      "fail on the first Firestore read.",
  );
  cachedApp = admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || config.projectId,
  });
  return cachedApp;
}

/**
 * The Firestore handle. Named databases matter here: this project does not use
 * "(default)", and getFirestore(app) would silently connect to an empty
 * database rather than error.
 */
export function getDb(): Firestore {
  if (cachedDb) return cachedDb;

  const app = initAdmin();
  const config = readAppletConfig();
  const databaseId =
    process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || config.firestoreDatabaseId;

  if (!databaseId) {
    // The single most expensive silent failure available here. Everything
    // connects, every query succeeds, every result is empty, and nothing
    // anywhere reports a problem.
    console.warn(
      "[firebase-admin] No VITE_FIREBASE_FIRESTORE_DATABASE_ID set and none in " +
        "firebase-applet-config.json. Falling back to the \"(default)\" database, " +
        "which this project does not use - expect every read to come back empty.",
    );
  }

  cachedDb =
    databaseId && databaseId !== "(default)"
      ? getFirestore(app, databaseId)
      : getFirestore(app);

  console.log(
    `[firebase-admin] Firestore ready (project=${app.options.projectId ?? "unknown"}, ` +
      `database=${databaseId || "(default)"}).`,
  );
  return cachedDb;
}
