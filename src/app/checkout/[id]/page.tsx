'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  ArrowLeft, 
  Loader2, 
  ShieldAlert,
  CreditCard,
  Package,
  Warehouse
} from 'lucide-react';

export default function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  
  const [reservation, setReservation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  
  // Timer state
  const [timeLeft, setTimeLeft] = useState<number>(0); // in milliseconds
  const [totalHoldTime] = useState<number>(10 * 60 * 1000); // 10 minutes reference
  const [isExpired, setIsExpired] = useState(false);

  // Client-side idempotency key for confirmation retries
  const confirmIdempotencyKeyRef = useRef<string>('');

  useEffect(() => {
    confirmIdempotencyKeyRef.current = crypto.randomUUID();
  }, []);

  // Fetch reservation details
  const fetchReservation = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reservations/${id}`);
      
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Reservation not found.");
        }
        throw new Error("Failed to load reservation details.");
      }
      
      const data = await res.json();
      setReservation(data);

      if (data.status === 'CONFIRMED') {
        setTimeLeft(0);
      } else if (data.status === 'RELEASED') {
        setIsExpired(true);
        setTimeLeft(0);
      } else {
        const expiry = new Date(data.expiresAt).getTime();
        const now = Date.now();
        const diff = expiry - now;
        if (diff <= 0) {
          setIsExpired(true);
          setTimeLeft(0);
        } else {
          setTimeLeft(diff);
          setIsExpired(false);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservation();
  }, [id]);

  // Countdown timer effect
  useEffect(() => {
    if (loading || !reservation || reservation.status !== 'PENDING' || isExpired) {
      return;
    }

    const interval = setInterval(() => {
      const expiry = new Date(reservation.expiresAt).getTime();
      const now = Date.now();
      const diff = expiry - now;

      if (diff <= 0) {
        clearInterval(interval);
        setTimeLeft(0);
        setIsExpired(true);
        // Silently trigger a release request so the DB is freed immediately on timer runout
        fetch(`/api/reservations/${id}/release`, { method: 'POST' }).catch(console.error);
      } else {
        setTimeLeft(diff);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [loading, reservation, isExpired, id]);

  const handleConfirm = async () => {
    if (isExpired || confirming) return;
    
    setConfirming(true);
    try {
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': confirmIdempotencyKeyRef.current
        }
      });

      const data = await res.json();

      if (res.status === 200) {
        setReservation(data); // update reservation status (CONFIRMED)
      } else if (res.status === 410) {
        setIsExpired(true);
        setTimeLeft(0);
        setError("Your stock hold expired. The items were released back to inventory and cannot be purchased.");
      } else {
        setError(data.error || "Failed to confirm purchase.");
      }
    } catch (err) {
      console.error(err);
      setError("A network error occurred. Please check your connection and try again.");
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (cancelling) return;
    
    setCancelling(true);
    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: 'POST'
      });

      const data = await res.json();

      if (res.status === 200) {
        setReservation(data); // update reservation status (RELEASED)
        setIsExpired(true);
        setTimeLeft(0);
      } else {
        setError(data.error || "Failed to cancel reservation.");
      }
    } catch (err) {
      console.error(err);
      setError("A network error occurred while cancelling.");
    } finally {
      setCancelling(false);
    }
  };

  // Helper to format milliseconds to MM:SS
  const formatTime = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatPrice = (priceInCents: number) => {
    return (priceInCents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center font-sans gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-violet-500" />
        <p className="text-neutral-400 text-sm">Validating reservation and lock status...</p>
      </div>
    );
  }

  // Reservation not found or general loading error
  if (error && !reservation) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
        <main className="flex-grow flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-3xl p-8 text-center flex flex-col items-center gap-4 shadow-2xl">
            <XCircle className="w-16 h-16 text-rose-500" />
            <h1 className="text-xl font-bold text-white">Hold Invalid</h1>
            <p className="text-neutral-400 text-sm leading-relaxed">{error}</p>
            <button 
              onClick={() => router.push('/')}
              className="mt-4 flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold px-4 py-2.5 rounded-xl border border-neutral-700 hover:border-neutral-600 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Catalog
            </button>
          </div>
        </main>
      </div>
    );
  }

  const isConfirmed = reservation.status === 'CONFIRMED';
  const isReleased = reservation.status === 'RELEASED';
  const item = reservation.inventory.product;
  const warehouse = reservation.inventory.warehouse;
  const quantity = reservation.quantity;
  const totalPrice = item.price * quantity;
  const timePercent = Math.max(0, Math.min(100, (timeLeft / totalHoldTime) * 100));

  // 1. Success Screen (Confirmed Reservation)
  if (isConfirmed) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
        <main className="flex-grow flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-neutral-900 border border-emerald-500/20 shadow-emerald-500/5 shadow-2xl rounded-3xl p-8 text-center flex flex-col items-center gap-6 animate-fade-in">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-full animate-bounce">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
            </div>
            
            <div>
              <h1 className="text-2xl font-extrabold text-white">Order Confirmed!</h1>
              <p className="text-neutral-400 text-sm mt-1">Payment processed and stock decremented successfully.</p>
            </div>

            {/* Receipt Box */}
            <div className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl p-5 text-left space-y-4 text-sm font-mono">
              <div className="border-b border-neutral-800 pb-3">
                <span className="text-xs text-neutral-500 block">RESERVATION ID</span>
                <span className="text-xs text-neutral-300 font-semibold truncate block">{reservation.id}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500">ITEM</span>
                <span className="text-neutral-300 font-bold">{item.name}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500">WAREHOUSE</span>
                <span className="text-neutral-300">{warehouse.name} ({warehouse.code})</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500">QTY</span>
                <span className="text-neutral-300">{quantity} units</span>
              </div>
              <div className="border-t border-neutral-800 pt-3 flex justify-between items-center text-sm font-bold text-white">
                <span>TOTAL PAID</span>
                <span className="text-emerald-400">{formatPrice(totalPrice)}</span>
              </div>
            </div>

            <button 
              onClick={() => router.push('/')}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-emerald-600/10"
            >
              Continue Shopping
            </button>
          </div>
        </main>
      </div>
    );
  }

  // 2. Expired / Released Screen
  if (isExpired || isReleased) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
        <main className="flex-grow flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-neutral-900 border border-rose-500/20 shadow-rose-500/5 shadow-2xl rounded-3xl p-8 text-center flex flex-col items-center gap-5 animate-fade-in">
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-full">
              <ShieldAlert className="w-12 h-12 text-rose-500" />
            </div>
            
            <div>
              <h1 className="text-xl font-bold text-white">
                {isReleased ? "Reservation Cancelled" : "Reservation Expired"}
              </h1>
              <p className="text-neutral-400 text-sm mt-2 leading-relaxed">
                {isReleased 
                  ? "You cancelled this reservation early. The stock holds have been returned to available inventory."
                  : "The 10-minute hold window expired. Stock has been returned to the catalog to allow other buyers to purchase."}
              </p>
            </div>

            <button 
              onClick={() => router.push('/')}
              className="w-full bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold py-3 rounded-xl border border-neutral-700 hover:border-neutral-600 transition flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Catalog
            </button>
          </div>
        </main>
      </div>
    );
  }

  // 3. Pending Checkout screen
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <button 
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-3 py-1.5 rounded-lg"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Cancel & Return
          </button>
          <span className="text-sm font-bold tracking-tight text-neutral-400">
            Secure Checkout
          </span>
        </div>
      </header>

      {/* Main Form */}
      <main className="flex-grow max-w-4xl mx-auto px-4 py-8 w-full flex flex-col gap-6">
        
        {/* Error Notification */}
        {error && (
          <div className="bg-rose-950/40 border border-rose-500/30 text-rose-200 p-4 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
            <div>
              <p className="font-semibold text-sm">Checkout Error</p>
              <p className="text-xs opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* Expiry Clock Banner */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl backdrop-blur-sm relative overflow-hidden">
          {/* Animated glow on border */}
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500"></div>
          
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="p-3 bg-violet-600/10 border border-violet-500/20 rounded-2xl">
              <Clock className="w-8 h-8 text-violet-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Temporary Stock Hold Active</h2>
              <p className="text-neutral-400 text-xs mt-0.5">We are holding your stock items. Complete payment before the timer expires.</p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1.5 w-full sm:w-auto">
            <div className="text-3xl font-black font-mono tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
              {formatTime(timeLeft)}
            </div>
            {/* Progress bar */}
            <div className="w-32 bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-neutral-800">
              <div 
                className="bg-gradient-to-r from-violet-500 to-fuchsia-500 h-full rounded-full transition-all duration-1000"
                style={{ width: `${timePercent}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Content Split: Left Info, Right Checkout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* Left: Summary */}
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-6 shadow-xl backdrop-blur-sm md:col-span-7 space-y-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Order Summary</h3>

            {/* Product Summary */}
            <div className="flex gap-4">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img 
                  src={item.imageUrl} 
                  alt={item.name} 
                  className="w-20 h-20 object-cover rounded-xl border border-neutral-800"
                />
              ) : (
                <div className="w-20 h-20 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-center text-neutral-600">
                  <Package className="w-8 h-8" />
                </div>
              )}
              
              <div className="flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-neutral-100">{item.name}</h4>
                  <p className="text-xs text-neutral-500 font-mono mt-0.5">SKU: {item.sku}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <Warehouse className="w-3.5 h-3.5 text-violet-400" />
                  <span>{warehouse.name}</span>
                </div>
              </div>
            </div>

            {/* Receipt Summary */}
            <div className="border-t border-neutral-800/80 pt-5 space-y-3 font-mono text-sm">
              <div className="flex justify-between text-neutral-400">
                <span>Unit Price</span>
                <span>{formatPrice(item.price)}</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Hold Quantity</span>
                <span>x {quantity}</span>
              </div>
              <div className="border-t border-neutral-800 pt-3 flex justify-between text-base font-bold text-white">
                <span>Total Amount</span>
                <span className="text-violet-400">{formatPrice(totalPrice)}</span>
              </div>
            </div>
          </div>

          {/* Right: Payment Sandbox */}
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-6 shadow-xl backdrop-blur-sm md:col-span-5 space-y-6">
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-violet-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Payment Sandbox</h3>
            </div>
            
            <p className="text-neutral-400 text-xs leading-relaxed">
              This is a sandbox simulation environment. Click &quot;Confirm Purchase&quot; to mock a successful payment redirect flow.
            </p>

            <div className="space-y-3">
              <button
                onClick={handleConfirm}
                disabled={confirming || cancelling}
                className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-neutral-800 disabled:to-neutral-800 text-white font-semibold py-3 px-4 rounded-xl border border-transparent shadow-lg hover:shadow-violet-600/10 transition-all duration-200 flex items-center justify-center gap-2"
              >
                {confirming ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing Payment...
                  </>
                ) : (
                  "Confirm Purchase"
                )}
              </button>

              <button
                onClick={handleCancel}
                disabled={confirming || cancelling}
                className="w-full bg-neutral-950 border border-neutral-800 hover:bg-neutral-900 hover:border-neutral-700 disabled:border-neutral-800 disabled:text-neutral-600 text-neutral-300 font-semibold py-3 px-4 rounded-xl transition flex items-center justify-center gap-2"
              >
                {cancelling ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  "Cancel & Release Stock"
                )}
              </button>
            </div>

            <div className="border-t border-neutral-800/80 pt-4 flex flex-col gap-1.5 text-[10px] text-neutral-500 font-mono">
              <div>HOLD ID: {reservation.id}</div>
              <div className="truncate">IDEMPOTENCY KEY: {confirmIdempotencyKeyRef.current}</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
