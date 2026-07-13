-- ═══════════════════════════════════════════════════════════════════════════
-- 0052 — raise the branding bucket size limit for product images
--
-- The public 'branding' bucket (logos, 0035) now also holds product/catalogue
-- images uploaded from the Catalog panel. Bump the limit from 2 MB to 5 MB so
-- phone photos upload without being rejected at the bucket level.
-- ═══════════════════════════════════════════════════════════════════════════
update storage.buckets set file_size_limit = 5242880 where id = 'branding'; -- 5 MB
