export function LoadingSkeleton({ label = "読み込み中…" }: { label?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}
