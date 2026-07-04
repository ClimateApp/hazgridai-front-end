
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS conversation_type text NOT NULL DEFAULT 'flood';

CREATE INDEX IF NOT EXISTS idx_conversations_user_type
ON public.conversations (user_id, conversation_type, updated_at DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('hurricane-results', 'hurricane-results', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can read their own hurricane files"
ON storage.objects FOR SELECT
USING (bucket_id = 'hurricane-results' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own hurricane files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'hurricane-results' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own hurricane files"
ON storage.objects FOR DELETE
USING (bucket_id = 'hurricane-results' AND auth.uid()::text = (storage.foldername(name))[1]);
