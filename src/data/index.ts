// Public API of the data-access layer (contract — PROJECT_PLAN §7.2).
// The raw Supabase client is intentionally NOT exported. backupRepo arrives in M6.
export { checkServerConnection, isSupabaseConfigured } from './supabaseClient';
export {
  APP_ERROR_KINDS,
  AppError,
  isAppError,
  toAppError,
  type AppErrorKind,
  type AppErrorOptions,
} from './errors';
export {
  authRepo,
  type AuthChangeListener,
  type AuthEvent,
  type AuthRepo,
  type AuthSession,
  type AuthUser,
} from './authRepo';
export { tripsRepo, type TripWindowUpdate, type TripsRepo } from './tripsRepo';
export { activitiesRepo, type ActivitiesRepo, type ActivityUpdateResult } from './activitiesRepo';
