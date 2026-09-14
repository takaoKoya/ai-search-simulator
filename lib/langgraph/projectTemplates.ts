export type ProjectType = "seo_geo" | "ads";

export function pickProjectType(industry: string | null | undefined): ProjectType {
  if (industry && /広告|ad|advert/i.test(industry)) return "ads";
  return "seo_geo";
}

export function projectTypeLabel(type: ProjectType): string {
  return type === "ads" ? "広告運用" : "SEO/AIO改善";
}

/** Dynamic team formation: which agent codes join a project, by project type. */
export function teamAgentCodesFor(type: ProjectType): string[] {
  if (type === "ads") return ["kei", "mina", "taku", "kuro", "qa", "repo"];
  return ["seo", "geo", "mina", "kei", "taku", "kuro", "qa", "repo"];
}

/** Initial task template: which agent executes each task, by project type. */
export function taskTemplatesFor(type: ProjectType): Array<{ title: string; agentCode: string }> {
  if (type === "ads") {
    return [
      { title: "広告戦略立案", agentCode: "kei" },
      { title: "実装ディレクション", agentCode: "taku" },
      { title: "効果測定レポート作成", agentCode: "mina" },
    ];
  }
  return [
    { title: "現状分析", agentCode: "kei" },
    { title: "SEO改善提案", agentCode: "seo" },
    { title: "AIO/GEO対応提案", agentCode: "geo" },
    { title: "実装ディレクション", agentCode: "taku" },
    { title: "効果測定レポート作成", agentCode: "mina" },
  ];
}
