-- Add insurance settings column to conversations
ALTER TABLE public.conversations 
ADD COLUMN insurance_settings jsonb DEFAULT '{"deductible": 1000, "policyLimit": 100000}'::jsonb;