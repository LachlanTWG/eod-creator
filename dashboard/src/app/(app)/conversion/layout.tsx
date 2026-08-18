import { isBeta } from "@/lib/beta";

export default function ConversionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {isBeta() && (
        <div className="border-b border-amber-200 bg-amber-50 px-8 py-2 text-xs text-amber-800">
          Beta preview — sample data, not live. Click around freely. Ad spend writes are off.
        </div>
      )}
      {children}
    </>
  );
}
