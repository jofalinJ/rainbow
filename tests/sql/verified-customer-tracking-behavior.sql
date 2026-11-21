-- Executed ONLY against synthetic PostgreSQL test schema.
-- Contract: customer identity is the current auth.users verified email,
-- never a possibly stale JWT email claim or caller-controlled address.
DO $privilege$
BEGIN
 IF has_function_privilege('anon','public.track_my_online_orders()','EXECUTE')
    OR has_function_privilege('anon','public.track_my_order_shipments()','EXECUTE') THEN
  RAISE EXCEPTION 'Anonymous users can invoke protected tracking';
 END IF;
 IF NOT has_function_privilege('authenticated','public.track_my_online_orders()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.track_my_order_shipments()','EXECUTE') THEN
  RAISE EXCEPTION 'Verified customers cannot invoke tracking';
 END IF;
END;
$privilege$;

SET ROLE authenticated;
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $alice$
DECLARE r record;
BEGIN
 IF (SELECT count(*) FROM public.track_my_online_orders())<>1 OR
    (SELECT count(*) FROM public.track_my_order_shipments())<>1 THEN
  RAISE EXCEPTION 'Verified Alice cannot see exactly her own order and shipment';
 END IF;
 SELECT * INTO r FROM public.track_my_online_orders();
 IF r.order_number<>'RG-ALICE' OR r.total_amount<>100 THEN
  RAISE EXCEPTION 'Alice was shown another customer order';
 END IF;
 SELECT * INTO r FROM public.track_my_order_shipments();
 IF r.order_number<>'RG-ALICE' OR r.consignment_number<>'ALICEAWB' THEN
  RAISE EXCEPTION 'Alice was shown another customer shipment';
 END IF;
END;
$alice$;

-- A stale token email claim must not grant access to Alice's orders.
SET request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SET request.jwt.claim.email='alice@example.test';
DO $bob$
DECLARE r record;
BEGIN
 IF (SELECT count(*) FROM public.track_my_online_orders())<>1 OR
    (SELECT count(*) FROM public.track_my_order_shipments())<>1 THEN
  RAISE EXCEPTION 'Bob cannot see his own order when email claim is stale';
 END IF;
 SELECT * INTO r FROM public.track_my_online_orders();
 IF r.order_number<>'RG-BOB' OR r.total_amount<>200 THEN
  RAISE EXCEPTION 'Stale JWT email claim disclosed another customer order';
 END IF;
 SELECT * INTO r FROM public.track_my_order_shipments();
 IF r.order_number<>'RG-BOB' OR r.consignment_number<>'BOBAWB' THEN
  RAISE EXCEPTION 'Stale JWT email claim disclosed another customer shipment';
 END IF;
END;
$bob$;

-- Even a signed-in account with an unconfirmed email cannot see orders.
SET request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
SET request.jwt.claim.email='eve@example.test';
DO $unverified$
BEGIN
 IF EXISTS (SELECT 1 FROM public.track_my_online_orders()) OR
    EXISTS (SELECT 1 FROM public.track_my_order_shipments()) THEN
  RAISE EXCEPTION 'Unverified email account read private tracking';
 END IF;
END;
$unverified$;

-- A missing session must fail closed.
SET request.jwt.claim.sub='';
DO $missing$
BEGIN
 IF EXISTS (SELECT 1 FROM public.track_my_online_orders()) OR
    EXISTS (SELECT 1 FROM public.track_my_order_shipments()) THEN
  RAISE EXCEPTION 'Missing session exposed tracking';
 END IF;
END;
$missing$;
RESET ROLE;

-- Account email changed: stale original customer orders must not be returned.
UPDATE auth.users SET email='moved@example.test'
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET ROLE authenticated;
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.email='alice@example.test';
DO $changed$
BEGIN
 IF EXISTS (SELECT 1 FROM public.track_my_online_orders()) OR
    EXISTS (SELECT 1 FROM public.track_my_order_shipments()) THEN
  RAISE EXCEPTION 'Old email claim still exposed an order after account email change';
 END IF;
END;
$changed$;
RESET ROLE;

-- A confirmed, current-email account retains its legacy view after correction.
UPDATE auth.users SET email='alice@example.test'
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET ROLE authenticated;
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $restored$
BEGIN
 IF (SELECT count(*) FROM public.track_my_online_orders())<>1 OR
    (SELECT count(*) FROM public.track_my_order_shipments())<>1 THEN
  RAISE EXCEPTION 'Confirmed current account email tracking was broken';
 END IF;
END;
$restored$;
RESET ROLE;
