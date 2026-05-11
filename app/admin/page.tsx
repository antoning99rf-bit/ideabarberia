"use client";

import { FormEvent, useEffect, useState } from "react";
import type { BlockedSlot, Reservation, ServiceItem, WorkingDay } from "@/lib/types";

type NewService = {
  name: string;
  price: string;
  description: string;
};

const emptyService: NewService = {
  name: "",
  price: "",
  description: "",
};

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [savedPassword, setSavedPassword] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingDay[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [newService, setNewService] = useState(emptyService);
  const [blockForm, setBlockForm] = useState({ date: "", time: "", reason: "" });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const headers = { "x-admin-password": savedPassword };

  async function loadReservations(currentPassword: string) {
    const response = await fetch("/api/reservations", {
      headers: { "x-admin-password": currentPassword },
      cache: "no-store",
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "No se pudieron cargar las reservas.");
    setReservations(result.reservations);
  }

  async function loadServices(currentPassword: string) {
    const response = await fetch("/api/services?admin=1", {
      headers: { "x-admin-password": currentPassword },
      cache: "no-store",
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "No se pudieron cargar los servicios.");
    setServices(result.services);
  }

  async function loadAvailability(currentPassword: string) {
    const response = await fetch("/api/availability?admin=1", {
      headers: { "x-admin-password": currentPassword },
      cache: "no-store",
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "No se pudo cargar disponibilidad.");
    setBlockedSlots(result.blockedSlots);
    setSlots(result.slots);
    setWorkingHours(result.workingHours || []);
  }

  async function loadAdminData(currentPassword = savedPassword) {
    setStatus("Cargando panel...");
    setError("");

    try {
      await Promise.all([
        loadReservations(currentPassword),
        loadServices(currentPassword),
        loadAvailability(currentPassword),
      ]);
      setStatus("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el panel.");
      setStatus("");
    }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sessionStorage.setItem("adminPassword", password);
    setSavedPassword(password);
    loadAdminData(password);
  }

  async function saveService(service: ServiceItem) {
    setStatus("Guardando servicio...");
    setError("");

    const response = await fetch("/api/services", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(service),
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error || "No se pudo guardar el servicio.");
      setStatus("");
      return;
    }

    await loadServices(savedPassword);
    setStatus("Servicio actualizado.");
  }

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveService({
      id: "",
      name: newService.name,
      price: Number(newService.price || 0),
      description: newService.description,
      active: true,
    });
    setNewService(emptyService);
  }

  async function removeService(id: string) {
    setStatus("Desactivando servicio...");
    setError("");

    const response = await fetch(`/api/services?id=${id}`, {
      method: "DELETE",
      headers,
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error || "No se pudo desactivar el servicio.");
      setStatus("");
      return;
    }

    await loadServices(savedPassword);
    setStatus("Servicio desactivado.");
  }

  async function addBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Bloqueando hora...");
    setError("");

    const response = await fetch("/api/availability", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(blockForm),
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error || "No se pudo bloquear la hora.");
      setStatus("");
      return;
    }

    setBlockForm({ date: blockForm.date, time: "", reason: "" });
    await loadAvailability(savedPassword);
    setStatus("Hora bloqueada.");
  }

  async function removeBlock(id: string) {
    setStatus("Liberando hora...");
    setError("");

    const response = await fetch(`/api/availability?id=${id}`, {
      method: "DELETE",
      headers,
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error || "No se pudo liberar la hora.");
      setStatus("");
      return;
    }

    await loadAvailability(savedPassword);
    setStatus("Hora liberada.");
  }

  async function saveSchedule() {
    setStatus("Guardando horario...");
    setError("");

    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ workingHours }),
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error || "No se pudo guardar el horario.");
      setStatus("");
      return;
    }

    setWorkingHours(result.workingHours);
    await loadAvailability(savedPassword);
    setStatus("Horario actualizado.");
  }

  async function cancelBooking(id: string) {
    setStatus("Cancelando cita...");
    setError("");

    const response = await fetch("/api/reservations", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "Cancelada" }),
    });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error || "No se pudo cancelar la cita.");
      setStatus("");
      return;
    }

    await loadReservations(savedPassword);
    setStatus("Cita cancelada.");
  }

  useEffect(() => {
    const currentPassword = sessionStorage.getItem("adminPassword");
    if (currentPassword) {
      setSavedPassword(currentPassword);
      setPassword(currentPassword);
      loadAdminData(currentPassword);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!savedPassword) {
    return (
      <main className="admin-shell">
        <form className="admin-panel admin-login" onSubmit={login}>
          <h1>Panel privado</h1>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="password">Clave de acceso</label>
              <input
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
            <button className="button button-primary" type="submit">
              Entrar
            </button>
            {error ? <div className="status error">{error}</div> : null}
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <section className="admin-panel">
        <div className="admin-header">
          <div>
            <div className="eyebrow">Gestion de agenda</div>
            <h1>Panel privado</h1>
          </div>
          <button className="button button-secondary" onClick={() => loadAdminData()} type="button">
            Actualizar
          </button>
        </div>

        {status ? <div className="status">{status}</div> : null}
        {error ? <div className="status error">{error}</div> : null}

        <div className="admin-sections">
          <section className="admin-section">
            <h2>Horario semanal</h2>
            <div className="schedule-grid">
              {workingHours.map((day) => (
                <div className="schedule-row" key={day.dayOfWeek}>
                  <label className="schedule-day">
                    <input
                      checked={day.active}
                      onChange={(event) =>
                        setWorkingHours((currentDays) =>
                          currentDays.map((currentDay) =>
                            currentDay.dayOfWeek === day.dayOfWeek
                              ? { ...currentDay, active: event.target.checked }
                              : currentDay,
                          ),
                        )
                      }
                      type="checkbox"
                    />
                    <span>{day.label}</span>
                  </label>
                  <input
                    disabled={!day.active}
                    onChange={(event) =>
                      setWorkingHours((currentDays) =>
                        currentDays.map((currentDay) =>
                          currentDay.dayOfWeek === day.dayOfWeek
                            ? { ...currentDay, morningStart: event.target.value }
                            : currentDay,
                        ),
                      )
                    }
                    type="time"
                    value={day.morningStart}
                  />
                  <input
                    disabled={!day.active}
                    onChange={(event) =>
                      setWorkingHours((currentDays) =>
                        currentDays.map((currentDay) =>
                          currentDay.dayOfWeek === day.dayOfWeek
                            ? { ...currentDay, morningEnd: event.target.value }
                            : currentDay,
                        ),
                      )
                    }
                    type="time"
                    value={day.morningEnd}
                  />
                  <input
                    disabled={!day.active}
                    onChange={(event) =>
                      setWorkingHours((currentDays) =>
                        currentDays.map((currentDay) =>
                          currentDay.dayOfWeek === day.dayOfWeek
                            ? { ...currentDay, afternoonStart: event.target.value }
                            : currentDay,
                        ),
                      )
                    }
                    type="time"
                    value={day.afternoonStart}
                  />
                  <input
                    disabled={!day.active}
                    onChange={(event) =>
                      setWorkingHours((currentDays) =>
                        currentDays.map((currentDay) =>
                          currentDay.dayOfWeek === day.dayOfWeek
                            ? { ...currentDay, afternoonEnd: event.target.value }
                            : currentDay,
                        ),
                      )
                    }
                    type="time"
                    value={day.afternoonEnd}
                  />
                </div>
              ))}
            </div>
            <button className="button button-primary schedule-save" onClick={saveSchedule} type="button">
              Guardar horario
            </button>
          </section>

          <section className="admin-section">
            <h2>Servicios y precios</h2>
            <form className="admin-inline-form" onSubmit={addService}>
              <input
                onChange={(event) => setNewService({ ...newService, name: event.target.value })}
                placeholder="Servicio"
                required
                value={newService.name}
              />
              <input
                min="0"
                onChange={(event) => setNewService({ ...newService, price: event.target.value })}
                placeholder="Precio"
                step="0.01"
                type="number"
                value={newService.price}
              />
              <input
                onChange={(event) =>
                  setNewService({ ...newService, description: event.target.value })
                }
                placeholder="Descripcion"
                value={newService.description}
              />
              <button className="button button-primary" type="submit">
                Añadir
              </button>
            </form>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Servicio</th>
                    <th>Precio</th>
                    <th>Descripcion</th>
                    <th>Activo</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => (
                    <tr key={service.id}>
                      <td>
                        <input
                          onChange={(event) =>
                            setServices((currentServices) =>
                              currentServices.map((currentService) =>
                                currentService.id === service.id
                                  ? { ...currentService, name: event.target.value }
                                  : currentService,
                              ),
                            )
                          }
                          value={service.name}
                        />
                      </td>
                      <td>
                        <input
                          min="0"
                          onChange={(event) =>
                            setServices((currentServices) =>
                              currentServices.map((currentService) =>
                                currentService.id === service.id
                                  ? { ...currentService, price: Number(event.target.value) }
                                  : currentService,
                              ),
                            )
                          }
                          step="0.01"
                          type="number"
                          value={service.price}
                        />
                      </td>
                      <td>
                        <input
                          onChange={(event) =>
                            setServices((currentServices) =>
                              currentServices.map((currentService) =>
                                currentService.id === service.id
                                  ? { ...currentService, description: event.target.value }
                                  : currentService,
                              ),
                            )
                          }
                          value={service.description}
                        />
                      </td>
                      <td>
                        <input
                          checked={service.active}
                          onChange={(event) =>
                            setServices((currentServices) =>
                              currentServices.map((currentService) =>
                                currentService.id === service.id
                                  ? { ...currentService, active: event.target.checked }
                                  : currentService,
                              ),
                            )
                          }
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="button button-secondary"
                            onClick={() => saveService(service)}
                            type="button"
                          >
                            Guardar
                          </button>
                          <button
                            className="button button-secondary"
                            onClick={() => removeService(service.id)}
                            type="button"
                          >
                            Quitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-section">
            <h2>Bloquear horas</h2>
            <form className="admin-inline-form" onSubmit={addBlock}>
              <input
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setBlockForm({ ...blockForm, date: event.target.value })}
                required
                type="date"
                value={blockForm.date}
              />
              <select
                onChange={(event) => setBlockForm({ ...blockForm, time: event.target.value })}
                required
                value={blockForm.time}
              >
                <option value="">Hora</option>
                {slots.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
              <input
                onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })}
                placeholder="Motivo"
                value={blockForm.reason}
              />
              <button className="button button-primary" type="submit">
                Bloquear
              </button>
            </form>

            <div className="blocked-list">
              {blockedSlots.map((slot) => (
                <div className="blocked-item" key={slot.id}>
                  <span>
                    <strong>{slot.date}</strong> {slot.time} · {slot.reason}
                  </span>
                  <button
                    className="button button-secondary"
                    onClick={() => removeBlock(slot.id)}
                    type="button"
                  >
                    Liberar
                  </button>
                </div>
              ))}
              {!blockedSlots.length ? <div className="status">No hay horas bloqueadas.</div> : null}
            </div>
          </section>

          <section className="admin-section">
            <h2>Reservas</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Hora</th>
                    <th>Cliente</th>
                    <th>Telefono</th>
                    <th>Email</th>
                    <th>Servicio</th>
                    <th>Precio</th>
                    <th>Estado</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((reservation) => (
                    <tr key={reservation.id}>
                      <td>{reservation.date}</td>
                      <td>{reservation.time}</td>
                      <td>{reservation.name}</td>
                      <td>{reservation.phone}</td>
                      <td>{reservation.email}</td>
                      <td>{reservation.service}</td>
                      <td>{reservation.price ? `${reservation.price} EUR` : "A consultar"}</td>
                      <td>
                        <span className="pill">{reservation.status}</span>
                      </td>
                      <td>
                        {reservation.status === "Cancelada" ? (
                          <span className="status">Cancelada</span>
                        ) : (
                          <button
                            className="button button-secondary"
                            onClick={() => cancelBooking(reservation.id)}
                            type="button"
                          >
                            Cancelar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!reservations.length ? (
                    <tr>
                      <td colSpan={9}>Aun no hay reservas.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
