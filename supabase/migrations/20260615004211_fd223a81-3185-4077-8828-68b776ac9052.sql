-- Remove duplicate public-scoped hurricane-results storage policies
DROP POLICY IF EXISTS "Users can delete their own hurricane files" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own hurricane files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own hurricane files" ON storage.objects;