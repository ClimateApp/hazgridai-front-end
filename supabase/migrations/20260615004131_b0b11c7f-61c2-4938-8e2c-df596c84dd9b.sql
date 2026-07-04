-- Fix hurricane-results storage bucket policies to require authentication

-- Drop existing public-scoped policies for hurricane-results bucket
DROP POLICY IF EXISTS "Users can upload hurricane results" ON storage.objects;
DROP POLICY IF EXISTS "Users can view hurricane results" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete hurricane results" ON storage.objects;

-- Recreate policies scoped to authenticated only
CREATE POLICY "Users can upload hurricane results" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'hurricane-results'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view hurricane results" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'hurricane-results'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete hurricane results" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'hurricane-results'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );