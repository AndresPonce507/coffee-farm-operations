/**
 * LivingBackground — a fixed, GPU-only aurora that drifts slowly behind the glass.
 * Three blurred brand-tinted blobs + a soft frosted grain. Zero JS, zero network,
 * pointer-events-none, sits at -z-10 so all content floats above it.
 */
export function LivingBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-paper"
    >
      <div className="aurora-blob aurora-1" />
      <div className="aurora-blob aurora-2" />
      <div className="aurora-blob aurora-3" />
      <div className="aurora-grain" />
    </div>
  );
}
