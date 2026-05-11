export type ServiceItem = {
  id: string;
  name: string;
  price: number;
  description: string;
  active: boolean;
};

export const defaultServiceCatalog: ServiceItem[] = [
  {
    id: "corte",
    name: "Corte",
    price: 18,
    description: "Precision, estilo y acabado.",
    active: true,
  },
  {
    id: "barba",
    name: "Barba",
    price: 12,
    description: "Perfilado y cuidado clasico.",
    active: true,
  },
  {
    id: "corte-barba",
    name: "Corte + barba",
    price: 26,
    description: "La experiencia completa.",
    active: true,
  },
  {
    id: "tinte",
    name: "Tinte",
    price: 35,
    description: "Color con acabado natural.",
    active: true,
  },
  {
    id: "peinado",
    name: "Peinado",
    price: 15,
    description: "Listo para cualquier ocasion.",
    active: true,
  },
  {
    id: "otro",
    name: "Otro",
    price: 0,
    description: "Cuéntanos que necesitas.",
    active: true,
  },
];

export type Service = string;

export type ReservationInput = {
  service: Service;
  date: string;
  time: string;
};

export type Reservation = ReservationInput & {
  id: string;
  userId?: string;
  createdAt: string;
  name: string;
  phone: string;
  email: string;
  price: number;
  status: string;
};

export type BlockedSlot = {
  id: string;
  date: string;
  time: string;
  reason: string;
  createdAt: string;
};

export type WorkingDay = {
  dayOfWeek: number;
  label: string;
  active: boolean;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

export const defaultWorkingHours: WorkingDay[] = [
  {
    dayOfWeek: 1,
    label: "Lunes",
    active: true,
    morningStart: "09:00",
    morningEnd: "14:00",
    afternoonStart: "16:00",
    afternoonEnd: "19:00",
  },
  {
    dayOfWeek: 2,
    label: "Martes",
    active: true,
    morningStart: "09:00",
    morningEnd: "14:00",
    afternoonStart: "16:00",
    afternoonEnd: "19:00",
  },
  {
    dayOfWeek: 3,
    label: "Miercoles",
    active: true,
    morningStart: "09:00",
    morningEnd: "14:00",
    afternoonStart: "16:00",
    afternoonEnd: "19:00",
  },
  {
    dayOfWeek: 4,
    label: "Jueves",
    active: true,
    morningStart: "09:00",
    morningEnd: "14:00",
    afternoonStart: "16:00",
    afternoonEnd: "19:00",
  },
  {
    dayOfWeek: 5,
    label: "Viernes",
    active: true,
    morningStart: "09:00",
    morningEnd: "14:00",
    afternoonStart: "16:00",
    afternoonEnd: "19:00",
  },
  {
    dayOfWeek: 6,
    label: "Sabado",
    active: false,
    morningStart: "09:00",
    morningEnd: "14:00",
    afternoonStart: "16:00",
    afternoonEnd: "19:00",
  },
  {
    dayOfWeek: 0,
    label: "Domingo",
    active: false,
    morningStart: "09:00",
    morningEnd: "14:00",
    afternoonStart: "16:00",
    afternoonEnd: "19:00",
  },
];

export type User = {
  id: string;
  name: string;
  phone: string;
  email: string;
  createdAt: string;
};

export type IntegrationResult = {
  name: string;
  ok: boolean;
  detail: string;
};
