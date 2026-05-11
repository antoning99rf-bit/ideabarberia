"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ServiceItem, User } from "@/lib/types";

type FormState = {
  service: string;
  date: string;
  time: string;
};

type AuthForm = {
  name: string;
  phone: string;
  email: string;
  password: string;
};

const initialForm: FormState = {
  service: "Corte",
  date: "",
  time: "",
};

const initialAuthForm: AuthForm = {
  name: "",
  phone: "",
  email: "",
  password: "",
};

export default function Home() {
  const [form, setForm] = useState(initialForm);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [authForm, setAuthForm] = useState(initialAuthForm);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [authStatus, setAuthStatus] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  const selectedService = services.find((service) => service.name === form.service);

  useEffect(() => {
    const savedUser = localStorage.getItem("bookingUser");
    const savedToken = localStorage.getItem("bookingToken");

    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
      setToken(savedToken);
    }

    fetch("/api/services")
      .then((response) => response.json())
      .then((result) => {
        setServices(result.services || []);
        if (result.services?.[0]) {
          setForm((currentForm) => ({
            ...currentForm,
            service: result.services[0].name,
          }));
        }
      });
  }, []);

  useEffect(() => {
    if (!form.date) {
      setAvailableTimes([]);
      return;
    }

    fetch(`/api/availability?date=${form.date}&service=${encodeURIComponent(form.service)}`)
      .then((response) => response.json())
      .then((result) => {
        setAvailableTimes(result.available || []);
        if (form.time && !result.available?.includes(form.time)) {
          setForm((currentForm) => ({ ...currentForm, time: "" }));
        }
      });
  }, [form.date, form.service, form.time]);

  function saveSession(nextUser: User, nextToken: string) {
    localStorage.setItem("bookingUser", JSON.stringify(nextUser));
    localStorage.setItem("bookingToken", nextToken);
    setUser(nextUser);
    setToken(nextToken);
  }

  function logout() {
    localStorage.removeItem("bookingUser");
    localStorage.removeItem("bookingToken");
    setUser(null);
    setToken("");
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthSubmitting(true);
    setAuthStatus({ type: "", message: "Procesando cuenta..." });

    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const payload =
      authMode === "register"
        ? authForm
        : { email: authForm.email, password: authForm.password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAuthStatus({ type: "error", message: result.error || "No se pudo acceder." });
        return;
      }

      saveSession(result.user, result.token);
      setAuthStatus({ type: "ok", message: "Cuenta lista. Ya puedes reservar." });
    } catch {
      setAuthStatus({
        type: "error",
        message: "No se pudo conectar con el servidor. Reinicia la app y prueba otra vez.",
      });
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user || !token) {
      setStatus({ type: "error", message: "Primero crea una cuenta o inicia sesion." });
      return;
    }

    setIsSubmitting(true);
    setStatus({ type: "", message: "Guardando tu reserva..." });

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus({ type: "error", message: result.error || "No se pudo reservar." });
        return;
      }

      setForm(initialForm);
      setStatus({
        type: "ok",
        message:
          "Cita reservada. Si WhatsApp esta configurado, recibiras la confirmacion en tu numero.",
      });
    } catch {
      setStatus({
        type: "error",
        message: "No se pudo conectar con el servidor. Reinicia la app y prueba otra vez.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <main className="page-shell">
        <header className="topbar">
          <a className="brand" href="#">
            <span className="brand-mark">BT</span>
            <span>Bruno Toledo Barber</span>
          </a>
          <a className="nav-link" href="/admin">
            Panel privado
          </a>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">ES / GB · Gran Canaria / Firgas</div>
            <h1>Bruno Toledo Barber</h1>
            <p>
              Cortes, barba y estilo masculino con trato cercano y acabado profesional.
              Reserva tu cita online y elige el hueco que mejor encaje contigo.
            </p>
            <div className="profile-strip">
              <span>Since 2017</span>
              <span>@brunotooledoo</span>
            </div>
            <div className="profile-card">
              <div className="profile-avatar">BT</div>
              <div>
                <strong>Bruno Toledo Rodriguez</strong>
                <span>40 publicaciones · 1271 seguidores · 918 seguidos</span>
              </div>
            </div>
            <div className="hero-actions">
              <a className="button button-primary" href="#reservar">
                Reservar cita
              </a>
              <a className="button button-secondary" href="#servicios">
                Ver precios
              </a>
            </div>
          </div>

          <div className="booking-stack" id="reservar">
            <section className="booking-panel auth-panel">
              <div className="panel-title-row">
                <h2>{user ? "Tu cuenta" : "Acceso cliente"}</h2>
                {user ? (
                  <button className="text-button" onClick={logout} type="button">
                    Salir
                  </button>
                ) : null}
              </div>

              {user ? (
                <div className="account-summary">
                  <strong>{user.name}</strong>
                  <span>{user.phone}</span>
                  <span>{user.email}</span>
                </div>
              ) : (
                <form className="form-grid" onSubmit={submitAuth}>
                  <div className="segmented">
                    <button
                      className={authMode === "register" ? "active" : ""}
                      onClick={() => setAuthMode("register")}
                      type="button"
                    >
                      Registro
                    </button>
                    <button
                      className={authMode === "login" ? "active" : ""}
                      onClick={() => setAuthMode("login")}
                      type="button"
                    >
                      Entrar
                    </button>
                  </div>

                  {authMode === "register" ? (
                    <>
                      <div className="field">
                        <label htmlFor="auth-name">Nombre</label>
                        <input
                          id="auth-name"
                          minLength={2}
                          onChange={(event) =>
                            setAuthForm({ ...authForm, name: event.target.value })
                          }
                          placeholder="Tu nombre"
                          required
                          value={authForm.name}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="auth-phone">Telefono WhatsApp</label>
                        <input
                          id="auth-phone"
                          onChange={(event) =>
                            setAuthForm({ ...authForm, phone: event.target.value })
                          }
                          placeholder="+34600111222"
                          required
                          type="tel"
                          value={authForm.phone}
                        />
                      </div>
                    </>
                  ) : null}

                  <div className="field">
                    <label htmlFor="auth-email">Email</label>
                    <input
                      id="auth-email"
                      onChange={(event) =>
                        setAuthForm({ ...authForm, email: event.target.value })
                      }
                      placeholder="cliente@email.com"
                      required
                      type="email"
                      value={authForm.email}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="auth-password">Contrasena</label>
                    <input
                      id="auth-password"
                      minLength={6}
                      onChange={(event) =>
                        setAuthForm({ ...authForm, password: event.target.value })
                      }
                      required
                      type="password"
                      value={authForm.password}
                    />
                  </div>
                  <button className="button button-primary" disabled={isAuthSubmitting} type="submit">
                    {isAuthSubmitting
                      ? "Procesando..."
                      : authMode === "register"
                        ? "Crear cuenta"
                        : "Entrar"}
                  </button>
                  <div className={`status ${authStatus.type}`} role="status">
                    {authStatus.message}
                  </div>
                </form>
              )}
            </section>

            <form className="booking-panel" onSubmit={submitReservation}>
              <h2>Reserva cita</h2>
              {!user ? (
                <div className="status error">Debes registrarte o iniciar sesion antes.</div>
              ) : null}
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="service">Servicio</label>
                  <select
                    disabled={!user}
                    id="service"
                    onChange={(event) => setForm({ ...form, service: event.target.value })}
                    value={form.service}
                  >
                    {services.map((service) => (
                      <option key={service.name} value={service.name}>
                        {service.name} - {service.price ? `${service.price} EUR` : "A consultar"}
                        {" · "}
                        {service.durationMinutes} min
                      </option>
                    ))}
                  </select>
                </div>
                <div className="price-preview">
                  <span>Precio</span>
                  <strong>
                    {selectedService?.price ? `${selectedService.price} EUR` : "A consultar"}
                    {selectedService ? ` · ${selectedService.durationMinutes} min` : ""}
                  </strong>
                </div>
                <div className="field">
                  <label htmlFor="date">Fecha</label>
                  <input
                    disabled={!user}
                    id="date"
                    onChange={(event) => setForm({ ...form, date: event.target.value })}
                    required
                    min={new Date().toISOString().slice(0, 10)}
                    type="date"
                    value={form.date}
                  />
                </div>
                <div className="field">
                  <label htmlFor="time">Hora</label>
                  <select
                    disabled={!user || !form.date}
                    id="time"
                    onChange={(event) => setForm({ ...form, time: event.target.value })}
                    required
                    value={form.time}
                  >
                    <option value="">
                      {form.date ? "Selecciona una hora" : "Primero elige fecha"}
                    </option>
                    {availableTimes.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="button button-primary"
                  disabled={isSubmitting || !user}
                  type="submit"
                >
                  {isSubmitting ? "Reservando..." : "Confirmar reserva"}
                </button>
                <div className={`status ${status.type}`} role="status">
                  {status.message}
                </div>
              </div>
            </form>
          </div>
        </section>
      </main>

      <section className="services-band" id="servicios">
        <div className="services-inner">
          <h2>Servicios y precios</h2>
          <div className="service-grid">
            {services.map((service) => (
              <div className="service-item" key={service.name}>
                <strong>{service.name}</strong>
                <span>{service.description}</span>
                <em>
                  {service.price ? `${service.price} EUR` : "A consultar"} ·{" "}
                  {service.durationMinutes} min
                </em>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
