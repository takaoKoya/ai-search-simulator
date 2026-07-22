import type { Metadata } from "next";
import TaskView from "@/components/yattoru/TaskView";

export const metadata: Metadata = {
  title: "YATTORU | 今日のタスク",
  description: "今日のタスクのチェックリストと進捗を確認します。",
};

export default function Page() {
  return <TaskView />;
}
