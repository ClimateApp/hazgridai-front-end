-- Prevent authenticated users from directly calling the trigger function
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated, anon;