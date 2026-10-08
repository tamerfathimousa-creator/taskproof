export default function Logo({ size = "md" }) {
  const box = size === "lg" ? "w-8 h-8 text-base" : "w-6 h-6 text-sm";
  const text = size === "lg" ? "text-2xl" : "text-lg";
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight">
      <span className={`${box} rounded-md bg-accent text-white grid place-items-center`}>✓</span>
      <span className={text}>TaskProof</span>
    </span>
  );
}
