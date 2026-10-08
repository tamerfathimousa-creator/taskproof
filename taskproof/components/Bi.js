// Renders English UI chrome with an Arabic translation underneath, muted and
// right-to-left. Used for fixed candidate-facing labels/buttons (not DB
// content) so the interface itself reads in both languages — per the
// company's choice to translate UI chrome, not just scenario content.
// If no Arabic translation is supplied, only the English renders (keeps
// this safe to use everywhere without extra guards).
export default function Bi({ en, ar, as: Tag = "span", className = "", arClassName = "" }) {
  if (!ar) return <Tag className={className}>{en}</Tag>;
  return (
    <Tag className={className}>
      {en}
      <span dir="rtl" lang="ar" className={`block text-muted ${arClassName}`}>
        {ar}
      </span>
    </Tag>
  );
}

// Inline variant for short chrome embedded inside a sentence/button where a
// stacked block would break the layout — shows "English / Arabic" on one
// line instead.
export function BiInline({ en, ar, className = "" }) {
  if (!ar) return <span className={className}>{en}</span>;
  return (
    <span className={className}>
      {en} <span dir="rtl" lang="ar" className="text-muted">/ {ar}</span>
    </span>
  );
}
