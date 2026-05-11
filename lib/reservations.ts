import { google } from "googleapis";
import { Reservation } from "./types";

function hasGoogleCalendarConfig() {
  return Boolean(
    process.env.GOOGLE_CLIENT_EMAIL &&
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
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar",
    ],
  });
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
  const endDate = new Date(2000, 0, 1, hours, minutes + 45);
  const endTime = `${String(endDate.getHours()).padStart(2, "0")}:${String(
    endDate.getMinutes(),
  ).padStart(2, "0")}:00`;
  const timeZone = process.env.TIME_ZONE || "Atlantic/Canary";

  await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    requestBody: {
      summary: `${reservation.service} - ${reservation.name}`,
      description: `Cliente: ${reservation.name}\nTelefono: ${reservation.phone}\nEmail: ${reservation.email}\nPrecio: ${reservation.price} EUR\nReserva: ${reservation.id}`,
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
  };
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
