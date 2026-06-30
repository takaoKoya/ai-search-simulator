"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { calcAll, SimulatorInputs } from "@/lib/calc";
import { DEFAULT_INPUTS } from "@/constants/defaults";
import { decodeFromUrl } from "@/lib/storage";
import InputForm from "@/components/InputForm";
import CurrentStatusCards from "@/components/CurrentStatusCards";
import RecoveryLineSection from "@/components/RecoveryLineSection";
import ScenarioTable from "@/components/ScenarioTable";
import Charts from "@/components/Charts";
import ProposalComment from "@/components/ProposalComment";
import SavePanel from "@/components/SavePanel";

type FormState = SimulatorInputs & {
  companyName: string;
  industry: string;
  area: string;
  mainService: string;
  competitor1: string;
  competitor2: string;
  competitor3: string;
};

const initialState: FormState = { ...DEFAULT_INPUTS };

function mergeWithDefaults(data: Record<string, unknown>): FormState {
  const merged: FormState = { ...initialState };
  for (const key of Object.keys(initialState) as (keyof FormState)[]) {
    if (key in data && data[key] !== undefined && data[key] !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = data[key];
    }
  }
  return merged;
}

export default function Home() {
  const [formState, setFormState] = useState<FormState>(initialState);
  const [showResults, setShowResults] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fromUrl = decodeFromUrl();
    if (fromUrl) {
      setFormState(mergeWithDefaults(fromUrl));
      setShowResults(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("d");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleChange = (key: string, value: string | number) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleLoad = (data: Record<string, unknown>) => {
    setFormState(mergeWithDefaults(data));
    setShowResults(true);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  };

  const handleCalculate = () => {
    setShowResults(true);
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const handleReset = () => {
    setShowResults(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const results = useMemo(() => calcAll(formState), [formState]);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">
                AI検索対策 投資判断シミュレーター
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                月額費用を回収するために、問い合わせ・受注・粗利がどれだけ必要かを可視化します。
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 whitespace-nowrap flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              本シミュレーションは成果保証ではありません
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Mobile warning */}
        <div className="sm:hidden mb-4 flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          本シミュレーションは成果保証ではなく、投資判断のための試算です。
        </div>

        {/* Input Form */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-bold text-gray-800 mb-5">ヒアリング入力</h2>
          <InputForm inputs={formState} onChange={handleChange} />

          <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">
            🔒 入力された情報はブラウザ上でのみ計算され、外部サーバーには保存されません。
          </p>

          {/* Calculate button */}
          <button
            onClick={handleCalculate}
            className="mt-5 w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-base hover:bg-blue-700 active:bg-blue-800 transition-colors shadow"
          >
            シミュレーション結果を見る →
          </button>
        </div>

        {/* Results */}
        {showResults && (
          <div ref={resultsRef} className="mt-8 space-y-6">
            {/* Section divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-gray-300" />
              <span className="text-sm font-bold text-gray-500 whitespace-nowrap">シミュレーション結果</span>
              <div className="flex-1 border-t border-gray-300" />
            </div>

            <SavePanel
              currentData={formState as unknown as Record<string, unknown>}
              onLoad={handleLoad}
            />
            <CurrentStatusCards current={results.current} inputs={formState} />
            <RecoveryLineSection recovery={results.recovery} inputs={formState} />
            <ScenarioTable
              conservative={results.conservative}
              standard={results.standard}
              aggressive={results.aggressive}
              inputs={formState}
            />
            <Charts results={results} inputs={formState} />
            <ProposalComment
              inputs={formState}
              results={results}
              companyName={formState.companyName}
            />

            {/* Back to input */}
            <button
              onClick={handleReset}
              className="w-full py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              ← 入力画面に戻る
            </button>
          </div>
        )}
      </main>

      <footer className="mt-12 border-t border-gray-200 bg-white py-6">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-xs text-gray-400">
            本シミュレーションは成果保証ではなく、投資判断のためのシミュレーションです。
            入力された情報はブラウザ上でのみ計算され、外部サーバーに保存されません。
          </p>
        </div>
      </footer>
    </div>
  );
}
