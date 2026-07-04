
-- Harden user_roles: only admins can modify roles (prevents privilege escalation)
CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Add explicit INSERT policy on profiles for auth.uid() = user_id
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Restrict EXECUTE on SECURITY DEFINER helper functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Add UPDATE policy on hurricane-results storage bucket (owner-scoped)
CREATE POLICY "Users can update own hurricane-results files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'hurricane-results' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'hurricane-results' AND auth.uid()::text = (storage.foldername(name))[1]);
