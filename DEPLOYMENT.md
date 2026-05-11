# Despliegue a produccion

Esta app esta preparada para Vercel + MySQL online + WhatsApp Cloud API.

## 1. GitHub

Sube el proyecto a un repositorio privado o publico en GitHub.

```bash
git add .
git commit -m "Initial barber booking app"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

## 2. Base de datos MySQL

Crea una base de datos MySQL online en Railway, Aiven, PlanetScale, Clever Cloud u otro proveedor compatible.

Guarda estos datos:

- Host
- Puerto
- Nombre de base de datos
- Usuario
- Password
- SSL activado si el proveedor lo requiere

La app crea automaticamente las tablas:

- `users`
- `reservations`
- `services`
- `blocked_slots`
- `working_hours`

## 3. Vercel

1. Entra en Vercel.
2. Importa el repositorio de GitHub.
3. Framework: Next.js.
4. Build command: `npm run build`.
5. Output: automatico.
6. Añade las variables de `.env.production.example`.
7. Pulsa Deploy.

## 4. WhatsApp

Para confirmaciones reales necesitas WhatsApp Cloud API de Meta:

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TEMPLATE_NAME`
- `WHATSAPP_LANGUAGE=es`

La plantilla recomendada:

```text
Hola {{1}}, tu cita para {{2}} ({{3}}) queda reservada el {{4}} a las {{5}}.
```

La app envia:

1. Nombre
2. Servicio
3. Precio
4. Fecha
5. Hora

## 5. App instalable

La app ya es PWA. Cuando este en Vercel con HTTPS:

- Android/Chrome: menu -> Anadir a pantalla de inicio.
- iPhone/Safari: compartir -> Anadir a pantalla de inicio.

## 6. Panel privado

El dueño entra en:

```text
https://TU_DOMINIO/admin
```

La clave es `ADMIN_PASSWORD`.
