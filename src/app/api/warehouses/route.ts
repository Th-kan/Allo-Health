import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const warehouses = await prisma.warehouse.findMany({
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(warehouses);
  } catch (error: any) {
    console.error("GET /api/warehouses error:", error);
    return NextResponse.json({ error: "Failed to fetch warehouses" }, { status: 500 });
  }
}
