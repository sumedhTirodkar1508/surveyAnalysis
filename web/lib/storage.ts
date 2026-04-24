import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!; // use service role key for admin access to storage
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'survey-files';

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('Supabase URL or Secret Key is not configured');
}

export const supabase = createClient(supabaseUrl, supabaseSecretKey);

export async function createSignedUploadUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUploadUrl(path);

  if (error) {
    throw new Error(`Failed to create signed upload url: ${error.message}`);
  }

  return data;
}

export async function createSignedDownloadUrl(path: string, ttlSec = 300) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(path, ttlSec);

  if (error) {
    throw new Error(`Failed to create signed download url: ${error.message}`);
  }

  return data;
}
