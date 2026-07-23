export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const entries = Array.isArray(data) ? data : [data];

  return (
    <>
      {entries.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
        />
      ))}
    </>
  );
}
