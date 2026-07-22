export interface TodayTask {
  title: string;
  estimatedMinutes: number;
}

export interface TodayPlan {
  availableMinutes: number;
  task: TodayTask;
}

// Sprint1時点ではモックデータ。将来的にSupabase等から取得する想定。
export const TODAY_PLAN: TodayPlan = {
  availableMinutes: 30,
  task: {
    title: "「AI副業を7日間試した結果」の記事構成を作りましょう。",
    estimatedMinutes: 25,
  },
};
