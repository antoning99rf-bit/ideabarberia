import { promises as fs } from "fs";
import path from "path";
import { createHash, randomBytes, randomUUID } from "crypto";
import mysql from "mysql2/promise";
import { hashPassword, verifyPassword } from "./auth";
import { BusyRange, hasGoogleCalendarConfig, listCalendarBusyRanges } from "./reservations";
import {
  BlockedSlot,
  RecurrenceInput,
  RecurringSeries,
  Reservation,
  ReservationInput,
  ServiceItem,
  User,
  defaultServiceCatalog,
  defaultWorkingHours,
  WorkingDay,
} from "./types";

const SLOT_INTERVAL_MINUTES = 15;

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
const localPasswordResetTokensFile = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  "password-reset-tokens.local.json",
);
const localRecurringSeriesFile = path.join(
  process.env.VERCEL ? "/tmp" : process.cwd(),
  "recurring-series.local.json",
);

let pool: mysql.Pool | null = null;
let schemaReady = false;
let memoryUsers: StoredUser[] = [];
let memoryReservations: Reservation[] = [];
let memoryServices: ServiceItem[] = defaultServiceCatalog;
let memoryBlockedSlots: BlockedSlot[] = [];
let memoryWorkingHours: WorkingDay[] = defaultWorkingHours;
let memoryPasswordResetTokens: PasswordResetToken[] = [];
let memoryRecurringSeries: RecurringSeries[] = [];

type PasswordResetToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string | null;
  createdAt: string;
};

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
      ...getMysqlConnectionOptions(),
      waitForConnections: true,
      connectionLimit: 5,
    });
  }

  return pool;
}

function getMysqlConnectionOptions(): mysql.ConnectionOptions {
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 10000,
  };
}

function isMysqlConnectionError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : "";

  return (
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    message.includes("Connection lost") ||
    message.includes("closed the connection")
  );
}

async function resetPool() {
  const currentPool = pool;
  pool = null;
  schemaReady = false;

  if (currentPool) {
    await currentPool.end().catch(() => undefined);
  }
}

async function withFreshConnection<T>(operation: (db: mysql.Connection) => Promise<T>) {
  const connection = await mysql.createConnection(getMysqlConnectionOptions());

  try {
    return await operation(connection);
  } finally {
    await connection.end().catch(() => undefined);
  }
}

async function withMysqlRetry<T>(operation: (db: mysql.Connection) => Promise<T>) {
  try {
    return await withFreshConnection(operation);
  } catch (error) {
    if (!isMysqlConnectionError(error)) throw error;

    await resetPool();
    return withFreshConnection(operation);
  }
}

function queryDb<T extends mysql.QueryResult>(sql: string, values?: any[]) {
  return withMysqlRetry((db) => db.query<T>(sql, values));
}

function executeDb<T extends mysql.QueryResult>(sql: string, values?: any[]) {
  return withMysqlRetry((db) => db.execute<T>(sql, values));
}

async function ensureSchema() {
  if (!hasMysqlConfig() || schemaReady) return;

  await queryDb(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(190) NOT NULL,
      blocked_at DATETIME NULL,
      blocked_reason VARCHAR(255) NULL,
      created_at DATETIME NOT NULL
    )
  `);
  await queryDb("ALTER TABLE users ADD COLUMN blocked_at DATETIME NULL").catch(() => undefined);
  await queryDb("ALTER TABLE users ADD COLUMN blocked_reason VARCHAR(255) NULL").catch(() => undefined);
  await queryDb(`
    CREATE TABLE IF NOT EXISTS reservations (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      email VARCHAR(190) NOT NULL,
      service VARCHAR(80) NOT NULL,
      price DECIMAL(8,2) NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 30,
      calendar_event_id VARCHAR(255) NULL,
      date DATE NOT NULL,
      time VARCHAR(5) NOT NULL,
      status VARCHAR(40) NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX reservations_user_id_idx (user_id),
      CONSTRAINT reservations_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await queryDb(`
    CREATE TABLE IF NOT EXISTS services (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      price DECIMAL(8,2) NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 30,
      description VARCHAR(255) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
  await queryDb("ALTER TABLE services ADD COLUMN duration_minutes INT NOT NULL DEFAULT 30").catch(() => undefined);
  await queryDb("ALTER TABLE reservations ADD COLUMN duration_minutes INT NOT NULL DEFAULT 30").catch(() => undefined);
  await queryDb("ALTER TABLE reservations ADD COLUMN calendar_event_id VARCHAR(255) NULL").catch(() => undefined);
  await queryDb("ALTER TABLE reservations ADD COLUMN series_id VARCHAR(36) NULL").catch(() => undefined);
  await queryDb("ALTER TABLE reservations ADD COLUMN series_index INT NULL").catch(() => undefined);
  await queryDb("ALTER TABLE reservations ADD COLUMN start_at_utc DATETIME NULL").catch(() => undefined);
  await queryDb("ALTER TABLE reservations ADD COLUMN end_at_utc DATETIME NULL").catch(() => undefined);
  await queryDb("CREATE INDEX reservations_series_id_idx ON reservations (series_id)").catch(() => undefined);
  await queryDb("CREATE UNIQUE INDEX reservations_series_index_idx ON reservations (series_id, series_index)").catch(() => undefined);
  await queryDb(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id VARCHAR(36) PRIMARY KEY,
      date DATE NOT NULL,
      time VARCHAR(5) NOT NULL,
      reason VARCHAR(160) NOT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY blocked_slots_date_time_idx (date, time)
    )
  `);
  await queryDb(`
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
  await queryDb(`
    CREATE TABLE IF NOT EXISTS recurring_series (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      email VARCHAR(190) NOT NULL,
      service VARCHAR(80) NOT NULL,
      price DECIMAL(8,2) NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 30,
      recurrence_rule VARCHAR(20) NOT NULL,
      recurrence_interval INT NOT NULL DEFAULT 1,
      recurrence_end_mode VARCHAR(20) NOT NULL,
      recurrence_end_date DATE NULL,
      recurrence_count INT NULL,
      start_date DATE NOT NULL,
      start_time VARCHAR(5) NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX recurring_series_user_id_idx (user_id),
      INDEX recurring_series_status_idx (status),
      CONSTRAINT recurring_series_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await queryDb(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      INDEX password_reset_user_id_idx (user_id),
      INDEX password_reset_token_hash_idx (token_hash),
      CONSTRAINT password_reset_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const [serviceRows] = await executeDb<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM services",
  );
  if (Number(serviceRows[0]?.total || 0) === 0) {
    await Promise.all(
      defaultServiceCatalog.map((service) =>
        executeDb(
          `INSERT INTO services (id, name, price, duration_minutes, description, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            service.id,
            service.name,
            service.price,
            service.durationMinutes,
            service.description,
            service.active ? 1 : 0,
            new Date(),
            new Date(),
          ],
        ),
      ),
    );
  }

  const [workingRows] = await executeDb<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM working_hours",
  );
  if (Number(workingRows[0]?.total || 0) === 0) {
    await Promise.all(
      defaultWorkingHours.map((day) =>
        executeDb(
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

async function readLocalPasswordResetTokens() {
  memoryPasswordResetTokens = await readJson(
    localPasswordResetTokensFile,
    memoryPasswordResetTokens,
  );
  return memoryPasswordResetTokens;
}

async function readLocalRecurringSeries() {
  memoryRecurringSeries = await readJson(localRecurringSeriesFile, memoryRecurringSeries);
  return memoryRecurringSeries;
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function publicUser(user: StoredUser): User {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    createdAt: user.createdAt,
    blockedAt: user.blockedAt || null,
    blockedReason: user.blockedReason || null,
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

function localDateTimeToUtc(date: string, time: string, timeZone = process.env.TIME_ZONE || "Atlantic/Canary") {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcGuess));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const shownAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = shownAsUtc - utcGuess;

  return new Date(utcGuess - offset);
}

function getReservationUtcRange(date: string, time: string, durationMinutes: number) {
  const start = localDateTimeToUtc(date, time);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  return { start, end };
}

function slotsForRange(start: string, end: string, durationMinutes = 30) {
  const slots: string[] = [];
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);

  for (
    let minutes = startMinutes;
    minutes + durationMinutes <= endMinutes;
    minutes += SLOT_INTERVAL_MINUTES
  ) {
    slots.push(toTime(minutes));
  }

  return slots;
}

function addDateInterval(date: string, frequency: RecurrenceInput["frequency"], interval: number) {
  const current = new Date(`${date}T00:00:00.000Z`);

  if (frequency === "months") {
    const originalDay = current.getUTCDate();
    current.setUTCDate(1);
    current.setUTCMonth(current.getUTCMonth() + interval);
    const lastDay = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0),
    ).getUTCDate();
    current.setUTCDate(Math.min(originalDay, lastDay));
  } else {
    current.setUTCDate(
      current.getUTCDate() + interval * (frequency === "weeks" ? 7 : 1),
    );
  }

  return current.toISOString().slice(0, 10);
}

function normalizeRecurrence(input?: RecurrenceInput): RecurrenceInput | null {
  if (!input || input.frequency === "none") return null;

  const interval = Math.max(1, Math.min(36, Number(input.interval || 1)));
  const endMode = input.endMode || "count";
  const count = Math.max(1, Math.min(200, Number(input.count || 10)));

  return {
    frequency: input.frequency,
    interval,
    endMode,
    count: endMode === "count" ? count : undefined,
    endDate: endMode === "date" ? input.endDate : undefined,
  };
}

function generateOccurrenceDates(startDate: string, recurrence?: RecurrenceInput) {
  const normalized = normalizeRecurrence(recurrence);
  if (!normalized) return [startDate];

  const dates: string[] = [];
  const maxOccurrences =
    normalized.endMode === "count" ? normalized.count || 1 : normalized.endMode === "date" ? 200 : 52;
  let currentDate = startDate;

  while (dates.length < maxOccurrences) {
    if (normalized.endMode === "date" && normalized.endDate && currentDate > normalized.endDate) {
      break;
    }

    dates.push(currentDate);
    currentDate = addDateInterval(currentDate, normalized.frequency, normalized.interval);
  }

  return dates;
}

function describeRecurrence(series: RecurringSeries) {
  const unit =
    series.recurrenceFrequency === "days"
      ? "dias"
      : series.recurrenceFrequency === "weeks"
        ? "semanas"
        : "meses";
  return `Cada ${series.recurrenceInterval} ${unit}`;
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
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
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
        executeDb(
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

async function getSlotsForDate(date: string, durationMinutes = 30) {
  const parsedDate = new Date(`${date}T00:00:00`);
  const dayOfWeek = parsedDate.getDay();
  const day = (await getWorkingHours()).find((workingDay) => workingDay.dayOfWeek === dayOfWeek);

  if (!day?.active) return [];

  return [
    ...slotsForRange(day.morningStart, day.morningEnd, durationMinutes),
    ...slotsForRange(day.afternoonStart, day.afternoonEnd, durationMinutes),
  ];
}

export async function listServices(includeInactive = false): Promise<ServiceItem[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, name, price, duration_minutes, description, active
       FROM services
       ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY name ASC`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      price: Number(row.price),
      durationMinutes: Number(row.duration_minutes || 30),
      description: row.description,
      active: Boolean(row.active),
    }));
  }

  const services = await readLocalServices();
  return includeInactive ? services : services.filter((service) => service.active);
}

export async function getServiceByName(serviceName: string) {
  return (await listServices(true)).find(
    (currentService) => currentService.name === serviceName && currentService.active,
  );
}

export async function getServicePrice(serviceName: string) {
  const service = await getServiceByName(serviceName);
  return service?.price ?? 0;
}

export async function upsertService(input: Partial<ServiceItem> & Pick<ServiceItem, "name">) {
  await ensureSchema();
  const now = new Date();
  const service: ServiceItem = {
    id: input.id || randomUUID(),
    name: input.name.trim(),
    price: Number(input.price || 0),
    durationMinutes: Number(input.durationMinutes || 30),
    description: input.description?.trim() || "",
    active: input.active ?? true,
  };

  if (!service.name) throw new Error("El nombre del servicio es obligatorio.");

  if (hasMysqlConfig()) {
    await executeDb(
      `INSERT INTO services (id, name, price, duration_minutes, description, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name), price = VALUES(price), duration_minutes = VALUES(duration_minutes),
       description = VALUES(description),
       active = VALUES(active), updated_at = VALUES(updated_at)`,
      [
        service.id,
        service.name,
        service.price,
        service.durationMinutes,
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
    await executeDb("UPDATE services SET active = 0, updated_at = ? WHERE id = ?", [
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
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
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
    await executeDb(
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
    await executeDb("DELETE FROM blocked_slots WHERE id = ?", [id]);
  } else {
    memoryBlockedSlots = (await readLocalBlockedSlots()).filter((slot) => slot.id !== id);
    await writeJson(localBlockedSlotsFile, memoryBlockedSlots);
  }
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function getCurrentCanaryDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TIME_ZONE || "Atlantic/Canary",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: toMinutes(`${get("hour")}:${get("minute")}`),
  };
}

function isPastSlot(date: string, slot: string) {
  const now = getCurrentCanaryDateTime();
  if (date < now.date) return true;
  return date === now.date && toMinutes(slot) < now.minutes;
}

export async function getAvailability(date: string, serviceName?: string) {
  const service = serviceName ? await getServiceByName(serviceName) : null;
  const durationMinutes = service?.durationMinutes || 30;
  const slots = date ? await getSlotsForDate(date, durationMinutes) : getDefaultTimeSlots();
  if (!date) return { date, slots, unavailable: [], available: [] };

  const [reservations, blockedSlots, calendarBusyRanges] = await Promise.all([
    listReservations(),
    listBlockedSlots(),
    listCalendarBusyRanges(date),
  ]);
  const unavailable = new Set<string>();
  const busyRanges: BusyRange[] = [
    ...reservations
      .filter(
        (reservation) =>
          reservation.date === date &&
          (!hasGoogleCalendarConfig() || !reservation.calendarEventId),
      )
      .map((reservation) => {
        const start = toMinutes(reservation.time);
        return {
          start,
          end: start + (reservation.durationMinutes || 30),
        };
      }),
    ...blockedSlots
      .filter((blockedSlot) => blockedSlot.date === date)
      .map((blockedSlot) => {
        const start = toMinutes(blockedSlot.time);
        return {
          start,
          end: start + SLOT_INTERVAL_MINUTES,
        };
      }),
    ...calendarBusyRanges,
  ];

  for (const slot of slots) {
    const start = toMinutes(slot);
    const end = start + durationMinutes;
    const hasOverlap = busyRanges.some((busyRange) =>
      overlaps(start, end, busyRange.start, busyRange.end),
    );

    if (isPastSlot(date, slot) || hasOverlap) unavailable.add(slot);
  }

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
  const availability = await getAvailability(input.date, input.service);

  if (!activeServices.some((service) => service.name === input.service)) {
    errors.push("Servicio invalido.");
  }
  if (!input.date) errors.push("Fecha obligatoria.");
  if (!input.time) errors.push("Hora obligatoria.");
  if (input.date && input.time && !availability.available.includes(input.time)) {
    errors.push("Ese horario acaba de ocuparse. Por favor, elige otra hora.");
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
    await executeDb(
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
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, name, phone, email, password_hash, blocked_at, blocked_reason, created_at
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
      blockedAt: row.blocked_at ? new Date(row.blocked_at).toISOString() : null,
      blockedReason: row.blocked_reason || null,
    } satisfies User;
  }

  const users = await readLocalUsers();
  const user = users.find((currentUser) => currentUser.email === normalizedEmail);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;

  return publicUser(user);
}

export async function findUserByEmail(email: string) {
  await ensureSchema();
  const normalizedEmail = email.trim().toLowerCase();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, name, phone, email, blocked_at, blocked_reason, created_at
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      createdAt: new Date(row.created_at).toISOString(),
      blockedAt: row.blocked_at ? new Date(row.blocked_at).toISOString() : null,
      blockedReason: row.blocked_reason || null,
    } satisfies User;
  }

  const users = await readLocalUsers();
  const user = users.find((currentUser) => currentUser.email === normalizedEmail);
  return user ? publicUser(user) : null;
}

export async function getUserById(id: string) {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, name, phone, email, blocked_at, blocked_reason, created_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      createdAt: new Date(row.created_at).toISOString(),
      blockedAt: row.blocked_at ? new Date(row.blocked_at).toISOString() : null,
      blockedReason: row.blocked_reason || null,
    } satisfies User;
  }

  const user = (await readLocalUsers()).find((currentUser) => currentUser.id === id);
  return user ? publicUser(user) : null;
}

export async function listUsers(): Promise<User[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, name, phone, email, blocked_at, blocked_reason, created_at
       FROM users
       ORDER BY created_at DESC`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      createdAt: new Date(row.created_at).toISOString(),
      blockedAt: row.blocked_at ? new Date(row.blocked_at).toISOString() : null,
      blockedReason: row.blocked_reason || null,
    }));
  }

  return (await readLocalUsers()).map(publicUser);
}

export async function setUserBlocked(input: {
  userId: string;
  blocked: boolean;
  reason?: string;
}) {
  await ensureSchema();
  const reason = input.reason?.trim() || "Incumplimiento de asistencia a citas.";
  const blockedAt = input.blocked ? new Date() : null;

  if (hasMysqlConfig()) {
    await executeDb(
      "UPDATE users SET blocked_at = ?, blocked_reason = ? WHERE id = ?",
      [blockedAt, input.blocked ? reason : null, input.userId],
    );
    return getUserById(input.userId);
  }

  const users = await readLocalUsers();
  memoryUsers = users.map((user) =>
    user.id === input.userId
      ? {
          ...user,
          blockedAt: blockedAt?.toISOString() || null,
          blockedReason: input.blocked ? reason : null,
        }
      : user,
  );
  await writeJson(localUsersFile, memoryUsers);
  return getUserById(input.userId);
}

export async function assertUserCanBook(userId: string) {
  const user = await getUserById(userId);
  if (!user) throw new Error("Usuario no encontrado.");
  if (user.blockedAt) {
    throw new Error(
      `Tu cuenta esta bloqueada para nuevas reservas. Motivo: ${
        user.blockedReason || "contacta con la barberia"
      }.`,
    );
  }
  return user;
}

export async function createPasswordResetToken(email: string) {
  await ensureSchema();
  const user = await findUserByEmail(email);
  if (!user) return null;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const resetToken: PasswordResetToken = {
    id: randomUUID(),
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    usedAt: null,
    createdAt: new Date().toISOString(),
  };

  if (hasMysqlConfig()) {
    await executeDb("DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at < ?", [
      user.id,
      new Date(),
    ]);
    await executeDb(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        resetToken.id,
        resetToken.userId,
        resetToken.tokenHash,
        new Date(resetToken.expiresAt),
        null,
        new Date(resetToken.createdAt),
      ],
    );
  } else {
    const tokens = (await readLocalPasswordResetTokens()).filter(
      (currentToken) =>
        currentToken.userId !== user.id && new Date(currentToken.expiresAt).getTime() > Date.now(),
    );
    tokens.push(resetToken);
    memoryPasswordResetTokens = tokens;
    await writeJson(localPasswordResetTokensFile, tokens);
  }

  return { user, token };
}

export async function resetPasswordWithToken(token: string, password: string) {
  await ensureSchema();
  if (!token || password.length < 6) return false;

  const tokenHash = hashResetToken(token);

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = ?
       LIMIT 1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return false;

    await executeDb("UPDATE users SET password_hash = ? WHERE id = ?", [
      hashPassword(password),
      row.user_id,
    ]);
    await executeDb("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", [
      new Date(),
      row.id,
    ]);
    return true;
  }

  const tokens = await readLocalPasswordResetTokens();
  const resetToken = tokens.find((currentToken) => currentToken.tokenHash === tokenHash);
  if (!resetToken || resetToken.usedAt || new Date(resetToken.expiresAt).getTime() < Date.now()) {
    return false;
  }

  const users = await readLocalUsers();
  const nextUsers = users.map((user) =>
    user.id === resetToken.userId ? { ...user, passwordHash: hashPassword(password) } : user,
  );
  const nextTokens = tokens.map((currentToken) =>
    currentToken.id === resetToken.id
      ? { ...currentToken, usedAt: new Date().toISOString() }
      : currentToken,
  );

  memoryUsers = nextUsers;
  memoryPasswordResetTokens = nextTokens;
  await writeJson(localUsersFile, nextUsers);
  await writeJson(localPasswordResetTokensFile, nextTokens);
  return true;
}

export async function listReservations(): Promise<Reservation[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, user_id, name, phone, email, service, price, duration_minutes, calendar_event_id, series_id, series_index, date, time, status, created_at
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
      durationMinutes: Number(row.duration_minutes || 30),
      calendarEventId: row.calendar_event_id || null,
      seriesId: row.series_id || null,
      seriesIndex: row.series_index ?? null,
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
      time: row.time,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  return readLocalReservations();
}

export async function listReservationsByUser(userId: string): Promise<Reservation[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, user_id, name, phone, email, service, price, duration_minutes, calendar_event_id, series_id, series_index, date, time, status, created_at
       FROM reservations
       WHERE user_id = ?
       ORDER BY date ASC, time ASC`,
      [userId],
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      service: row.service,
      price: Number(row.price),
      durationMinutes: Number(row.duration_minutes || 30),
      calendarEventId: row.calendar_event_id || null,
      seriesId: row.series_id || null,
      seriesIndex: row.series_index ?? null,
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
      time: row.time,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  const reservations = await readLocalReservations();
  return reservations
    .filter((reservation) => reservation.userId === userId)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export async function getReservationById(id: string): Promise<Reservation | null> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT id, user_id, name, phone, email, service, price, duration_minutes, calendar_event_id, series_id, series_index, date, time, status, created_at
       FROM reservations
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      service: row.service,
      price: Number(row.price),
      durationMinutes: Number(row.duration_minutes || 30),
      calendarEventId: row.calendar_event_id || null,
      seriesId: row.series_id || null,
      seriesIndex: row.series_index ?? null,
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
      time: row.time,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  const reservations = await readLocalReservations();
  return reservations.find((reservation) => reservation.id === id) || null;
}

export async function deleteReservation(id: string) {
  await ensureSchema();

  if (hasMysqlConfig()) {
    await executeDb("DELETE FROM reservations WHERE id = ?", [id]);
    return;
  }

  const reservations = await readLocalReservations();
  memoryReservations = reservations.filter((reservation) => reservation.id !== id);
  await writeJson(localReservationsFile, memoryReservations);
}

export async function updateReservationCalendarEventId(id: string, calendarEventId: string | null) {
  await ensureSchema();

  if (hasMysqlConfig()) {
    await executeDb("UPDATE reservations SET calendar_event_id = ? WHERE id = ?", [
      calendarEventId,
      id,
    ]);
    return;
  }

  const reservations = await readLocalReservations();
  memoryReservations = reservations.map((reservation) =>
    reservation.id === id ? { ...reservation, calendarEventId } : reservation,
  );
  await writeJson(localReservationsFile, memoryReservations);
}

export async function updateReservationSchedule(
  id: string,
  input: { date: string; time: string; durationMinutes: number },
) {
  await ensureSchema();
  const utcRange = getReservationUtcRange(input.date, input.time, input.durationMinutes);

  if (hasMysqlConfig()) {
    await executeDb(
      "UPDATE reservations SET date = ?, time = ?, duration_minutes = ?, start_at_utc = ?, end_at_utc = ? WHERE id = ?",
      [input.date, input.time, input.durationMinutes, utcRange.start, utcRange.end, id],
    );
    return;
  }

  const reservations = await readLocalReservations();
  memoryReservations = reservations.map((reservation) =>
    reservation.id === id
      ? {
          ...reservation,
          date: input.date,
          time: input.time,
          durationMinutes: input.durationMinutes,
        }
      : reservation,
  );
  await writeJson(localReservationsFile, memoryReservations);
}

type SaveReservationOptions = {
  seriesId?: string | null;
  seriesIndex?: number | null;
};

export async function saveReservation(
  input: ReservationInput,
  user: User,
  options: SaveReservationOptions = {},
): Promise<Reservation> {
  await ensureSchema();

  const durationMinutes = (await getServiceByName(input.service))?.durationMinutes || 30;
  const utcRange = getReservationUtcRange(input.date, input.time, durationMinutes);
  const reservation: Reservation = {
    service: input.service,
    date: input.date,
    time: input.time,
    id: randomUUID(),
    userId: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    price: await getServicePrice(input.service),
    durationMinutes,
    calendarEventId: null,
    seriesId: options.seriesId ?? null,
    seriesIndex: options.seriesIndex ?? null,
    createdAt: new Date().toISOString(),
    status: "Reservada",
  };

  if (hasMysqlConfig()) {
    await executeDb(
      `INSERT INTO reservations
       (id, user_id, name, phone, email, service, price, duration_minutes, calendar_event_id, series_id, series_index, date, time, status, created_at, start_at_utc, end_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reservation.id,
        user.id,
        reservation.name,
        reservation.phone,
        reservation.email,
        reservation.service,
        reservation.price,
        reservation.durationMinutes,
        reservation.calendarEventId ?? null,
        reservation.seriesId ?? null,
        reservation.seriesIndex ?? null,
        reservation.date,
        reservation.time,
        reservation.status,
        new Date(reservation.createdAt),
        utcRange.start,
        utcRange.end,
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

export async function saveRecurringReservations(
  input: ReservationInput,
  user: User,
): Promise<{ series: RecurringSeries | null; reservations: Reservation[] }> {
  const recurrence = normalizeRecurrence(input.recurrence);
  if (!recurrence) {
    const reservation = await saveReservation(input, user);
    return { series: null, reservations: [reservation] };
  }
  if (recurrence.endMode === "date" && !recurrence.endDate) {
    throw new Error("Selecciona la fecha final de la recurrencia.");
  }

  await ensureSchema();
  const dates = generateOccurrenceDates(input.date, recurrence);
  if (!dates.length) throw new Error("La recurrencia no genera ninguna cita.");

  for (const date of dates) {
    const errors = await validateReservation({ service: input.service, date, time: input.time });
    if (errors.length) {
      throw new Error(`Conflicto el ${date} a las ${input.time}: ${errors.join(" ")}`);
    }
  }

  const service = await getServiceByName(input.service);
  const now = new Date().toISOString();
  const series: RecurringSeries = {
    id: randomUUID(),
    userId: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    service: input.service,
    price: service?.price ?? 0,
    durationMinutes: service?.durationMinutes ?? 30,
    recurrenceFrequency: recurrence.frequency,
    recurrenceInterval: recurrence.interval,
    recurrenceEndMode: recurrence.endMode,
    recurrenceEndDate: recurrence.endDate || null,
    recurrenceCount: recurrence.count || null,
    startDate: input.date,
    startTime: input.time,
    status: "active",
    createdAt: now,
    updatedAt: now,
    nextDate: input.date,
    generatedCount: dates.length,
  };

  if (hasMysqlConfig()) {
    await executeDb(
      `INSERT INTO recurring_series
       (id, user_id, name, phone, email, service, price, duration_minutes, recurrence_rule,
        recurrence_interval, recurrence_end_mode, recurrence_end_date, recurrence_count,
        start_date, start_time, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        series.id,
        series.userId,
        series.name,
        series.phone,
        series.email,
        series.service,
        series.price,
        series.durationMinutes,
        series.recurrenceFrequency,
        series.recurrenceInterval,
        series.recurrenceEndMode,
        series.recurrenceEndDate || null,
        series.recurrenceCount || null,
        series.startDate,
        series.startTime,
        series.status,
        new Date(series.createdAt),
        new Date(series.updatedAt),
      ],
    );
  } else {
    const seriesList = await readLocalRecurringSeries();
    seriesList.unshift(series);
    memoryRecurringSeries = seriesList;
    await writeJson(localRecurringSeriesFile, seriesList);
  }

  const reservations: Reservation[] = [];
  for (let index = 0; index < dates.length; index += 1) {
    reservations.push(
      await saveReservation(
        { service: input.service, date: dates[index], time: input.time },
        user,
        { seriesId: series.id, seriesIndex: index + 1 },
      ),
    );
  }

  return { series, reservations };
}

export async function listRecurringSeries(): Promise<RecurringSeries[]> {
  await ensureSchema();

  if (hasMysqlConfig()) {
    const [rows] = await executeDb<mysql.RowDataPacket[]>(
      `SELECT
        s.id, s.user_id, s.name, s.phone, s.email, s.service, s.price, s.duration_minutes,
        s.recurrence_rule, s.recurrence_interval, s.recurrence_end_mode,
        s.recurrence_end_date, s.recurrence_count, s.start_date, s.start_time,
        s.status, s.created_at, s.updated_at,
        COALESCE(stats.generated_count, 0) AS generated_count,
        stats.next_date
       FROM recurring_series s
       LEFT JOIN (
         SELECT
           series_id,
           COUNT(id) AS generated_count,
           MIN(CASE WHEN date >= CURDATE() THEN date ELSE NULL END) AS next_date
         FROM reservations
         WHERE series_id IS NOT NULL
         GROUP BY series_id
       ) stats ON stats.series_id = s.id
       ORDER BY s.created_at DESC`,
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      service: row.service,
      price: Number(row.price),
      durationMinutes: Number(row.duration_minutes || 30),
      recurrenceFrequency: row.recurrence_rule,
      recurrenceInterval: Number(row.recurrence_interval || 1),
      recurrenceEndMode: row.recurrence_end_mode,
      recurrenceEndDate:
        row.recurrence_end_date instanceof Date
          ? row.recurrence_end_date.toISOString().slice(0, 10)
          : row.recurrence_end_date
            ? String(row.recurrence_end_date)
            : null,
      recurrenceCount: row.recurrence_count === null ? null : Number(row.recurrence_count),
      startDate:
        row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : String(row.start_date),
      startTime: row.start_time,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      nextDate:
        row.next_date instanceof Date
          ? row.next_date.toISOString().slice(0, 10)
          : row.next_date
            ? String(row.next_date)
            : null,
      generatedCount: Number(row.generated_count || 0),
    }));
  }

  const reservations = await readLocalReservations();
  return (await readLocalRecurringSeries()).map((series) => {
    const seriesReservations = reservations.filter((reservation) => reservation.seriesId === series.id);
    const future = seriesReservations
      .map((reservation) => reservation.date)
      .filter((date) => date >= new Date().toISOString().slice(0, 10))
      .sort()[0];
    return {
      ...series,
      nextDate: future || null,
      generatedCount: seriesReservations.length,
    };
  });
}

export async function updateRecurringSeriesStatus(id: string, status: RecurringSeries["status"]) {
  await ensureSchema();

  if (hasMysqlConfig()) {
    await executeDb("UPDATE recurring_series SET status = ?, updated_at = ? WHERE id = ?", [
      status,
      new Date(),
      id,
    ]);
    return;
  }

  memoryRecurringSeries = (await readLocalRecurringSeries()).map((series) =>
    series.id === id ? { ...series, status, updatedAt: new Date().toISOString() } : series,
  );
  await writeJson(localRecurringSeriesFile, memoryRecurringSeries);
}

export async function listReservationsBySeries(seriesId: string): Promise<Reservation[]> {
  return (await listReservations())
    .filter((reservation) => reservation.seriesId === seriesId)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export async function deleteReservationsBySeries(seriesId: string) {
  const reservations = await listReservationsBySeries(seriesId);

  if (hasMysqlConfig()) {
    await executeDb("DELETE FROM reservations WHERE series_id = ?", [seriesId]);
  } else {
    memoryReservations = (await readLocalReservations()).filter(
      (reservation) => reservation.seriesId !== seriesId,
    );
    await writeJson(localReservationsFile, memoryReservations);
  }

  await updateRecurringSeriesStatus(seriesId, "cancelled");
  return reservations;
}

export { describeRecurrence };
