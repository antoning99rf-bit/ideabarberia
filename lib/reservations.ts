import { google } from "googleapis";
import { Reservation } from "./types";

export type BusyRange = {
  start: number;
  end: number;
};

export type CalendarEventSchedule = {
  date: string;
  time: string;
  durationMinutes: number;
};

export function hasGoogleCalendarConfig() {
  return Boolean(
    process.env.GOOGLE_CLIENT_EMAIL &&
      process.env.GOOGLE_CALENDAR_ID &&
      process.env.GOOGLE_PRIVATE_KEY,
  );
}

function getPrivateKey() {
  return process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

function getGoogleAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  });
}

function getGoogleErrorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function addDays(date: string, days: number) {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function formatInTimeZone(value: string, timeZone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export async function createCalendarEvent(reservation: Reservation) {
  if (!hasGoogleCalendarConfig()) {
    return {
      ok: false,
      detail: "Google no configurado; evento omitido.",
    };
  }

  const calendar = google.calendar({ version: "v3", auth: getGoogleAuth() });
  const [hours, minutes] = reservation.time.split(":").map(Number);
  const endDate = new Date(2000, 0, 1, hours, minutes + (reservation.durationMinutes || 30));
  const endTime = `${String(endDate.getHours()).padStart(2, "0")}:${String(
    endDate.getMinutes(),
  ).padStart(2, "0")}:00`;
  const timeZone = process.env.TIME_ZONE || "Atlantic/Canary";

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: {
      summary: `${reservation.service} - ${reservation.name}`,
      description: [
        `Cliente: ${reservation.name}`,
        `Telefono WhatsApp: ${reservation.phone}`,
        `Email: ${reservation.email}`,
        `Servicio: ${reservation.service}`,
        `Precio: ${reservation.price ? `${reservation.price} EUR` : "A consultar"}`,
        `Duracion: ${reservation.durationMinutes || 30} min`,
        `Reserva: ${reservation.id}`,
      ].join("\n"),
      start: {
        dateTime: `${reservation.date}T${reservation.time}:00`,
        timeZone,
      },
      end: {
        dateTime: `${reservation.date}T${endTime}`,
        timeZone,
      },
    },
  });

  return {
    ok: true,
    detail: "Evento creado en Google Calendar.",
    eventId: response.data.id || null,
  };
}

export async function getCalendarEventSync(eventId?: string | null): Promise<
  | { exists: false; schedule: null }
  | { exists: true; schedule: CalendarEventSchedule | null }
> {
  if (!eventId || !hasGoogleCalendarConfig()) {
    return { exists: true, schedule: null };
  }

  const calendar = google.calendar({ version: "v3", auth: getGoogleAuth() });

  try {
    const response = await calendar.events.get({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      eventId,
    });
    const event = response.data;
    const startDateTime = event.start?.dateTime;
    const endDateTime = event.end?.dateTime;

    if (event.status === "cancelled") {
      return { exists: false, schedule: null };
    }

    if (!startDateTime || !endDateTime) {
      return { exists: true, schedule: null };
    }

    return {
      exists: true,
      schedule: {
        date: startDateTime.slice(0, 10),
        time: startDateTime.slice(11, 16),
        durationMinutes: Math.max(
          5,
          Math.round((Date.parse(endDateTime) - Date.parse(startDateTime)) / 60000),
        ),
      },
    };
  } catch (error) {
    const status = getGoogleErrorStatus(error);
    if (status === 404 || status === 410) return { exists: false, schedule: null };
    throw error;
  }
}

export async function listCalendarBusyRanges(date: string): Promise<BusyRange[]> {
  if (!hasGoogleCalendarConfig()) return [];

  const timeZone = process.env.TIME_ZONE || "Atlantic/Canary";
  const calendar = google.calendar({ version: "v3", auth: getGoogleAuth() });
  const response = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    singleEvents: true,
    showDeleted: false,
    timeMin: `${addDays(date, -1)}T00:00:00.000Z`,
    timeMax: `${addDays(date, 2)}T00:00:00.000Z`,
  });

  return (response.data.items || []).flatMap((event) => {
    if (event.status === "cancelled") return [];

    if (event.start?.date && event.end?.date) {
      const startDate = event.start.date;
      const endDate = event.end.date;
      if (startDate <= date && date < endDate) return [{ start: 0, end: 24 * 60 }];
      return [];
    }

    const startDateTime = event.start?.dateTime;
    const endDateTime = event.end?.dateTime;
    if (!startDateTime || !endDateTime) return [];

    const start = formatInTimeZone(startDateTime, timeZone);
    const end = formatInTimeZone(endDateTime, timeZone);
    if (start.date !== date && end.date !== date) return [];

    return [
      {
        start: start.date === date ? toMinutes(start.time) : 0,
        end: end.date === date ? toMinutes(end.time) : 24 * 60,
      },
    ];
  });
}

export async function deleteCalendarEvent(eventId?: string | null) {
  if (!eventId) {
    return {
      ok: false,
      detail: "La reserva no tiene evento asociado en Google Calendar.",
    };
  }

  if (!hasGoogleCalendarConfig()) {
    return {
      ok: false,
      detail: "Google no configurado; evento no eliminado.",
    };
  }

  const calendar = google.calendar({ version: "v3", auth: getGoogleAuth() });

  try {
    await calendar.events.delete({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      eventId,
    });
  } catch (error) {
    const status = getGoogleErrorStatus(error);

    if (status !== 404 && status !== 410) {
      throw error;
    }
  }

  return {
    ok: true,
    detail: "Evento eliminado de Google Calendar.",
  };
}

export async function deleteCalendarEventForReservation(reservation: Reservation) {
  if (reservation.calendarEventId) {
    return deleteCalendarEvent(reservation.calendarEventId);
  }

  if (!hasGoogleCalendarConfig()) {
    return {
      ok: false,
      detail: "Google no configurado; evento no eliminado.",
    };
  }

  const calendar = google.calendar({ version: "v3", auth: getGoogleAuth() });
  const response = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    maxResults: 10,
    q: reservation.id,
    singleEvents: true,
  });
  const event = response.data.items?.find((item) =>
    item.description?.includes(reservation.id),
  );

  if (!event?.id) {
    return {
      ok: false,
      detail: "No se encontro evento asociado en Google Calendar.",
    };
  }

  return deleteCalendarEvent(event.id);
}

export async function sendWhatsAppConfirmation(reservation: Reservation) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      ok: false,
      detail: "WhatsApp no configurado; mensaje omitido.",
    };
  }

  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const recipientPhone = reservation.phone.replace(/[^\d]/g, "");
  const body = process.env.WHATSAPP_TEMPLATE_NAME
    ? {
        messaging_product: "whatsapp",
        to: recipientPhone,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME,
          language: { code: process.env.WHATSAPP_LANGUAGE || "es" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: reservation.name },
                { type: "text", text: reservation.service },
                { type: "text", text: `${reservation.price} EUR` },
                { type: "text", text: reservation.date },
                { type: "text", text: reservation.time },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to: recipientPhone,
        type: "text",
        text: {
          body: `Hola ${reservation.name}, tu cita para ${reservation.service} (${reservation.price} EUR) queda reservada el ${reservation.date} a las ${reservation.time}.`,
        },
      };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail);
  }

  return {
    ok: true,
    detail: "Confirmacion enviada por WhatsApp.",
  };
}
