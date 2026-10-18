# Rainbow Gold Covering — 10,000-product back-office release runbook
Updated 18 October 2026. Scope: stacked draft **PR #21**, built upon #20 and #19.

## Shipped on this branch
- **Admin pagination:** 40 PostgreSQL-selected products per request, server-side search, status filters, total count and page navigation; admin staff can locate any individual SKU. No 10,000-row frontend fetch.
- **Safe CSV importer:** UTF-8 CSV with required fields `product_code,category,product_name,type,selling_price`. Additional columns are `gender,color,size,length_cm,description,thickness,gold_amount_g`. Up to **500 product rows per file**, maximum 2 MB. CSV supports quoted names/commas, validates categories, lengths, stock variants, positive prices and duplicate codes.
- **Product import permissions:** only authenticated active admin/inventory staff. A preview checks existing product codes before unlocking the import action. Import is explicitly confirmed; batches of at most 20 products are written, then corresponding zero-stock variants. Imported products always start **unpublished drafts with zero stock**. They never overwrite existing products and never change payment data.
- **Partial-import recovery:** successful draft batches stay in the database if a later batch fails. Re-preview and export conflicts; split the CSV to exclude already-created SKUs before retrying. A failed variant write can leave unpublished products with no variants; **verify and repair these drafts manually before retrying**. There is no automatic rollback across API requests.
- **Product photograph import:** select up to 50 files named `SKU__1.jpg` through `SKU__5.webp`. A SKU containing a slash, e.g. `RGC/C00004`, becomes `RGC%2FC00004__1.webp` as the filename. The browser resolves exact SKU values (not fuzzy filename guesses), detects duplicate positions and identical image bytes within the batch when SHA-256 is available, checks per-product five-photo limits, and generates both 1600px and 480px WebP images. No existing image positions are overwritten.
- **Operations:** read-only product, published-product, image-record and in-stock variant counts; missing photograph count on the currently displayed page; admin API response time. Optional full metadata CSV export is available, but is **not a transactional backup**.
- **Customer:** exact slash-containing SKU query handling, common jewellery spelling and transliteration aliases, and a manual WhatsApp restock request for out-of-stock product links. The restock feature does not store customer details or send automatic alerts.

## Sample CSV (edit product codes, names, and categories)
```csv
product_code,category,product_name,type,selling_price,gender,color,size,length_cm,description,thickness,gold_amount_g
RGC00001,Earring,Traditional Gold Covering Jhumka,Jhumka,299,women,Gold,0,,Classic jhumka,Medium,
RGC00002,Chain,Designer Chain,Designer,450,unisex,0,0,60,Gold covering chain,Medium,
```
These are examples **for documentation only**. No sample product data was inserted into Supabase.
The CSV importer requires exact category names, e.g. `Earring` vs `Earrings`, and manual review after import. The database SKU generator is bypassed only when the operator provides an explicit unique SKU in a bulk import.

## Encrypted backups and restore
The script `scripts/encrypted-database-backup.sh` is operator-run and **has not been executed**. Install PostgreSQL client tools and `age`. Set `PGHOST`, `PGPORT` (optional; default 5432), `PGDATABASE`, `PGUSER`, and a valid public `AGE_RECIPIENT`. Store the PostgreSQL password in a local permission-restricted `~/.pgpass` (mode 0600), rather than on a command line or in GitHub files. Use `bash scripts/encrypted-database-backup.sh` to create an encrypted Postgres custom-format archive locally. Retain the age private key offsite and out of this repository.

Verify restore periodically **only to an isolated staging database**:
```sh
age -d -i /secure/offline/age-identity.txt -o /secure/staging-backup.dump /secure/backup.pgcustom.age
pg_restore --list /secure/staging-backup.dump
# After checking destination credentials and wiping ONLY an isolated test database:
pg_restore --dbname=YOUR_ISOLATED_TEST_DATABASE --no-owner --no-acl /secure/staging-backup.dump
```
The restore command may require a fresh empty database and individual object permissions. Never run it on the live Rainbow database. Encrypted archives contain customer records and employee information; store them under restricted access, define retention periods and test the recovery procedure before relying on it.

## Scalability and safety gates before merging
1. **Order:** merge + accept PR #19 → PR #20 → PR #21. All three are drafts currently.
2. GitHub CI lint, unit, static verification and security checks must pass at the latest PR head. Isolated Supabase integration / authenticated Selenium are separately gated; they must run in an isolated environment before production approval.
3. Test Android staff PWA, full import + cancel + conflict paths, duplicate file hashes, network failures, non-ASCII quoted CSV, and 5-photo limit with real role permissions.
4. Confirm stock remains zero and new imported products remain invisible to customers until manually published.
5. Benchmark a **separate test Supabase project** with 10,000 products and 50,000 image metadata references. Measure admin pagination, product search, RLS, storage bandwidth and checkout product updates; never seed the production database with mock fixtures.
6. Run `EXPLAIN (ANALYZE, BUFFERS)` in staging to validate missing trigram/category/price indexes. No indexes, tables, API grants or RLS policies have been modified by this PR.
7. Real backups must be encrypted, verified and routinely restored to isolated staging. The optional script is groundwork, not an automated backup service.
8. Product pages are still JavaScript-rendered; SSR/prerender remains a separate SEO improvement. Real-user analytics and error monitoring providers need explicit setup and consent.
9. Automatic restock notifications would require opt-in consent, protected data storage, delivery-provider integration and an unsubscribe flow; only the manual WhatsApp request is included.

## What not to do
- Do not bulk-import customer, staff or payment data via the product tools.
- Do not treat catalogue CSV export as a consistent database backup.
- Do not consider unapproved shipping/return policies final.
- Do not merge other pending offline POS, biometric attendance or payment code into this import PR.
