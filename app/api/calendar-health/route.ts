import { NextRequest, NextResponse } from "next/server";
import {
  createCalendarEvent,
  deleteCalendarEventForReservation,
  getCalendarEventSync,
  hasGoogleCalendarConfig,
  listCalendarBusyRanges,
} from "@/lib/reservations";
import type { Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(request: NextRequest) {
  return request.headers.get("x-admin-password") === (process.env.ADMIN_PASSWORD || "admin123");
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") || "2026-07-29";
  const writeTest = request.nextUrl.searchParams.get("write") === "1";

  if (!hasGoogleCalendarConfig()) {
    return NextResponse.json({
      ok: false,
      config: false,
      error: "Google Calendar no configurado.",
    });
  }

  const checks: Record<string, unknown> = {
    config: true,
    timeZone: process.env.TIME_ZONE || "Atlantic/Canary",
  };

  try {
    const busyRanges = await listCalendarBusyRanges(date);
    checks.readBusyRanges = true;
    checks.busyRangesCount = busyRanges.length;

    if (writeTest) {
      const reservation: Reservation = {
        id: `calendar-health-${Date.now()}`,
        userId: "calendar-health",
        name: "TEST Codex",
        phone: "+34000000000",
        email: "test@codex.local",
        service: "Prueba Calendar",
        price: 0,
        durationMinutes: 15,
        calendarEventId: null,
        seriesId: null,
        seriesIndex: null,
        date,
        time: "08:00",
        status: "Prueba",
        createdAt: new Date().toISOString(),
      };

      const created = await createCalendarEvent(reservation);
      checks.createEvent = created.ok;
      checks.createdEventId = Boolean(created.eventId);

      if (created.eventId) {
        reservation.calendarEventId = created.eventId;
        const sync = await getCalendarEventSync(created.eventId);
        checks.readCreatedEvent = sync.exists;
        checks.createdEventSchedule = sync.schedule;

        const deleted = await deleteCalendarEventForReservation(reservation);
        checks.deleteEvent = deleted.ok;
      }
    }

    return NextResponse.json({ ok: true, checks });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        checks,
        error: error instanceof Error ? error.message : "Error comprobando Google Calendar.",
      },
      { status: 500 },
    );
  }
}
