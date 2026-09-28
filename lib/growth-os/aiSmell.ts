// AI臭のルールベース検出(セクション16)。AIによる評価(reviewArticleのai_smell_notes)と
// 組み合わせて使う想定で、ここでは機械的に検出できるパターンだけを対象にする。

export interface AiSmellFinding {
  pattern: string;
  location: string; // マッチした箇所の抜粋
  reason: string;
  suggested_fix: string;
}

interface SmellRule {
  pattern: RegExp;
  reason: string;
  suggested_fix: string;
  label: string;
}

const SMELL_RULES: SmellRule[] = [
  {
    label: "結論から言うとの多用",
    pattern: /結論から言うと/g,
    reason: "「結論から言うと」はAIが多用しがちな定型的な書き出しです",
    suggested_fix: "具体的な状況描写やエピソードから始めるなど、書き出しを変えてください",
  },
  {
    label: "重要なのは〜ですの多用",
    pattern: /重要なのは.{0,30}(です|ということです)/g,
    reason: "「重要なのは〜です」の型が繰り返されるとAIらしい説教臭が出ます",
    suggested_fix: "同じ型を繰り返さず、具体例や問いかけで重要性を示してください",
  },
  {
    label: "〜なのですの多用",
    pattern: /なのです。/g,
    reason: "「〜なのです」の文末が連続すると機械的な印象を与えます",
    suggested_fix: "文末表現にバリエーションを持たせてください",
  },
  {
    label: "不必要な英語の混入",
    pattern: /[A-Za-z]{4,}(を|が|は|の)/g,
    reason: "文脈上不要な英単語の混入はAI生成文章に多いパターンです",
    suggested_fix: "日本語で自然に言い換えられないか検討してください",
  },
  {
    label: "テンプレ的CTA",
    pattern: /(ぜひ.{0,10}(フォロー|チェック)して(ください|みてください))/g,
    reason: "テンプレ的な締めのCTAは押し付けがましい印象と機械的な印象の両方を与えます",
    suggested_fix: "この記事の文脈に沿った、具体的な行動を促す一文に置き換えてください",
  },
];

/** 3回以上出てくる文末表現を「似た文末の連続」として検出する(簡易ヒューリスティック)。 */
function findRepeatedSentenceEndings(text: string): AiSmellFinding[] {
  const sentences = text.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  const endingCounts = new Map<string, number>();

  for (const sentence of sentences) {
    const ending = sentence.slice(-6);
    if (ending.length < 3) continue;
    endingCounts.set(ending, (endingCounts.get(ending) ?? 0) + 1);
  }

  const findings: AiSmellFinding[] = [];
  for (const [ending, count] of endingCounts) {
    if (count >= 3) {
      findings.push({
        pattern: "似た文末表現の連続",
        location: ending,
        reason: `文末「${ending}」が${count}回連続して使われています`,
        suggested_fix: "文末のバリエーションを増やしてください",
      });
    }
  }
  return findings;
}

/** 箇条書き(・/-始まり行)が全体の行数に対して過剰かを検出する。 */
function findExcessiveBulletPoints(text: string): AiSmellFinding[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 6) return [];

  const bulletLines = lines.filter((l) => /^\s*[-・*]\s/.test(l));
  const ratio = bulletLines.length / lines.length;
  if (ratio >= 0.5) {
    return [
      {
        pattern: "過度な箇条書き",
        location: `箇条書き行 ${bulletLines.length}/${lines.length}`,
        reason: "文章全体に占める箇条書きの比率が高く、機械的な羅列に見えます",
        suggested_fix: "重要な部分は地の文で具体的に説明してください",
      },
    ];
  }
  return [];
}

export function detectAiSmell(text: string): AiSmellFinding[] {
  const findings: AiSmellFinding[] = [];

  for (const rule of SMELL_RULES) {
    const matches = text.match(rule.pattern);
    if (matches && matches.length > 0) {
      findings.push({
        pattern: rule.label,
        location: matches[0],
        reason: rule.reason,
        suggested_fix: rule.suggested_fix,
      });
    }
  }

  findings.push(...findRepeatedSentenceEndings(text));
  findings.push(...findExcessiveBulletPoints(text));

  return findings;
}

/** ルールベース検出の重篤度を0-100のペナルティ点として概算する(AIのai_smell_scoreと合算する用途)。 */
export function estimateAiSmellPenalty(findings: AiSmellFinding[]): number {
  return Math.min(findings.length * 8, 40);
}
