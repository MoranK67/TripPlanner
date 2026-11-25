import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, Textarea, useToast } from '@/components/ui';
import { buildAiPrompt, type AiPromptTrip } from '@/domain';

export interface AiPromptCopyProps {
  /** The trip the prompt asks about (its name is the destination, FEAT-2). */
  trip: AiPromptTrip;
}

/**
 * "העתקת הודעה ל-AI" (FEAT-2): copies a ready-made Hebrew message for ChatGPT / Claude that asks
 * for attractions in the import format. When the clipboard is not available (old browser, denied
 * permission), the message is shown in a read-only box, focused and selected for a manual copy.
 */
export function AiPromptCopy({ trip }: AiPromptCopyProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [fallback, setFallback] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (fallback === null) return;
    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [fallback]);

  async function copy() {
    const prompt = buildAiPrompt(trip);
    try {
      // `clipboard` is missing outside secure contexts and in old browsers.
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      setFallback(null);
      toast.show(t('import.ai.copied'));
    } catch {
      setFallback(prompt);
      // Already shown: select it again.
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }

  return (
    <div className="mb-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button size="sm" onClick={() => void copy()}>
          {t('import.ai.button')}
        </Button>
        <p className="m-0 text-[12.5px] leading-relaxed text-ink-soft">{t('import.ai.explain')}</p>
      </div>
      {fallback !== null && (
        <Field label={t('import.ai.fallbackLabel')} hint={t('import.ai.fallback')} className="mt-3">
          <Textarea
            ref={fallbackRef}
            readOnly
            value={fallback}
            dir="rtl"
            spellCheck={false}
            className="min-h-24"
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
      )}
    </div>
  );
}
