BEGIN;

ALTER TABLE public.profiles
ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can insert own profile"
ON public.profiles;

CREATE POLICY "Students can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

GRANT SELECT, INSERT, UPDATE
ON TABLE public.profiles
TO authenticated;

REVOKE TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.profiles
FROM anon, authenticated;

COMMIT;
