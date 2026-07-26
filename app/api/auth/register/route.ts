import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { createUser, getPublicStorageError, validateRegistration } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await request.json();
  const errors = validateRegistration(input);

  if (errors.length) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  try {
    const user = await createUser(input);
    return NextResponse.json({
      user,
      token: createSessionToken(user),
    });
  } catch (error) {
    const publicError = getPublicStorageError(error, "No se pudo crear la cuenta.");
    return NextResponse.json(
      { error: publicError.message },
      { status: publicError.status },
    );
  }
}
