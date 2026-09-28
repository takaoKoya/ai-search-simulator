import { Badge } from "@/components/ui/badge";
import type { FactClaim, FactClaimClassification } from "@/lib/growth-os/types";

const CLASSIFICATION_VARIANT: Record<FactClaimClassification, "success" | "warning" | "critical" | "neutral" | "info"> = {
  VERIFIED: "success",
  SUPPORTED: "info",
  UNVERIFIED: "critical",
  OPINION: "neutral",
  EXPERIENCE: "neutral",
};

const CLASSIFICATION_LABEL: Record<FactClaimClassification, string> = {
  VERIFIED: "検証済み",
  SUPPORTED: "根拠あり",
  UNVERIFIED: "未検証",
  OPINION: "意見",
  EXPERIENCE: "体験談",
};

export function FactClaimsList({ claims }: { claims: FactClaim[] }) {
  if (claims.length === 0) {
    return <p className="text-sm text-gray-400">まだFact Checkが実行されていません。</p>;
  }

  const unverifiedCount = claims.filter((c) => c.classification === "UNVERIFIED").length;

  return (
    <div className="space-y-3">
      {unverifiedCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          未検証の事実主張が{unverifiedCount}件あります。公開前に本人の確認・出典追加を検討してください。
        </div>
      )}
      <ul className="space-y-2">
        {claims.map((claim) => (
          <li key={claim.id} className="flex items-start gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <Badge variant={CLASSIFICATION_VARIANT[claim.classification]}>{CLASSIFICATION_LABEL[claim.classification]}</Badge>
            <span className="text-neutral-700">{claim.claim}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
