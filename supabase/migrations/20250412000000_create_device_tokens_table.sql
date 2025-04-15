-- Create device_tokens table for push notification tokens
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  last_active TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true
);

-- Create indexes for faster querying
CREATE INDEX idx_device_tokens_user_id ON public.device_tokens(user_id);
CREATE INDEX idx_device_tokens_active ON public.device_tokens(active);
CREATE INDEX idx_device_tokens_platform ON public.device_tokens(platform);

-- Add RLS policies
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Allow users to insert their own tokens
CREATE POLICY "Users can insert their own device tokens" 
  ON public.device_tokens 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Allow users to update their own tokens
CREATE POLICY "Users can update their own device tokens" 
  ON public.device_tokens 
  FOR UPDATE 
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Allow users to see their own tokens
CREATE POLICY "Users can view their own device tokens" 
  ON public.device_tokens 
  FOR SELECT 
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Allow users to delete their own tokens
CREATE POLICY "Users can delete their own device tokens" 
  ON public.device_tokens 
  FOR DELETE 
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Create function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update the updated_at timestamp
CREATE TRIGGER update_device_tokens_timestamp
BEFORE UPDATE ON public.device_tokens
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Comment on table and columns
COMMENT ON TABLE public.device_tokens IS 'Stores device push notification tokens for the BigHeads app';
COMMENT ON COLUMN public.device_tokens.id IS 'Unique identifier for the token entry';
COMMENT ON COLUMN public.device_tokens.user_id IS 'Foreign key to auth.users - can be NULL for anonymous users';
COMMENT ON COLUMN public.device_tokens.token IS 'The actual push notification token from Expo';
COMMENT ON COLUMN public.device_tokens.platform IS 'The platform of the device (ios, android, web)';
COMMENT ON COLUMN public.device_tokens.last_active IS 'Timestamp of when the token was last used';
COMMENT ON COLUMN public.device_tokens.active IS 'Whether this token is still active';