export type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

export interface Greeting {
  text: string;
  icon: string;
}

const GREETINGS: Record<GreetingPeriod, Greeting> = {
  morning: { text: "おはようございます。", icon: "☀️" },
  afternoon: { text: "こんにちは。", icon: "🌤️" },
  evening: { text: "こんばんは。", icon: "🌇" },
  night: { text: "こんばんは。", icon: "🌙" },
};

export function getGreetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function getGreeting(date: Date = new Date()): Greeting {
  return GREETINGS[getGreetingPeriod(date.getHours())];
}
