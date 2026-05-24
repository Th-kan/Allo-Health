import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runConcurrencyTest() {
  console.log("=== CONCURRENCY TEST START ===");

  // 1. Find the Tech Hoodie and Tokyo warehouse
  const product = await prisma.product.findUnique({
    where: { sku: "ALLO-HD-002" }
  });
  const warehouse = await prisma.warehouse.findUnique({
    where: { code: "TYO-FMC" }
  });

  if (!product || !warehouse) {
    throw new Error("Hoodie or Tokyo warehouse not found in DB. Make sure you seeded first!");
  }

  // 2. Reset stock for that warehouse to total = 1, reserved = 0
  const inventory = await prisma.inventory.findUnique({
    where: {
      productId_warehouseId: {
        productId: product.id,
        warehouseId: warehouse.id
      }
    }
  });

  if (!inventory) {
    throw new Error("Inventory record not found.");
  }

  await prisma.inventory.update({
    where: { id: inventory.id },
    data: { total: 1, reserved: 0 }
  });

  // Clean up any existing reservations for this inventory item
  await prisma.reservation.deleteMany({
    where: { inventoryId: inventory.id }
  });

  console.log(`Reset inventory for SKU ${product.sku} at ${warehouse.code} to: Total = 1, Reserved = 0.`);
  console.log("Launching 10 concurrent HTTP requests to http://localhost:3000/api/reservations...");

  const url = "http://localhost:3000/api/reservations";
  const requests = Array.from({ length: 10 }).map((_, index) => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId: product.id,
        warehouseId: warehouse.id,
        quantity: 1
      })
    })
    .then(async (res) => {
      const body = await res.json();
      return { status: res.status, body };
    })
    .catch((err) => {
      return { status: 0, body: { error: err.message } };
    });
  });

  const results = await Promise.all(requests);

  console.log("\n=== RESULTS ===");
  let successCount = 0;
  let conflictCount = 0;
  let otherCount = 0;

  results.forEach((r, i) => {
    console.log(`Request #${i + 1}: Status = ${r.status}, Body = ${JSON.stringify(r.body)}`);
    if (r.status === 201) {
      successCount++;
    } else if (r.status === 409) {
      conflictCount++;
    } else {
      otherCount++;
    }
  });

  console.log("\n=== SUMMARY ===");
  console.log(`Success (201 Created): ${successCount}`);
  console.log(`Conflict (409 Stock Depleted): ${conflictCount}`);
  console.log(`Other: ${otherCount}`);

  if (successCount === 1 && conflictCount === 9) {
    console.log("\n✅ SUCCESS: Exactly 1 request reserved the stock, and the other 9 failed with 409 Conflict.");
  } else {
    console.log("\n❌ FAILURE: Concurrency check failed.");
  }
  
  console.log("=== CONCURRENCY TEST END ===");
}

runConcurrencyTest()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
