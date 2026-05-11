import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { findUserByCredentials } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await request.json();
  const user = await findUserByCredentials(input.email || "", input.password || "");

  if (!user) {
    return NextResponse.json({ error: "Email o contrasena incorrectos." }, { status: 401 });
  }

  return NextResponse.json({
    user,
    token: createSessionToken(user),
  });
}
