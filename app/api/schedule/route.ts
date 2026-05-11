import { NextRequest, NextResponse } from "next/server";
import { getWorkingHours, saveWorkingHours } from "@/lib/storage";
import type { WorkingDay } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(request: NextRequest) {
  return request.headers.get("x-admin-password") === (process.env.ADMIN_PASSWORD || "admin123");
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  return NextResponse.json({ workingHours: await getWorkingHours() });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const input = (await request.json()) as { workingHours?: WorkingDay[] };
  if (!Array.isArray(input.workingHours)) {
    return NextResponse.json({ error: "Horario invalido." }, { status: 400 });
  }

  return NextResponse.json({ workingHours: await saveWorkingHours(input.workingHours) });
}
