-- Approval Snapshot Hash / Expiration / Invalidation (spec §45, §63-64).
--
-- `approval_requests.snapshot_hash`/`expires_at` already exist (Phase 5's
-- production_sales_ops migration). This migration only adds the one new
-- terminal status a `sales_messages` row needs when the Final Send Gate
-- discovers the approved content no longer matches what is about to be
-- sent (recipient/subject/body changed, or the approval expired) —
-- APPROVAL_INVALIDATED, distinct from CANCELLED (a human decision) and
-- FAILED (a delivery-layer failure): this one specifically means "go back
-- through approval again before this can be sent."
alter table public.sales_messages drop constraint sales_messages_status_check;
alter table public.sales_messages add constraint sales_messages_status_check check (status in (
  'DRAFT', 'WAITING_REVIEW', 'WAITING_APPROVAL', 'APPROVED', 'READY_TO_SEND',
  'SENT', 'DELIVERED', 'REPLIED', 'FAILED', 'BOUNCED', 'CANCELLED', 'APPROVAL_INVALIDATED'
));
