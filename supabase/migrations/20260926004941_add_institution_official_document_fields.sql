/*
# Institution Official Document Settings

## Summary
Adds columns to the `institutions` table to support configurable identity,
administrative header, and signatory information that appears on official
documents (certificates, bulletins, attestations, etc.).

## Rationale
The existing `settings` table is a generic key-value store. While it could
technically hold these values, the official-document fields are structured,
strongly-typed, and tightly coupled to the institution record itself. Adding
them as proper columns on `institutions` gives us:
- Type safety (text vs boolean vs timestamp)
- Single-row reads (no join/aggregation needed when rendering documents)
- Cleaner API surface for the admin UI
- Proper `updated_at` tracking via the existing trigger

The `settings` table remains available for any future free-form key-value
configuration and is not modified.

## New Columns on `institutions`

### Institutional Identity
- `short_name` (text, nullable) — short/abbreviated institution name
- `city` (text, nullable) — city for address line on documents
- `website` (text, nullable) — institution website URL

### Administrative Header
- `republic_name` (text, nullable) — e.g. "République du Sénégal"
- `motto` (text, nullable) — national/devise line, e.g. "Un Peuple, Un But, Une Foi"
- `ministry` (text, nullable) — ministry of tutelage, e.g. "Ministère de l'Enseignement Supérieur"
- `flag_url` (text, nullable) — storage path/URL for the national flag image
- `header_separator` (text, nullable) — optional custom separator line text

### Signatory
- `director_name` (text, nullable) — name of the director/signatory
- `director_function` (text, nullable) — function/title of the signatory
- `signature_url` (text, nullable) — storage path/URL for the signature image
- `stamp_url` (text, nullable) — storage path/URL for the stamp/seal image

### Timestamp
- `updated_at` already exists and is maintained by an existing trigger.

## Security
- No new tables created.
- No RLS policy changes needed — `institutions` already has:
  - `select_institutions`: `is_super_admin() OR (id = current_institution_id())`
  - `update_institutions`: `has_permission('institutions.manage')`
  - `public_select_institutions`: anon can read active institutions (for public pages)
- Multi-institution isolation is preserved: all policies already filter by
  `current_institution_id()` or `is_super_admin()`.
- File uploads (logo, flag, signature, stamp) use the existing `public-assets`
  storage bucket which already has proper upload/read policies for
  authenticated users. No new storage bucket is needed.

## Storage
- Uses the existing `public-assets` bucket (public read, authenticated upload).
- Files are stored at path: `institutions/{institution_id}/{type}-{timestamp}.{ext}`
- No new storage policies required.

## Notes
1. All new columns are nullable so existing institutions are not affected.
2. The `institutions.manage` permission (already held by super_admin and
   direction roles) controls who can update these fields.
3. The admin UI will provide a dedicated "Identité et documents officiels"
   section in the settings page.
*/

-- Add institutional identity columns
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS website text;

-- Add administrative header columns
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS republic_name text,
  ADD COLUMN IF NOT EXISTS motto text,
  ADD COLUMN IF NOT EXISTS ministry text,
  ADD COLUMN IF NOT EXISTS flag_url text,
  ADD COLUMN IF NOT EXISTS header_separator text;

-- Add signatory columns
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS director_name text,
  ADD COLUMN IF NOT EXISTS director_function text,
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS stamp_url text;
