import Link from "next/link";
import type { IdeaSource, ResearchItem } from "@/lib/growth-os/types";
import { GROWTH_OS_RESEARCH_ROUTE } from "@/lib/routes";

export function EvidenceList({ evidence }: { evidence: { source: IdeaSource; researchItem: ResearchItem }[] }) {
  if (evidence.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        根拠となるResearchがありません(手動登録されたテーマの可能性があります)。根拠が薄いテーマは信頼度も低く算出されます。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-400">
          <tr>
            <th className="pb-2 font-medium">Source</th>
            <th className="pb-2 font-medium">Title</th>
            <th className="pb-2 font-medium">Date</th>
            <th className="pb-2 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {evidence.map(({ source, researchItem }) => (
            <tr key={source.id} className="border-t border-gray-100 align-top">
              <td className="py-2 whitespace-nowrap text-gray-500">{researchItem.source_name}</td>
              <td className="py-2">
                <Link href={`${GROWTH_OS_RESEARCH_ROUTE}/${researchItem.id}`} className="text-neutral-900 hover:underline">
                  {researchItem.title}
                </Link>
              </td>
              <td className="py-2 font-mono text-xs whitespace-nowrap text-gray-400">
                {new Date(researchItem.collected_at).toLocaleDateString("ja-JP")}
              </td>
              <td className="py-2 text-gray-600">{source.evidence ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
