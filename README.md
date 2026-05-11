# Barber Booking

Primera version funcional para una peluqueria/barberia: landing, registro de clientes, formulario de reservas, panel privado y API lista para Vercel.

## Desarrollo local

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## App instalable

La app esta preparada como PWA. Al estar publicada con HTTPS, los clientes pueden abrir la web desde el movil y usar la opcion del navegador:

- Android/Chrome: menu -> Anadir a pantalla de inicio.
- iPhone/Safari: compartir -> Anadir a pantalla de inicio.

El icono, el manifest y el service worker estan incluidos. En local el service worker solo se activa al ejecutar la app en modo produccion o al desplegarla.

## Variables de entorno

Copia `.env.example` a `.env.local`.

- `ADMIN_PASSWORD`: clave para entrar al panel privado en `/admin`.
- `AUTH_SECRET`: clave para firmar sesiones de clientes.
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`: si estan configuradas, usuarios y reservas se guardan en MySQL.
- `GOOGLE_CALENDAR_ID`: calendario donde crear eventos. Por defecto usa `primary`.
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`: credenciales de WhatsApp Cloud API.
- `WHATSAPP_TEMPLATE_NAME`: si se define, envia plantilla aprobada; si no, intenta enviar mensaje de texto libre.

Sin MySQL configurado, la app guarda usuarios y reservas en JSON local para desarrollo. En Vercel conviene configurar MySQL para persistencia real.

## MySQL

La app crea automaticamente estas tablas si no existen:

- `users`: datos de registro del cliente y contrasena hasheada.
- `reservations`: cita, cliente, servicio, precio, fecha, hora y estado.
- `services`: catalogo editable de servicios, precios y descripciones.
- `blocked_slots`: horas bloqueadas por el administrador.
- `working_hours`: horario semanal de apertura.

Puedes usar un MySQL gestionado compatible con Vercel, por ejemplo Railway, PlanetScale, Aiven, Clever Cloud o una base propia.

## Google

1. Crea una cuenta de servicio en Google Cloud.
2. Comparte el calendario con el email de la cuenta de servicio.
3. En Vercel, pega la private key con saltos de linea escapados como `\n`.

## WhatsApp

Para enviar confirmaciones reales necesitas WhatsApp Cloud API:

1. Configura `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.
2. Usa telefonos en formato internacional, por ejemplo `34600111222`.
3. En produccion, lo recomendable es configurar `WHATSAPP_TEMPLATE_NAME` con una plantilla aprobada.

## Panel privado

Visita `/admin` e introduce `ADMIN_PASSWORD`. En el entorno actual esta configurada como `peluqueriabruno123`.

Desde el panel puedes:

- Ver reservas.
- Añadir, editar, activar o desactivar servicios.
- Cambiar precios y descripciones.
- Bloquear horas concretas por fecha para que no aparezcan al cliente.
- Configurar dias de trabajo y tramos horarios. Por defecto: lunes a viernes de 09:00 a 14:00 y de 16:00 a 19:00; sabado y domingo cerrados.
- Cancelar citas ya reservadas.

El cliente elige la fecha con selector calendario y la hora desde un desplegable de horas disponibles. Las horas ya reservadas o bloqueadas no se ofrecen y el backend tambien las rechaza si alguien intenta enviarlas manualmente.
