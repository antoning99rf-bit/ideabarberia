"use client";

import { FormEvent, useMemo, useState } from "react";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") || "";
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: "", message: "Guardando nueva contrasena..." });

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus({ type: "error", message: result.error || "No se pudo cambiar la contrasena." });
        return;
      }

      setStatus({
        type: "ok",
        message: "Contrasena actualizada. Ya puedes iniciar sesion con la nueva contrasena.",
      });
      setPassword("");
    } catch {
      setStatus({ type: "error", message: "No se pudo conectar con el servidor." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="admin-page">
      <form className="admin-panel admin-login" onSubmit={submit}>
        <h1>Nueva contrasena</h1>
        {!token ? <div className="status error">Enlace invalido.</div> : null}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="new-password">Contrasena nueva</label>
            <input
              disabled={!token}
              id="new-password"
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>
          <button className="button button-primary" disabled={isSubmitting || !token} type="submit">
            {isSubmitting ? "Guardando..." : "Cambiar contrasena"}
          </button>
          <div className={`status ${status.type}`} role="status">
            {status.message}
          </div>
          <a className="text-button" href="/#reservar">
            Volver a iniciar sesion
          </a>
        </div>
      </form>
    </main>
  );
}
