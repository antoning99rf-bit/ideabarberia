import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import mysql from "mysql2/promise";
import { hashPassword, verifyPassword } from "./auth";
import {
  BlockedSlot,
  Reservation,
  ReservationInput,
  ServiceItem,
  User,
  defaultServiceCatalog,
  defaultWorkingHours,
  WorkingDay,
} from "./types";

type StoredUser = User & {
  passwordHash: string;
};

const localUsersFile = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  "users.local.json",
);
const localReservationsFile = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  "reservations.local.json",
);
const localServicesFile = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  "services.local.json",
);
const localBlockedSlotsFile = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  "blocked-slots.local.json",
);
const localWorkingHoursFile = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  "working-hours.local.json",
);

let pool: mysql.Pool | null = null;
let schemaReady = false;
let memoryUsers: StoredUser[] = [];
let memoryReservations: Reservation[] = [];
let memoryServices: ServiceItem[] = defaultServiceCatalog;
let memoryBlockedSlots: BlockedSlot[] = [];
let memoryWorkingHours: WorkingDay[] = defaultWorkingHours;

export function hasMysqlConfig() {
  return Boolean(
    process.env.MYSQL_HOST &&
      process.env.MYSQL_DATABASE &&
      process.env.MYSQL_USER &&
      process.env.MYSQL_PASSWORD,
  );
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
      waitForConnections: true,
      connectionLimit: 5,
    });
  }

  return pool;
}

async function ensureSchema() {
  if (!hasMysqlConfig() || schemaReady) return;

  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(190) NOT NULL,
      created_at DATETIME NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      email VARCHAR(190) NOT NULL,
      service VARCHAR(80) NOT NULL,
      price DECIMAL(8,2) NOT NULL,
      date DATE NOT NULL,
      time VARCHAR(5) NOT NULL,
      status VARCHAR(40) NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX reservations_user_id_idx (user_id),
      CONSTRAINT reservations_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS services (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      price DECIMAL(8,2) NOT NULL,
      description VARCHAR(255) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id VARCHAR(36) PRIMARY KEY,
      date DATE NOT NULL,
      time VARCHAR(5) NOT NULL,
      reason VARCHAR(160) NOT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY blocked_slots_date_time_idx (date, time)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS working_hours (
      day_of_week TINYINT PRIMARY KEY,
      label VARCHAR(40) NOT NULL,
      active TINYINT(1) NOT NULL,
      morning_start VARCHAR(5) NOT NULL,
      morning_end VARCHAR(5) NOT NULL,
      afternoon_start VARCHAR(5) NOT NULL,
      afternoon_end VARCHAR(5) NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);

  const [serviceRows] = await db.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM services",
  );
  if (Number(serviceRows[0]?.total || 0) === 0) {
    await Promise.all(
      defaultServiceCatalog.map((service) =>
        db.execute(
          `INSERT INTO services (id, name, price, description, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            service.id,
            service.name,
            service.price,
            service.description,
            service.active ? 1 : 0,
            new Date(),
            new Date(),
          ],
        ),
      ),
    );
  }

  const [workingRows] = await db.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM working_hours",
  );
  if (Number(workingRows[0]?.total || 0) === 0) {
    await Promise.all(
      defaultWorkingHours.map((day) =>
        db.execute(
          `INSERT INTO working_hours
           (day_of_week, label, active, morning_start, morning_end, afternoon_start, afternoon_end, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            day.dayOfWeek,
            day.label,
            day.active ? 1 : 0,
            day.morningStart,
            day.morningEnd,
            day.afternoonStart,
            day.afternoonEnd,
            new Date(),
          ],
        ),
      ),
    );
  }

  schemaReady = true;
}

async function readJson<T>(file: string, fallback: T) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  try {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  } catch {
    // Serverless filesystems can be temporary; memory keeps demos usable.
  }
}

async function readLocalUsers() {
  memoryUsers = await readJson(localUsersFile, memoryUsers);
  return memoryUsers;
}

async function readLocalReservations() {
  memoryReservations = await readJson(localReservationsFile, memoryReservations);
  return memoryReservations;
}

async function readLocalServices() {
  memoryServices = await readJson(localServicesFile, memoryServices);
  return memoryServices;
}

async function readLocalBlockedSlots() {
  memoryBlockedSlots = await readJson(localBlockedSlotsFile, memoryBlockedSlots);
  return memoryBlockedSlots;
}

async function readLocalWorkingHours() {
  memoryWorkingHours = await readJson(localWorkingHoursFile, memoryWorkingHours);
  return memoryWorkingHours;
}

function publicUser(user: StoredUser): User {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function slotsForRange(start: string, end: string) {
  const slots: string[] = [];
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);

  for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {
    slots.push(toTime(minutes));
  }

  return slots;
}

export function getDefaultTimeSlots() {
  return Array.from(
    new Set(
      defaultWorkingHours.flatMap((day) =>
        day.active
          ? [
              ...slotsForRange(day.morningStart, day.morningEnd),
              ...slotsForRange(day.afternoonStart, day.afternoonEnd),
            ]
          : [],
      ),
    ),
  ).sort();
}

export async function getWorkingHours(): Promise<WorkingDay[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
      `SELECT day_of_week, label, active, morning_start, morning_end, afternoon_start, afternoon_end
       FROM working_hours
       ORDER BY FIELD(day_of_week, 1, 2, 3, 4, 5, 6, 0)`,
    );

    return rows.map((row) => ({
      dayOfWeek: Number(row.day_of_week),
      label: row.label,
      active: Boolean(row.active),
      morningStart: row.morning_start,
      morningEnd: row.morning_end,
      afternoonStart: row.afternoon_start,
      afternoonEnd: row.afternoon_end,
    }));
  }

  return readLocalWorkingHours();
}

export async function saveWorkingHours(days: WorkingDay[]) {
  await ensureSchema();
  const sanitized = defaultWorkingHours.map((defaultDay) => {
    const day = days.find((candidate) => candidate.dayOfWeek === defaultDay.dayOfWeek);
    return {
      ...defaultDay,
      ...day,
      label: defaultDay.label,
      active: Boolean(day?.active),
      morningStart: day?.morningStart || defaultDay.morningStart,
      morningEnd: day?.morningEnd || defaultDay.morningEnd,
      afternoonStart: day?.afternoonStart || defaultDay.afternoonStart,
      afternoonEnd: day?.afternoonEnd || defaultDay.afternoonEnd,
    };
  });

  if (hasMysqlConfig()) {
    await Promise.all(
      sanitized.map((day) =>
        getPool().execute(
          `INSERT INTO working_hours
           (day_of_week, label, active, morning_start, morning_end, afternoon_start, afternoon_end, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           active = VALUES(active), morning_start = VALUES(morning_start),
           morning_end = VALUES(morning_end), afternoon_start = VALUES(afternoon_start),
           afternoon_end = VALUES(afternoon_end), updated_at = VALUES(updated_at)`,
          [
            day.dayOfWeek,
            day.label,
            day.active ? 1 : 0,
            day.morningStart,
            day.morningEnd,
            day.afternoonStart,
            day.afternoonEnd,
            new Date(),
          ],
        ),
      ),
    );
  } else {
    memoryWorkingHours = sanitized;
    await writeJson(localWorkingHoursFile, sanitized);
  }

  return sanitized;
}

async function getSlotsForDate(date: string) {
  const parsedDate = new Date(`${date}T00:00:00`);
  const dayOfWeek = parsedDate.getDay();
  const day = (await getWorkingHours()).find((workingDay) => workingDay.dayOfWeek === dayOfWeek);

  if (!day?.active) return [];

  return [
    ...slotsForRange(day.morningStart, day.morningEnd),
    ...slotsForRange(day.afternoonStart, day.afternoonEnd),
  ];
}

export async function listServices(includeInactive = false): Promise<ServiceItem[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
      `SELECT id, name, price, description, active
       FROM services
       ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY name ASC`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      price: Number(row.price),
      description: row.description,
      active: Boolean(row.active),
    }));
  }

  const services = await readLocalServices();
  return includeInactive ? services : services.filter((service) => service.active);
}

export async function getServicePrice(serviceName: string) {
  const service = (await listServices(true)).find(
    (currentService) => currentService.name === serviceName && currentService.active,
  );
  return service?.price ?? 0;
}

export async function upsertService(input: Partial<ServiceItem> & Pick<ServiceItem, "name">) {
  await ensureSchema();
  const now = new Date();
  const service: ServiceItem = {
    id: input.id || randomUUID(),
    name: input.name.trim(),
    price: Number(input.price || 0),
    description: input.description?.trim() || "",
    active: input.active ?? true,
  };

  if (!service.name) throw new Error("El nombre del servicio es obligatorio.");

  if (hasMysqlConfig()) {
    await getPool().execute(
      `INSERT INTO services (id, name, price, description, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name), price = VALUES(price), description = VALUES(description),
       active = VALUES(active), updated_at = VALUES(updated_at)`,
      [
        service.id,
        service.name,
        service.price,
        service.description,
        service.active ? 1 : 0,
        now,
        now,
      ],
    );
  } else {
    const services = await readLocalServices();
    const index = services.findIndex((currentService) => currentService.id === service.id);
    if (index >= 0) services[index] = service;
    else services.push(service);
    memoryServices = services;
    await writeJson(localServicesFile, services);
  }

  return service;
}

export async function deleteService(id: string) {
  await ensureSchema();

  if (hasMysqlConfig()) {
    await getPool().execute("UPDATE services SET active = 0, updated_at = ? WHERE id = ?", [
      new Date(),
      id,
    ]);
  } else {
    const services = await readLocalServices();
    memoryServices = services.map((service) =>
      service.id === id ? { ...service, active: false } : service,
    );
    await writeJson(localServicesFile, memoryServices);
  }
}

export async function listBlockedSlots(): Promise<BlockedSlot[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
      `SELECT id, date, time, reason, created_at
       FROM blocked_slots
       ORDER BY date ASC, time ASC`,
    );

    return rows.map((row) => ({
      id: row.id,
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
      time: row.time,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  return readLocalBlockedSlots();
}

export async function addBlockedSlot(input: { date: string; time: string; reason?: string }) {
  await ensureSchema();
  if (!input.date || !input.time) throw new Error("Fecha y hora son obligatorias.");

  const blockedSlot: BlockedSlot = {
    id: randomUUID(),
    date: input.date,
    time: input.time,
    reason: input.reason?.trim() || "No disponible",
    createdAt: new Date().toISOString(),
  };

  if (hasMysqlConfig()) {
    await getPool().execute(
      `INSERT INTO blocked_slots (id, date, time, reason, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
      [
        blockedSlot.id,
        blockedSlot.date,
        blockedSlot.time,
        blockedSlot.reason,
        new Date(blockedSlot.createdAt),
      ],
    );
  } else {
    const blockedSlots = await readLocalBlockedSlots();
    const next = blockedSlots.filter(
      (slot) => !(slot.date === blockedSlot.date && slot.time === blockedSlot.time),
    );
    next.push(blockedSlot);
    memoryBlockedSlots = next;
    await writeJson(localBlockedSlotsFile, next);
  }

  return blockedSlot;
}

export async function deleteBlockedSlot(id: string) {
  await ensureSchema();

  if (hasMysqlConfig()) {
    await getPool().execute("DELETE FROM blocked_slots WHERE id = ?", [id]);
  } else {
    memoryBlockedSlots = (await readLocalBlockedSlots()).filter((slot) => slot.id !== id);
    await writeJson(localBlockedSlotsFile, memoryBlockedSlots);
  }
}

export async function getAvailability(date: string) {
  const slots = date ? await getSlotsForDate(date) : getDefaultTimeSlots();
  if (!date) return { date, slots, unavailable: [], available: [] };

  const [reservations, blockedSlots] = await Promise.all([
    listReservations(),
    listBlockedSlots(),
  ]);
  const unavailable = new Set<string>();

  reservations
    .filter((reservation) => reservation.date === date)
    .forEach((reservation) => unavailable.add(reservation.time));
  blockedSlots
    .filter((slot) => slot.date === date)
    .forEach((slot) => unavailable.add(slot.time));

  return {
    date,
    slots,
    unavailable: Array.from(unavailable),
    available: slots.filter((slot) => !unavailable.has(slot)),
  };
}

export async function validateReservation(input: ReservationInput) {
  const errors: string[] = [];
  const activeServices = await listServices(false);
  const availability = await getAvailability(input.date);

  if (!activeServices.some((service) => service.name === input.service)) {
    errors.push("Servicio invalido.");
  }
  if (!input.date) errors.push("Fecha obligatoria.");
  if (!input.time) errors.push("Hora obligatoria.");
  if (input.date && input.time && !availability.available.includes(input.time)) {
    errors.push("Esa hora no esta disponible.");
  }

  return errors;
}

export function validateRegistration(input: {
  name: string;
  phone: string;
  email: string;
  password: string;
}) {
  const errors: string[] = [];

  if (!input.name || input.name.trim().length < 2) errors.push("Nombre invalido.");
  if (!input.phone || input.phone.trim().length < 7) errors.push("Telefono invalido.");
  if (!input.email || !input.email.includes("@")) errors.push("Email invalido.");
  if (!input.password || input.password.length < 6) {
    errors.push("La contrasena debe tener al menos 6 caracteres.");
  }

  return errors;
}

export async function createUser(input: {
  name: string;
  phone: string;
  email: string;
  password: string;
}) {
  await ensureSchema();

  const user: StoredUser = {
    id: randomUUID(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };

  if (hasMysqlConfig()) {
    await getPool().execute(
      `INSERT INTO users (id, name, phone, email, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, user.name, user.phone, user.email, user.passwordHash, new Date(user.createdAt)],
    );
  } else {
    const users = await readLocalUsers();
    if (users.some((currentUser) => currentUser.email === user.email)) {
      throw new Error("Ya existe una cuenta con ese email.");
    }
    users.push(user);
    memoryUsers = users;
    await writeJson(localUsersFile, users);
  }

  return publicUser(user);
}

export async function findUserByCredentials(email: string, password: string) {
  await ensureSchema();
  const normalizedEmail = email.trim().toLowerCase();

  if (hasMysqlConfig()) {
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
      `SELECT id, name, phone, email, password_hash, created_at
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail],
    );
    const row = rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) return null;

    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      createdAt: new Date(row.created_at).toISOString(),
    } satisfies User;
  }

  const users = await readLocalUsers();
  const user = users.find((currentUser) => currentUser.email === normalizedEmail);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;

  return publicUser(user);
}

export async function listReservations(): Promise<Reservation[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>(
      `SELECT id, user_id, name, phone, email, service, price, date, time, status, created_at
       FROM reservations
       ORDER BY created_at DESC`,
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      service: row.service,
      price: Number(row.price),
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
      time: row.time,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  return readLocalReservations();
}

export async function deleteReservation(id: string) {
  await ensureSchema();

  if (hasMysqlConfig()) {
    await getPool().execute("DELETE FROM reservations WHERE id = ?", [id]);
    return;
  }

  const reservations = await readLocalReservations();
  memoryReservations = reservations.filter((reservation) => reservation.id !== id);
  await writeJson(localReservationsFile, memoryReservations);
}

export async function saveReservation(input: ReservationInput, user: User): Promise<Reservation> {
  await ensureSchema();

  const reservation: Reservation = {
    ...input,
    id: randomUUID(),
    userId: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    price: await getServicePrice(input.service),
    createdAt: new Date().toISOString(),
    status: "Reservada",
  };

  if (hasMysqlConfig()) {
    await getPool().execute(
      `INSERT INTO reservations
       (id, user_id, name, phone, email, service, price, date, time, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reservation.id,
        user.id,
        reservation.name,
        reservation.phone,
        reservation.email,
        reservation.service,
        reservation.price,
        reservation.date,
        reservation.time,
        reservation.status,
        new Date(reservation.createdAt),
      ],
    );
  } else {
    const reservations = await readLocalReservations();
    reservations.unshift(reservation);
    memoryReservations = reservations;
    await writeJson(localReservationsFile, reservations);
  }

  return reservation;
}
