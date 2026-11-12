// Public API of the data-access layer (contract — PROJECT_PLAN §7.2).
// Repositories (authRepo, tripsRepo, activitiesRepo, backupRepo) arrive in M1.7.
// The raw Supabase client is intentionally NOT exported.
export { checkServerConnection, isSupabaseConfigured } from './supabaseClient';
