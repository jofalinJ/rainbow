-- Rainbow Gold Covering / SELECT-ONLY production migration dependency preflight.
-- Safe to run on the production PostgreSQL connection: reads catalog metadata
-- ONLY; never mutates stock, payments, orders, invoices or customer identities.
-- READY means a known dependency exists, not that the migration was tested on
-- the live database or is approved for production deployment.
WITH gates(gate,passed,reason) AS (
 SELECT 'Core shop tables present',
  to_regclass('public.products') IS NOT NULL
  AND to_regclass('public.staff_profiles') IS NOT NULL
  AND to_regclass('public.erp_online_listings') IS NOT NULL
  AND to_regclass('public.erp_stock_events') IS NOT NULL,
  'Needed for owner audit triggers'
 UNION ALL SELECT 'Owner audit authorization helper present',
  to_regprocedure('app_private.erp_is_admin()') IS NOT NULL
  AND has_schema_privilege('authenticated','app_private','USAGE')
  AND has_function_privilege('authenticated','app_private.erp_is_admin()','EXECUTE'),
  'Required by owner-only RLS audit policy'
 UNION ALL SELECT 'Online payment and consent schema present',
  to_regclass('public.orders') IS NOT NULL
  AND to_regclass('public.razorpay_checkouts') IS NOT NULL
  AND to_regclass('public.whatsapp_notifications') IS NOT NULL
  AND to_regclass('public.payments') IS NOT NULL
  AND to_regclass('public.invoices') IS NOT NULL,
  'Needed for paid/consent-only WhatsApp outbox claim'
 UNION ALL SELECT 'WhatsApp send claim fields present',
  (SELECT count(*)=6 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_notifications'
      AND column_name IN ('id','order_id','recipient_number','invoice_url',
        'send_started_at','send_attempts')),
  'Outbox claim must not require a new customer message or order'
 UNION ALL SELECT 'Provider acknowledgment column present',
  EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='whatsapp_notifications'
     AND column_name='provider_message_id' AND data_type='text'),
  'Needed for signed provider callback status tracking'
 UNION ALL SELECT 'Provider status enum values present',
  (SELECT count(*)=3 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typname='whatsapp_status'
      AND e.enumlabel::text IN ('pending','sent','failed')),
  'Meta status reconciliation casts notification send state to this enum'
 UNION ALL SELECT 'Invoice bearer token is UUID',
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoices'
      AND column_name='public_token' AND udt_name='uuid'),
  'Required by unchanged public invoice URLs'
 UNION ALL SELECT 'Preserved invoice token index valid and unique',
  EXISTS(SELECT 1 FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
   WHERE x.indrelid=to_regclass('public.invoices')
     AND i.relname='invoices_public_token_uidx' AND x.indisvalid
     AND x.indisunique),
  'Refuse to drop duplicate token index if the surviving index is invalid'
 UNION ALL SELECT 'Redundant invoice token index is standalone',
  EXISTS(SELECT 1 FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
   WHERE x.indrelid=to_regclass('public.invoices')
     AND i.relname='idx_invoices_unique_public_token' AND x.indisvalid
     AND x.indisunique
     AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.oid)),
  'DDL must never remove a constraint-owned invoice index'
 UNION ALL SELECT 'Auth user verified-email columns present',
  to_regclass('auth.users') IS NOT NULL
  AND EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='users'
      AND column_name='email_confirmed_at')
  AND EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='auth' AND table_name='users'
      AND column_name='email'),
  'Customer tracking must match a currently verified Auth email'
 UNION ALL SELECT 'Customer tracking RPCs present',
  to_regprocedure('public.track_my_online_orders()') IS NOT NULL
  AND to_regprocedure('public.track_my_order_shipments()') IS NOT NULL,
  'Preserves existing customer-facing RPC signatures'
 UNION ALL SELECT 'Migration objects not yet applied',
  to_regclass('public.admin_audit_events') IS NULL
  AND to_regclass('public.whatsapp_provider_status_inbox') IS NULL
  AND to_regprocedure('public.claim_paid_invoice_whatsapp_production(integer)') IS NULL
  AND to_regprocedure('public.record_whatsapp_delivery_status(text,text,timestamptz)') IS NULL,
  'This check describes the current pending release; revisit after a partial rollout'
)
SELECT gate, CASE WHEN passed THEN 'READY' ELSE 'REVIEW_REQUIRED' END AS result, reason
FROM gates ORDER BY gate;
