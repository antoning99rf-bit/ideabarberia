import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { findUserByCredentials, getPublicStorageError } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const user = await findUserByCredentials(input.email || "", input.password || "");

    if (!user) {
      return NextResponse.json({ error: "Email o contrasena incorrectos." }, { status: 401 });
    }

    return NextResponse.json({
      user,
      token: createSessionToken(user),
    });
  } catch (error) {
    const publicError = getPublicStorageError(error, "No se pudo iniciar sesion.");
    return NextResponse.json(
      { error: publicError.message },
      { status: publicError.status },
    );
  }
}
