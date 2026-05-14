import { NextRequest, NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const input = await request.json().catch(() => ({}));
  const token = String(input.token || "");
  const password = String(input.password || "");

  if (!token) {
    return NextResponse.json({ error: "Enlace invalido." }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "La contrasena debe tener al menos 6 caracteres." },
      { status: 400 },
    );
  }

  const ok = await resetPasswordWithToken(token, password);
  if (!ok) {
    return NextResponse.json(
      { error: "El enlace ha caducado o ya se ha utilizado." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
