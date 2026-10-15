
-- Bucket privé pour les sauvegardes Celeste Web.
-- Chaque utilisateur possède son propre dossier.
-- Les archives sont conservées sans écrasement.

INSERT INTO storage.buckets (id, name, public)
VALUES ('celeste-saves', 'celeste-saves', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

-- Lecture : uniquement ses propres sauvegardes.

DROP POLICY IF EXISTS "celeste_saves_read_own"
ON storage.objects;

CREATE POLICY "celeste_saves_read_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'celeste-saves'
    AND (storage.foldername(name))[1] =
        (SELECT auth.uid()::text)
);

-- Écriture : uniquement dans son propre dossier.

DROP POLICY IF EXISTS "celeste_saves_insert_own"
ON storage.objects;

CREATE POLICY "celeste_saves_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'celeste-saves'
    AND (storage.foldername(name))[1] =
        (SELECT auth.uid()::text)
);

-- Aucune autorisation UPDATE ou DELETE
-- n'est créée par ce script.
