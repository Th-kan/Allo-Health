'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Package, 
  Warehouse as WarehouseIcon, 
  AlertCircle, 
  RefreshCw, 
  Loader2, 
  Layers, 
  Lock, 
  Unlock,
  Coins
} from 'lucide-react';

interface WarehouseStock {
  id: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  total: number;
  reserved: number;
  available: number;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  inventories: WarehouseStock[];
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservingId, setReservingId] = useState<string | null>(null); // format: `${productId}-${warehouseId}`
  const [quantities, setQuantities] = useState<Record<string, number>>({}); // key: `${productId}-${warehouseId}`
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/products');
      if (!res.ok) {
        throw new Error('Failed to load products');
      }
      const data = await res.json();
      setProducts(data);
      
      // Initialize quantities
      const initialQuantities: Record<string, number> = {};
      data.forEach((p: Product) => {
        p.inventories.forEach((inv) => {
          initialQuantities[`${p.id}-${inv.warehouseId}`] = 1;
        });
      });
      setQuantities(prev => ({ ...initialQuantities, ...prev }));
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while fetching inventory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  // Auto-hide toast after 5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleQuantityChange = (productId: string, warehouseId: string, value: number, max: number) => {
    const key = `${productId}-${warehouseId}`;
    const clampedValue = Math.max(1, Math.min(max, value));
    setQuantities(prev => ({ ...prev, [key]: clampedValue }));
  };

  const handleReserve = async (productId: string, warehouseId: string) => {
    const key = `${productId}-${warehouseId}`;
    const quantity = quantities[key] || 1;
    const reservingKey = `${productId}-${warehouseId}`;
    
    setReservingId(reservingKey);
    setToast(null);

    // Generate a unique Idempotency Key for this attempt
    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          productId,
          warehouseId,
          quantity
        })
      });

      const data = await res.json();

      if (res.status === 201) {
        setToast({ message: 'Reservation hold secured successfully! Redirecting...', type: 'success' });
        // Redirect to the checkout page
        setTimeout(() => {
          router.push(`/checkout/${data.id}`);
        }, 1000);
      } else if (res.status === 409) {
        setToast({ 
          message: `Stock hold failed: ${data.error}. Only ${data.available} unit(s) available.`, 
          type: 'error' 
        });
        // Refresh products to show updated stock
        fetchProducts();
      } else {
        setToast({ message: data.error || 'Failed to make reservation.', type: 'error' });
      }
    } catch (err: any) {
      console.error(err);
      setToast({ message: 'A network error occurred. Please try again.', type: 'error' });
    } finally {
      setReservingId(null);
    }
  };

  const formatPrice = (priceInCents: number) => {
    return (priceInCents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 max-w-md p-4 rounded-xl shadow-2xl border flex items-start gap-3 animate-slide-in backdrop-blur-md transition-all duration-300 ${
          toast.type === 'success' 
            ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-200' 
            : 'bg-rose-950/80 border-rose-500/30 text-rose-200'
        }`}>
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">
              {toast.type === 'success' ? 'Success' : 'Out of Stock / Error'}
            </p>
            <p className="text-xs opacity-90">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="ml-auto text-xs opacity-50 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-violet-600 to-fuchsia-600 rounded-lg shadow-lg">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
                Allo Inventory
              </span>
              <span className="ml-2 text-xxs px-2 py-0.5 bg-neutral-800 text-neutral-400 rounded border border-neutral-700">
                v2.0-ACID
              </span>
            </div>
          </div>
          <button 
            onClick={fetchProducts}
            disabled={loading}
            className="flex items-center gap-2 text-sm bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 px-3 py-1.5 rounded-lg transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Sync Stock
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Hero Section */}
        <div className="mb-10 text-center sm:text-left">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
            Real-Time Product Catalog
          </h1>
          <p className="mt-2 text-neutral-400 max-w-2xl text-sm">
            Simulate high-concurrency checkout races. Holds are reserved for 10 minutes. 
            ACID transaction row-level locks prevent double-booking.
          </p>
        </div>

        {loading && products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-violet-500" />
            <p className="text-neutral-400 text-sm">Loading products and active stock levels...</p>
          </div>
        ) : error ? (
          <div className="bg-rose-950/30 border border-rose-500/20 text-rose-200 p-6 rounded-2xl flex flex-col items-center justify-center text-center gap-3">
            <AlertCircle className="w-12 h-12 text-rose-500" />
            <h3 className="font-bold text-lg">Failed to sync database</h3>
            <p className="text-sm max-w-md opacity-80">{error}</p>
            <button onClick={fetchProducts} className="mt-2 bg-rose-500/20 hover:bg-rose-500/30 px-4 py-2 rounded-xl transition text-sm font-semibold border border-rose-500/30">
              Retry Sync
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {products.map((product) => (
              <div 
                key={product.id}
                className="bg-neutral-900/60 border border-neutral-800 rounded-3xl overflow-hidden hover:border-neutral-700/60 transition-all duration-300 flex flex-col shadow-xl backdrop-blur-sm group"
              >
                {/* Image Section */}
                <div className="relative h-64 w-full bg-neutral-950 overflow-hidden">
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img 
                      src={product.imageUrl} 
                      alt={product.name}
                      className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500 opacity-90"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-600">
                      <Package className="w-16 h-16" />
                    </div>
                  )}
                  <div className="absolute top-4 left-4 bg-neutral-950/80 backdrop-blur-md border border-neutral-800/80 px-3 py-1 rounded-full text-xs font-mono text-neutral-400">
                    SKU: {product.sku}
                  </div>
                  <div className="absolute bottom-4 right-4 bg-violet-600 border border-violet-500 shadow-lg px-4 py-1.5 rounded-full text-md font-bold text-white flex items-center gap-1.5">
                    <Coins className="w-4 h-4" />
                    {formatPrice(product.price)}
                  </div>
                </div>

                {/* Content Section */}
                <div className="p-6 flex-grow flex flex-col justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-2">{product.name}</h2>
                    <p className="text-neutral-400 text-sm line-clamp-3 mb-6 leading-relaxed">
                      {product.description || "No description provided."}
                    </p>
                  </div>

                  {/* Warehouses Grid */}
                  <div className="border-t border-neutral-800/80 pt-5 space-y-4">
                    <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-2">
                      <WarehouseIcon className="w-4 h-4 text-violet-400" />
                      Warehouse Availability
                    </h3>

                    <div className="space-y-3">
                      {product.inventories.map((inv) => {
                        const key = `${product.id}-${inv.warehouseId}`;
                        const qty = quantities[key] || 1;
                        const isReserving = reservingId === key;
                        const isOutOfStock = inv.available === 0;

                        return (
                          <div 
                            key={inv.warehouseId}
                            className="bg-neutral-950/50 rounded-2xl p-4 border border-neutral-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div>
                              <p className="font-semibold text-sm text-neutral-200">{inv.warehouseName}</p>
                              <div className="flex items-center gap-3 mt-1.5 font-mono text-xs">
                                <span className="text-neutral-400 flex items-center gap-1">
                                  <Layers className="w-3.5 h-3.5" /> Total: {inv.total}
                                </span>
                                <span className="text-neutral-500 flex items-center gap-1">
                                  <Lock className="w-3.5 h-3.5 text-neutral-600" /> Held: {inv.reserved}
                                </span>
                                <span className={`flex items-center gap-1 font-bold ${
                                  inv.available === 0 
                                    ? 'text-rose-500' 
                                    : inv.available <= 3 
                                      ? 'text-amber-400' 
                                      : 'text-emerald-400'
                                }`}>
                                  <Unlock className="w-3.5 h-3.5" /> Available: {inv.available}
                                </span>
                              </div>
                            </div>

                            {/* Controls */}
                            <div className="flex items-center gap-2 sm:self-center">
                              {/* Quantity Selector */}
                              {!isOutOfStock && (
                                <input 
                                  type="number"
                                  min={1}
                                  max={inv.available}
                                  value={qty}
                                  onChange={(e) => handleQuantityChange(product.id, inv.warehouseId, parseInt(e.target.value) || 1, inv.available)}
                                  disabled={isReserving}
                                  className="w-14 bg-neutral-900 border border-neutral-800 rounded-xl px-2 py-1.5 text-center text-sm focus:outline-none focus:border-violet-500 text-white font-semibold font-mono"
                                />
                              )}

                              {/* Reserve Button */}
                              <button
                                onClick={() => handleReserve(product.id, inv.warehouseId)}
                                disabled={isOutOfStock || isReserving}
                                className={`flex items-center justify-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl border transition-all duration-200 flex-grow sm:flex-none ${
                                  isOutOfStock
                                    ? 'bg-neutral-900 border-neutral-800 text-neutral-600 cursor-not-allowed'
                                    : isReserving
                                      ? 'bg-violet-950/50 border-violet-500/20 text-violet-300 cursor-not-allowed'
                                      : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white border-transparent shadow-lg hover:shadow-violet-600/10'
                                }`}
                              >
                                {isReserving ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Holding...
                                  </>
                                ) : isOutOfStock ? (
                                  'Sold Out'
                                ) : (
                                  'Reserve Hold'
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-900 bg-neutral-950 py-6 text-center text-xs text-neutral-500 mt-12">
        <p>© 2026 Allo Retail Platform Take-Home Exercise. All rights reserved.</p>
        <p className="mt-1 opacity-60">ACID Transactions • SELECT FOR UPDATE locks • API Idempotency</p>
      </footer>
    </div>
  );
}
