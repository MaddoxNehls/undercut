import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold">That watch doesn’t exist</h1>
      <p className="mt-2 text-ink-2">It may have been deleted, or the link is mistyped.</p>
      <Link href="/" className="mt-6 inline-block font-semibold text-accent hover:underline">
        Back to watches
      </Link>
    </div>
  );
}
