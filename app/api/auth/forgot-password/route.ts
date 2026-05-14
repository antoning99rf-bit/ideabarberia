import { NextRequest, NextResponse } from "next/server";
import { getPasswordResetUrl, sendPasswordResetEmail } from "@/lib/email";
import { createPasswordResetToken } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const input = await request.json().catch(() => ({}));
  const email = String(input.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Email invalido." }, { status: 400 });
  }

  const reset = await createPasswordResetToken(email);
  if (reset) {
    const resetUrl = getPasswordResetUrl(reset.token);
    await sendPasswordResetEmail({
      email: reset.user.email,
      name: reset.user.name,
      resetUrl,
    });
  }

  return NextResponse.json({
    ok: true,
    message: "Si existe una cuenta con ese email, recibiras un enlace para cambiar la contrasena.",
  });
}
