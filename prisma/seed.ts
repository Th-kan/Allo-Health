import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding started...");
  
  // Clean up existing data
  await prisma.idempotentRequest.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  // Create Warehouses
  const whA = await prisma.warehouse.create({
    data: { name: "Singapore Main Warehouse", code: "SG-MAIN" }
  });
  const whB = await prisma.warehouse.create({
    data: { name: "Tokyo Fulfillment Center", code: "TYO-FMC" }
  });
  console.log("Seeded warehouses.");

  // Create Products
  const tee = await prisma.product.create({
    data: {
      name: "Allo Classic Tee",
      sku: "ALLO-TEE-001",
      price: 2999, // $29.99
      description: "Made from 100% organic cotton, the Allo Classic Tee is designed for ultimate comfort and durability. Features a sleek minimalist design suitable for any occasion.",
      imageUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=80"
    }
  });

  const hoodie = await prisma.product.create({
    data: {
      name: "Allo Tech Hoodie",
      sku: "ALLO-HD-002",
      price: 5999, // $59.99
      description: "A premium heavyweight hoodie featuring tech pockets, weather-resistant fabric, and a structured fit. Perfect for transition weather.",
      imageUrl: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800&auto=format&fit=crop&q=80"
    }
  });

  const cap = await prisma.product.create({
    data: {
      name: "Allo Curved Cap",
      sku: "ALLO-CAP-003",
      price: 1999, // $19.99
      description: "Classic 6-panel strapback cap with embroidered Allo branding. Features an adjustable brass clasp for a custom fit.",
      imageUrl: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=800&auto=format&fit=crop&q=80"
    }
  });

  const stickers = await prisma.product.create({
    data: {
      name: "Allo Sticker Pack",
      sku: "ALLO-STK-004",
      price: 499, // $4.99
      description: "Pack of 5 high-quality, weather-proof vinyl stickers featuring Allo brand marks. Perfect for laptops, water bottles, and notebooks.",
      imageUrl: "https://images.unsplash.com/photo-1572375995301-4018d3eed5b8?w=800&auto=format&fit=crop&q=80"
    }
  });
  console.log("Seeded products.");

  // Create Inventory Levels
  // Tee
  await prisma.inventory.create({
    data: { productId: tee.id, warehouseId: whA.id, total: 15, reserved: 0 }
  });
  await prisma.inventory.create({
    data: { productId: tee.id, warehouseId: whB.id, total: 8, reserved: 0 }
  });

  // Hoodie (Low Stock for Concurrency Tests!)
  await prisma.inventory.create({
    data: { productId: hoodie.id, warehouseId: whA.id, total: 2, reserved: 0 }
  });
  await prisma.inventory.create({
    data: { productId: hoodie.id, warehouseId: whB.id, total: 1, reserved: 0 }
  });

  // Cap
  await prisma.inventory.create({
    data: { productId: cap.id, warehouseId: whA.id, total: 20, reserved: 0 }
  });
  await prisma.inventory.create({
    data: { productId: cap.id, warehouseId: whB.id, total: 30, reserved: 0 }
  });

  // Stickers
  await prisma.inventory.create({
    data: { productId: stickers.id, warehouseId: whA.id, total: 150, reserved: 0 }
  });
  await prisma.inventory.create({
    data: { productId: stickers.id, warehouseId: whB.id, total: 120, reserved: 0 }
  });

  console.log("Seeded inventory levels.");
  console.log("Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
