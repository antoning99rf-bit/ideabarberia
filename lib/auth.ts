import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { User } from "./types";

export type SessionUser = Pick<User, "id" | "name" | "phone" | "email">;

const secret = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || "dev-secret";

function encode(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken(user: SessionUser) {
  const payload = encode({
    ...user,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
  });

  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): SessionUser | null {
  if (!token) return null;

  const [payload, signature] = token.replace("Bearer ", "").split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.exp || parsed.exp < Date.now()) return null;

    return {
      id: parsed.id,
      name: parsed.name,
      phone: parsed.phone,
      email: parsed.email,
    };
  } catch {
    return null;
  }
}
