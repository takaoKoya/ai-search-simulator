import type { Metadata } from "next";
import HomeView from "@/components/yattoru/HomeView";

export const metadata: Metadata = {
  title: "YATTORU | ホーム",
  description: "今日やるべきAI副業タスクを1つだけ提示します。",
};

export default function Page() {
  return <HomeView />;
}
