import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { createUser, validateRegistration } from "@/lib/storage";

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo crear la cuenta." },
      { status: 400 },
    );
  }
}
