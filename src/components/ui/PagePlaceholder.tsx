import { Card } from './Card';

/** Temporary page body used until a feature is built. Remove once all pages exist. */
export function PagePlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <h2 className="mb-2 text-xl font-bold">{title}</h2>
        <p className="m-0 text-muted">{note}</p>
      </Card>
    </div>
  );
}
