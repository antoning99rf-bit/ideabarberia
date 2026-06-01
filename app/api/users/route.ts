import { NextRequest, NextResponse } from "next/server";
import { sendUserBlockStatusEmail } from "@/lib/email";
import { listUsers, setUserBlocked } from "@/lib/storage";
import type { IntegrationResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(request: NextRequest) {
  return request.headers.get("x-admin-password") === (process.env.ADMIN_PASSWORD || "admin123");
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  return NextResponse.json({ users: await listUsers() });
}

export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const input = await request.json();
  if (!input.userId || typeof input.blocked !== "boolean") {
    return NextResponse.json({ error: "Solicitud invalida." }, { status: 400 });
  }

  const user = await setUserBlocked({
    userId: input.userId,
    blocked: input.blocked,
    reason: input.reason,
  });

  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
  }

  const integrations: IntegrationResult[] = [];
  try {
    const email = await sendUserBlockStatusEmail({
      email: user.email,
      name: user.name,
      blocked: input.blocked,
      reason: user.blockedReason,
    });
    integrations.push({ name: "email", ...email });
  } catch (error) {
    integrations.push({
      name: "email",
      ok: false,
      detail: error instanceof Error ? error.message : "No se pudo enviar email.",
    });
  }

  return NextResponse.json({ user, users: await listUsers(), integrations });
}
