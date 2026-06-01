import nodemailer from "nodemailer";

function getBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` ||
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
    "http://localhost:3000"
  );
}

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

export function getPasswordResetUrl(token: string) {
  return `${getBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  resetUrl: string;
}) {
  if (!hasSmtpConfig()) {
    return {
      ok: false,
      detail: "SMTP no configurado; email omitido.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || `"Bruno Tooledoo Barber Studio" <${process.env.SMTP_USER}>`,
    to: input.email,
    subject: "Recupera tu contrasena",
    text: `Hola ${input.name},\n\nPuedes crear una nueva contrasena desde este enlace:\n${input.resetUrl}\n\nEl enlace caduca en 1 hora. Si no has pedido este cambio, ignora este email.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>Recupera tu contrasena</h2>
        <p>Hola ${input.name},</p>
        <p>Puedes crear una nueva contrasena desde este enlace:</p>
        <p><a href="${input.resetUrl}">Cambiar contrasena</a></p>
        <p>El enlace caduca en 1 hora. Si no has pedido este cambio, ignora este email.</p>
      </div>
    `,
  });

  return {
    ok: true,
    detail: "Email de recuperacion enviado.",
  };
}

export async function sendUserBlockStatusEmail(input: {
  email: string;
  name: string;
  blocked: boolean;
  reason?: string | null;
}) {
  if (!hasSmtpConfig()) {
    return {
      ok: false,
      detail: "SMTP no configurado; email omitido.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
  const subject = input.blocked
    ? "Tu cuenta ha sido bloqueada para nuevas reservas"
    : "Tu cuenta vuelve a estar activa";
  const reason = input.reason || "incumplimiento de asistencia a citas reservadas";
  const text = input.blocked
    ? `Hola ${input.name},\n\nTu cuenta ha sido bloqueada para nuevas reservas en Bruno Tooledoo Barber Studio.\nMotivo: ${reason}.\n\nSi crees que se trata de un error, responde a este correo para hablar con la barberia.`
    : `Hola ${input.name},\n\nTu cuenta vuelve a estar activa y ya puedes reservar nuevas citas en Bruno Tooledoo Barber Studio.`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || `"Bruno Tooledoo Barber Studio" <${process.env.SMTP_USER}>`,
    to: input.email,
    subject,
    text,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>${subject}</h2>
        <p>Hola ${input.name},</p>
        ${
          input.blocked
            ? `<p>Tu cuenta ha sido bloqueada para nuevas reservas.</p><p><strong>Motivo:</strong> ${reason}</p><p>Si crees que se trata de un error, responde a este correo para hablar con la barberia.</p>`
            : "<p>Tu cuenta vuelve a estar activa y ya puedes reservar nuevas citas.</p>"
        }
      </div>
    `,
  });

  return {
    ok: true,
    detail: input.blocked ? "Email de bloqueo enviado." : "Email de reactivacion enviado.",
  };
}
