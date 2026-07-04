
UPDATE public.profiles p
SET created_at = u.created_at
FROM auth.users u
WHERE p.user_id = u.id
  AND p.created_at <> u.created_at;
