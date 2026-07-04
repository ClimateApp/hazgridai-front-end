-- Drop existing public-scoped policies on conversations
DROP POLICY IF EXISTS "Users can view their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can create their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can delete their own conversations" ON public.conversations;

-- Recreate conversations policies scoped to authenticated only
CREATE POLICY "Users can view their own conversations" ON public.conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations" ON public.conversations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations" ON public.conversations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Drop existing public-scoped SELECT and DELETE policies on messages
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;

-- Recreate messages SELECT and DELETE policies scoped to authenticated only
CREATE POLICY "Users can view their own messages" ON public.messages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages" ON public.messages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);