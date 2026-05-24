import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Lazy cleanup of expired reservations before reading stock levels
    await cleanupExpiredReservations();

    // 2. Fetch products and associated inventories
    const products = await prisma.product.findMany({
      include: {
        inventories: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // 3. Format response, calculating available stock dynamically
    const formattedProducts = products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      description: product.description,
      imageUrl: product.imageUrl,
      inventories: product.inventories.map((inv) => ({
        id: inv.id,
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouse.name,
        warehouseCode: inv.warehouse.code,
        total: inv.total,
        reserved: inv.reserved,
        available: Math.max(0, inv.total - inv.reserved),
      })),
    }));

    return NextResponse.json(formattedProducts);
  } catch (error: any) {
    console.error("GET /api/products error:", error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
}
