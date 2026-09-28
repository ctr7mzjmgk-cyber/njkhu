-- Make certificates.course_id nullable so school certificates (which may
-- not be tied to a specific course) can be stored.
ALTER TABLE public.certificates ALTER COLUMN course_id DROP NOT NULL;