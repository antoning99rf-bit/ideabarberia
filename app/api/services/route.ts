import { NextRequest, NextResponse } from "next/server";
import { deleteService, listServices, upsertService } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(request: NextRequest) {
  return request.headers.get("x-admin-password") === (process.env.ADMIN_PASSWORD || "admin123");
}

export async function GET(request: NextRequest) {
  const includeInactive = request.nextUrl.searchParams.get("admin") === "1" && isAdmin(request);
  const services = await listServices(includeInactive);
  return NextResponse.json({ services });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const service = await upsertService(await request.json());
    return NextResponse.json({ service });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el servicio." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id." }, { status: 400 });

  await deleteService(id);
  return NextResponse.json({ ok: true });
}
