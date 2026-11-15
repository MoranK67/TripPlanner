import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, useToast } from '@/components/ui';
import { errorMessage } from '@/i18n/errors';
import { useAuth } from './authContext';

/**
 * Header button to sign out of this device (FR-1.4), shown only while signed in. Asks first, so a
 * stray tap on a phone does not force retyping the password. After signing out the guard sends
 * the user to the login page.
 */
export function SignOutButton() {
  const { t } = useTranslation();
  const { status, session, storedUser, signOut: signOutOfDevice } = useAuth();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const signOut = useMutation({
    mutationFn: () => signOutOfDevice(),
    onSettled: () => setConfirming(false),
    onError: (error) => toast.show(errorMessage(error, t), { tone: 'error' }),
  });

  // Also while a stored session waits to be renewed (M7.3b): signing out works offline.
  if (status !== 'signed_in' && status !== 'stored_offline') return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        title={session?.user.email ?? storedUser?.email ?? undefined}
        onClick={() => setConfirming(true)}
      >
        {t('auth.signOut.button')}
      </Button>
      <ConfirmDialog
        open={confirming}
        destructive={false}
        title={t('auth.signOut.title')}
        message={t('auth.signOut.message')}
        confirmLabel={t('auth.signOut.confirm')}
        loading={signOut.isPending}
        onConfirm={() => signOut.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
