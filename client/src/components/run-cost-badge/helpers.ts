/**
 * A run can cost a tenth of a cent or several dollars, so a fixed precision is
 * wrong at one end or the other: 2 decimals renders a $0.0013 run as "$0.00",
 * and 4 decimals renders a $1.24 run as "$1.2380". Scale the precision instead.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return EM_DASH;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Shown when there is no cost DATA — an unpriced model, or a run that never
 * reached one. Deliberately not "$0.00", which would claim the run was free.
 */
export const EM_DASH = "—";
