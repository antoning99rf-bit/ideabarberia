import { NextRequest, NextResponse } from "next/server";
import {
  addBlockedSlot,
  deleteBlockedSlot,
  getAvailability,
  getDefaultTimeSlots,
  getWorkingHours,
  listBlockedSlots,
} from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(request: NextRequest) {
  return request.headers.get("x-admin-password") === (process.env.ADMIN_PASSWORD || "admin123");
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const admin = request.nextUrl.searchParams.get("admin") === "1";

  if (admin) {
    if (!isAdmin(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const [blockedSlots, availability, workingHours] = await Promise.all([
      listBlockedSlots(),
      date ? getAvailability(date) : Promise.resolve(null),
      getWorkingHours(),
    ]);

    return NextResponse.json({
      blockedSlots,
      slots: getDefaultTimeSlots(),
      workingHours,
      availability,
    });
  }

  if (!date) {
    return NextResponse.json({ error: "Falta fecha." }, { status: 400 });
  }

  return NextResponse.json(await getAvailability(date));
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const blockedSlot = await addBlockedSlot(await request.json());
    return NextResponse.json({ blockedSlot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo bloquear la hora." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id." }, { status: 400 });

  await deleteBlockedSlot(id);
  return NextResponse.json({ ok: true });
}
