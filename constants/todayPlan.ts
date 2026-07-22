export interface ChecklistItem {
  id: string;
  label: string;
}

export interface TodayTask {
  title: string;
  estimatedMinutes: number;
  checklist: ChecklistItem[];
}

export interface TodayPlan {
  availableMinutes: number;
  task: TodayTask;
}

// Sprint1時点ではモックデータ。将来的にSupabase(daily_tasks)から取得する想定。
export const TODAY_PLAN: TodayPlan = {
  availableMinutes: 30,
  task: {
    title: "「AI副業を7日間試した結果」の記事構成を作りましょう。",
    estimatedMinutes: 25,
    checklist: [
      { id: "theme", label: "テーマ決定" },
      { id: "headings", label: "見出し作成" },
      { id: "body", label: "AIで本文作成" },
      { id: "publish", label: "投稿" },
    ],
  },
};
