# Production release gates

This draft branch is not ready for deployment. Do not merge until an isolated full-schema Supabase staging test passes and the shop owner explicitly approves release.

Required external sign-offs: accountant-approved GST rate mapping, invoice series and credit notes; verified payments and refunds; actual Android/printer/scanner testing; offline stock allocations and invoice numbers; staff role review and MFA; production-like PostgreSQL 17 backup restoration; opening-stock reconciliation; and a seven-trading-day controlled pilot.

CI's disposable PostgreSQL 16 restore and transaction tests are useful engineering evidence, not substitutes for these real-world tests. The Android offline drafts page stores unsold notes and must never be used as a completed invoice or payment receipt.
