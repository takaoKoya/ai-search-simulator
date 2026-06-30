"use client";

import { useState } from "react";
import { SimulatorInputs, SimulatorResults } from "@/lib/calc";
import { generateProposalComment } from "@/lib/generateComment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check } from "lucide-react";

interface Props {
  inputs: SimulatorInputs;
  results: SimulatorResults;
  companyName: string;
}

export default function ProposalComment({ inputs, results, companyName }: Props) {
  const [copied, setCopied] = useState(false);
  const comment = generateProposalComment(inputs, results, companyName);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(comment);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = comment;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>提案コメント</CardTitle>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                コピーしました
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                提案コメントをコピー
              </>
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans bg-gray-50 rounded-lg p-4 border border-gray-200">
          {comment}
        </pre>
      </CardContent>
    </Card>
  );
}
