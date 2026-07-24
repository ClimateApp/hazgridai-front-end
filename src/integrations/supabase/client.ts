/**
 * Compatibility re-export. Supabase has been REMOVED — the app now talks to the
 * self-hosted auth-service (see src/lib/backend.ts). This file only exists so the
 * existing `import { supabase } from "@/integrations/supabase/client"` call sites in
 * the chat components keep working against the new backend without edits.
 */
export { backend as supabase } from "@/lib/backend";
