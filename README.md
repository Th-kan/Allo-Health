# Allo Inventory Reservation System

An end-to-end multi-warehouse inventory reservation and checkout platform built with Next.js (App Router), Prisma, PostgreSQL, and Tailwind CSS. This system guarantees concurrency safety and idempotency.

---

## 🛠️ How to Run the App Locally

### 1. Prerequisites
- **Node.js** (v18.18+ or v20+)
- A hosted **PostgreSQL** database (e.g., from Neon, Supabase, or Railway)
  > [!IMPORTANT]
  > As specified in the instructions, this project requires a real PostgreSQL database rather than SQLite or a local file database, as row-level locking (`SELECT ... FOR UPDATE`) is database-engine specific.

### 2. Configure Environment Variables
Create a `.env` file in the root of the project:
```env
DATABASE_URL="postgresql://username:password@hostname:5432/dbname?sslmode=require"
# Optional: Secret to protect the cron cleanup endpoint
# CRON_SECRET="your-secret-key-here"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Migrations & Generate Client
Apply migrations to your PostgreSQL database and compile the Prisma Client:
```bash
# Apply migrations to database
npx prisma migrate dev --name init

# Compile client bindings
npx prisma generate
```

### 5. Seed the Database
Populate the database with initial products, warehouses, and inventories:
```bash
npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" prisma/seed.ts
```

### 6. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🏎️ Running Concurrency & Idempotency Tests
To run tests while the local server is active, ensure the dev server is running on `http://localhost:3000` (via `npm run dev`) and run:

- **Concurrency test**: Verifies that when 10 shoppers concurrently compete for the last item in stock, exactly 1 succeeds and 9 get a `409 Conflict`.
  ```bash
  npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" scripts/test-concurrency.ts
  ```
- **Idempotency test**: Verifies that retrying reservation or confirmation requests with the same `Idempotency-Key` returns identical cached responses and does not double-decrement stock.
  ```bash
  npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" scripts/test-idempotency.ts
  ```

---

## 🛡️ Technical Architecture & Concurrency Safety

### Concurrency Safety (Avoiding Double Selling)
When two requests compete for the last unit of stock:
1. The server starts an ACID transaction: `prisma.$transaction(...)`.
2. Inside the transaction, we acquire a pessimistic row lock on the inventory row using PostgreSQL's row-level lock syntax:
   ```sql
   SELECT id, total, reserved 
   FROM "Inventory" 
   WHERE "productId" = $1 AND "warehouseId" = $2 
   FOR UPDATE
   ```
3. PostgreSQL blocks any concurrent transactions attempting to read/write the same row.
4. Once the transaction acquires the lock, it reads the latest stock levels and calculates the available inventory (`total - reserved`).
5. If `available < quantity`, it throws a `409 Conflict` and rolls back the transaction.
6. If stock is available, it increments the `reserved` count, creates the reservation, and commits.
7. The blocked concurrent transactions are released one by one. The next transaction reads the updated `reserved` value, detects that the stock is now depleted, and immediately returns a `409` instead of double-booking.

### Expiry Mechanism (Reclaiming Stock Holds)
To ensure abandoned carts do not permanently deplete stock, reservations have a 10-minute hold window. We use a **hybrid cleanup strategy** in production:
1. **Lazy Cleanup on Read**: Every product list (`GET /api/products`), reservation attempt (`POST /api/reservations`), and checkout check (`GET /api/reservations/:id`) triggers a database cleanup query. This guarantees that stock displays are always real-time accurate and no expired reservations can block new purchases.
2. **Periodic Background Cleanup (Vercel Cron)**: The endpoint `/api/cron/cleanup` can be called by Vercel Cron or any external cron worker (e.g. every minute) to clean up old records even when there is no traffic.
3. **Atomic Writable CTE**: To maximize performance, cleanup runs a single SQL query using writable Common Table Expressions (CTEs):
   ```sql
   WITH expired AS (
     UPDATE "Reservation"
     SET "status" = 'RELEASED', "updatedAt" = NOW()
     WHERE "status" = 'PENDING' AND "expiresAt" < NOW()
     RETURNING "inventoryId", "quantity"
   ),
   aggregated AS (
     SELECT "inventoryId", SUM("quantity") as total_qty
     FROM expired
     GROUP BY "inventoryId"
   )
   UPDATE "Inventory" i
   SET "reserved" = i."reserved" - a.total_qty
   FROM aggregated a
   WHERE i.id = a."inventoryId";
   ```
   This updates expired reservations to `RELEASED` and returns their hold counts back to `available` stock in a single database roundtrip.

### Idempotency (The Bonus)
We implement API idempotency for both the reserve (`POST /api/reservations`) and confirm (`POST /api/reservations/[id]/confirm`) endpoints:
- When a client sends a request with an `Idempotency-Key` header, we look up or create an `IdempotentRequest` record in the database.
- If a duplicate request is received:
  - If the first request has finished, we immediately return the cached status code and JSON response body.
  - If the first request is still running (status code `102 Processing`), subsequent requests poll for the result (up to 5 seconds) before returning the completed response. This handles network retries during slow operations.
  - If the original request fails, we delete the key to allow safe retries.

---

## ⚖️ Trade-offs & Future Improvements (Given More Time)
1. **Distributed Locks (Redis)**: For scale, using Redis (`redlock`) for lock management instead of Postgres row locks would offload locking overhead from the database. Postgres row locks (`FOR UPDATE`) are highly reliable but hold database connections open. For this application's size, database-level locking is ideal because it keeps consistency boundaries clean.
2. **Database Cleanups**: The lazy cleanup query runs on every products list fetch. If the database grows to millions of rows, checking all expired pending records might slow down reads. In a massive system, we would offload this entirely to a Redis TTL + key-space notification system or rely solely on a dedicated worker, indexing the `expiresAt` column.
3. **Idempotency Storage**: Storing idempotency payloads in PostgreSQL uses disk writes. In production, we would store idempotency logs in a Redis cache with a 24-hour TTL, which is cheaper and faster.
