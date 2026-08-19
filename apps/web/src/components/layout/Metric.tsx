export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric">
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
    </article>
  );
}
