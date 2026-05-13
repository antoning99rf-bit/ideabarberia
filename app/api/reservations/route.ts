import { NextRequest, NextResponse } from "next/server";
import {
  createCalendarEvent,
  deleteCalendarEventForReservation,
  getCalendarEventSync,
  sendWhatsAppConfirmation,
} from "@/lib/reservations";
import { verifySessionToken } from "@/lib/auth";
import {
  deleteReservation,
  getReservationById,
  listReservations,
  saveReservation,
  updateReservationCalendarEventId,
  updateReservationSchedule,
  validateReservation,
} from "@/lib/storage";
import type { IntegrationResult, ReservationInput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const providedPassword = request.headers.get("x-admin-password");

  if (providedPassword !== adminPassword) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const reservations = await listReservations();
    const updates = await Promise.all(
      reservations
        .filter((reservation) => reservation.calendarEventId)
        .map(async (reservation) => {
          try {
            const sync = await getCalendarEventSync(reservation.calendarEventId);
            if (!sync.exists) {
              await deleteReservation(reservation.id);
              return true;
            }

            const schedule = sync.schedule;
            if (
              !schedule ||
              (schedule.date === reservation.date &&
                schedule.time === reservation.time &&
                schedule.durationMinutes === reservation.durationMinutes)
            ) {
              return false;
            }

            await updateReservationSchedule(reservation.id, schedule);
            return true;
          } catch {
            return false;
          }
        }),
    );

    return NextResponse.json({
      reservations: updates.some(Boolean) ? await listReservations() : reservations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error cargando reservas" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = verifySessionToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Debes registrarte o iniciar sesion para reservar." },
      { status: 401 },
    );
  }

  const input = (await request.json()) as ReservationInput;
  const errors = await validateReservation(input);

  if (errors.length) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  try {
    const reservation = await saveReservation(input, {
      ...user,
      createdAt: new Date().toISOString(),
    });
    const integrations: IntegrationResult[] = [];

    try {
      const calendar = await createCalendarEvent(reservation);
      integrations.push({ name: "calendar", ...calendar });
      if (calendar.eventId) {
        reservation.calendarEventId = calendar.eventId;
        await updateReservationCalendarEventId(reservation.id, calendar.eventId);
      }
    } catch (error) {
      integrations.push({
        name: "calendar",
        ok: false,
        detail: error instanceof Error ? error.message : "No se pudo crear evento.",
      });
    }

    try {
      const whatsapp = await sendWhatsAppConfirmation(reservation);
      integrations.push({ name: "whatsapp", ...whatsapp });
    } catch (error) {
      integrations.push({
        name: "whatsapp",
        ok: false,
        detail: error instanceof Error ? error.message : "No se pudo enviar WhatsApp.",
      });
    }

    return NextResponse.json({ reservation, integrations }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error guardando reserva" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const providedPassword = request.headers.get("x-admin-password");

  if (providedPassword !== adminPassword) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const input = await request.json();
  if (!input.id || input.action !== "delete") {
    return NextResponse.json({ error: "Solicitud invalida." }, { status: 400 });
  }

  const reservation = await getReservationById(input.id);
  if (!reservation) {
    return NextResponse.json({ error: "Reserva no encontrada." }, { status: 404 });
  }

  const integrations: IntegrationResult[] = [];
  try {
    const calendar = await deleteCalendarEventForReservation(reservation);
    integrations.push({ name: "calendar", ...calendar });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `No se pudo eliminar el evento de Google Calendar: ${error.message}`
            : "No se pudo eliminar el evento de Google Calendar.",
      },
      { status: 500 },
    );
  }

  await deleteReservation(input.id);
  return NextResponse.json({ ok: true, integrations });
}
