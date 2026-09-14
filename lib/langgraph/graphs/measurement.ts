import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { computeApprovalSteps, loadApprovalPolicies } from "@/lib/server/approvalPolicy";
import {
  classifyKpiStatus,
  detectAnomaly,
  evaluateEffect,
  resolveMeasurementStartDelayDays,
  type EffectEvaluationResult,
  type KpiDirection,
} from "@/lib/server/measurement";
import { formatPercent, type MonthlyReportDocumentInput, type MonthlyReportKpiRow } from "@/lib/documents/monthlyReportDocument";

const MeasurementState = Annotation.Root({
  projectId: lastValue<string>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
  evaluatedCount: lastValue<number>(0),
  monthlyReportId: lastValue<string | undefined>(),
  reportingCycleId: lastValue<string | undefined>(),
  approvalRequestId: lastValue<string | undefined>(),
});

export type MeasurementStateType = typeof MeasurementState.State;

interface KpiRow {
  id: string;
  name: string;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  direction: KpiDirection;
  warning_threshold: number | null;
  critical_threshold: number | null;
  initiative_type: string | null;
  source: string;
}

function currentPeriod(now: Date): { start: string; end: string; label: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: `${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月` };
}

/**
 * Growth Loop: Measurement -> Effect Evaluation -> Anomaly Detection ->
 * Monthly Reporting Cycle -> Report Draft -> Critic -> QA -> Manager/CEO
 * Approval (spec §4-53). Runs once per tenant/project per cron tick or
 * manual trigger — idempotent per KPI (a plan already COMPLETED this period
 * is left alone) and per reporting cycle (unique on project+period_start).
 */
export function buildMeasurementGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(MeasurementState)
    .addNode("ensure_measurement_plans", async (state) => {
      const { data: kpis } = await ctx.supabase
        .from("kpis")
        .select("id, name, current_value, target_value, unit, direction, warning_threshold, critical_threshold, initiative_type, source")
        .eq("project_id", state.projectId)
        .eq("tenant_id", ctx.tenantId);

      const TERMINAL_PLAN_STATUSES = new Set(["COMPLETED", "INSUFFICIENT_DATA", "FAILED"]);
      for (const kpi of (kpis ?? []) as unknown as KpiRow[]) {
        const { data: existingPlans } = await ctx.supabase.from("measurement_plans").select("id, status").eq("kpi_id", kpi.id).eq("tenant_id", ctx.tenantId);
        const hasActivePlan = (existingPlans ?? []).some((p) => !TERMINAL_PLAN_STATUSES.has(p.status as string));
        if (hasActivePlan) continue;

        const today = new Date();
        const delayDays = resolveMeasurementStartDelayDays((kpi.initiative_type as "seo" | "content" | "cro" | "ads" | "other" | null) ?? null);
        const startAt = new Date(today.getTime() + delayDays * 86_400_000);

        // Baseline Snapshot (spec §7): fixed at the moment measurement begins
        // tracking this KPI — never re-derived later even if kpis.current_value moves on.
        const { data: baselineSnapshot, error: snapshotError } = await ctx.supabase
          .from("kpi_snapshots")
          .insert({
            tenant_id: ctx.tenantId,
            kpi_id: kpi.id,
            project_id: state.projectId,
            snapshot_type: "BASELINE",
            period_start: today.toISOString().slice(0, 10),
            period_end: today.toISOString().slice(0, 10),
            value: kpi.current_value,
            unit: kpi.unit,
            source: kpi.source,
            data_quality: kpi.current_value == null ? "UNKNOWN" : "GOOD",
          })
          .select("id")
          .single();
        if (snapshotError || !baselineSnapshot) throw snapshotError ?? new Error("Failed to create baseline snapshot");

        const { error: planError } = await ctx.supabase.from("measurement_plans").insert({
          tenant_id: ctx.tenantId,
          project_id: state.projectId,
          kpi_id: kpi.id,
          comparison_type: "PRE_POST",
          baseline_window: { capturedAt: today.toISOString() },
          measurement_window: { startAt: startAt.toISOString() },
          minimum_data_requirement: { requiresCurrentValue: true },
          start_at: startAt.toISOString(),
          status: startAt.getTime() <= today.getTime() ? "READY_TO_EVALUATE" : "WAITING",
          baseline_snapshot_id: baselineSnapshot.id,
        });
        if (planError) throw planError;

        await emitEvent(ctx, { eventType: "measurement.plan_created", message: `${kpi.name}のMeasurement Planを作成しました`, payload: { kpiId: kpi.id } });
      }

      return { currentNode: "ensure_measurement_plans" };
    })
    .addNode("advance_waiting_plans", async (state) => {
      const now = new Date();
      const { data: waitingPlans } = await ctx.supabase
        .from("measurement_plans")
        .select("id, start_at")
        .eq("project_id", state.projectId)
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "WAITING");

      for (const plan of waitingPlans ?? []) {
        if (new Date(plan.start_at as string).getTime() <= now.getTime()) {
          await ctx.supabase.from("measurement_plans").update({ status: "READY_TO_EVALUATE" }).eq("id", plan.id as string).eq("tenant_id", ctx.tenantId);
        }
      }
      return { currentNode: "advance_waiting_plans" };
    })
    .addNode("collect_and_evaluate", async (state) => {
      const { data: readyPlans } = await ctx.supabase
        .from("measurement_plans")
        .select("id, kpi_id, baseline_snapshot_id")
        .eq("project_id", state.projectId)
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "READY_TO_EVALUATE");

      let evaluatedCount = 0;
      for (const plan of readyPlans ?? []) {
        const { data: kpi } = await ctx.supabase
          .from("kpis")
          .select("id, name, current_value, target_value, unit, direction, warning_threshold, critical_threshold, source")
          .eq("id", plan.kpi_id as string)
          .eq("tenant_id", ctx.tenantId)
          .single();
        if (!kpi) continue;
        const kpiRow = kpi as unknown as KpiRow;

        const { data: baseline } = await ctx.supabase.from("kpi_snapshots").select("value, data_quality").eq("id", plan.baseline_snapshot_id as string).eq("tenant_id", ctx.tenantId).maybeSingle();

        // Manual KPI input (spec §127-128): kpis.current_value is the
        // human/connector-updated current reading. Snapshot it now as CURRENT.
        const dataQuality: "GOOD" | "WARNING" | "POOR" | "UNKNOWN" = kpiRow.current_value == null ? "UNKNOWN" : "GOOD";
        const { data: currentSnapshot, error: snapshotError } = await ctx.supabase
          .from("kpi_snapshots")
          .insert({
            tenant_id: ctx.tenantId,
            kpi_id: kpiRow.id,
            project_id: state.projectId,
            measurement_plan_id: plan.id,
            snapshot_type: "CURRENT",
            period_start: new Date().toISOString().slice(0, 10),
            period_end: new Date().toISOString().slice(0, 10),
            value: kpiRow.current_value,
            unit: kpiRow.unit,
            source: kpiRow.source,
            data_quality: dataQuality,
          })
          .select("id")
          .single();
        if (snapshotError || !currentSnapshot) throw snapshotError ?? new Error("Failed to create current snapshot");

        const evaluation: EffectEvaluationResult = await runAgentStep(
          ctx,
          { agentCode: "mina", nodeName: "evaluate_effect", input: { kpiId: kpiRow.id }, projectId: state.projectId },
          async () => {
            const result = evaluateEffect({
              baseline: (baseline?.value as number | null) ?? null,
              current: kpiRow.current_value,
              target: kpiRow.target_value,
              direction: kpiRow.direction,
              hasSufficientData: kpiRow.current_value != null && baseline?.value != null,
              dataQuality: ((baseline?.data_quality as string | undefined) === "GOOD" ? dataQuality : "WARNING") as "GOOD" | "WARNING" | "POOR" | "UNKNOWN",
            });
            return { output: result as unknown as Record<string, unknown>, summary: `${kpiRow.name}: ${result.evaluation}`, result };
          }
        );
        evaluatedCount += 1;

        const newPlanStatus = evaluation.evaluation === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : "COMPLETED";
        await ctx.supabase
          .from("measurement_plans")
          .update({ status: newPlanStatus, latest_evaluation: evaluation as unknown as Record<string, unknown>, end_at: new Date().toISOString() })
          .eq("id", plan.id as string)
          .eq("tenant_id", ctx.tenantId);

        await emitEvent(ctx, {
          eventType: "measurement.evaluated",
          message: `${kpiRow.name}: ${evaluation.evaluation}${evaluation.confidence ? `(確信度${evaluation.confidence})` : ""}`,
          payload: { kpiId: kpiRow.id, evaluation: evaluation.evaluation },
        });

        // Anomaly Detection (spec §26-29) + Root Cause candidate on a bad move.
        const severity = detectAnomaly({ baseline: (baseline?.value as number | null) ?? null, current: kpiRow.current_value, direction: kpiRow.direction });
        if (severity) {
          await ctx.supabase.from("anomaly_events").insert({
            tenant_id: ctx.tenantId,
            project_id: state.projectId,
            kpi_id: kpiRow.id,
            measurement_plan_id: plan.id,
            metric: kpiRow.name,
            expected_range: { baseline: baseline?.value ?? null },
            actual: kpiRow.current_value,
            severity,
          });
          await emitEvent(ctx, {
            eventType: "anomaly.detected",
            message: `${kpiRow.name}に${severity}レベルの異常を検知しました`,
            payload: { kpiId: kpiRow.id, severity },
          });

          if (severity === "HIGH" || severity === "CRITICAL") {
            const { data: relatedFindings } = await ctx.supabase.from("findings").select("type").eq("project_id", state.projectId).eq("tenant_id", ctx.tenantId).limit(10);
            const rootCause = await runAgentStep(
              ctx,
              { agentCode: "mina", nodeName: "root_cause_analysis", input: { kpiId: kpiRow.id }, projectId: state.projectId },
              async (agent) => {
                const provider = getProviderForAgent(agent);
                const res = await provider.generate("root_cause_analysis", { metric: kpiRow.name, relatedFindingTypes: (relatedFindings ?? []).map((f) => f.type) });
                return { output: res.data, summary: res.summary, result: res.data };
              }
            );
            await ctx.supabase.from("findings").insert({
              tenant_id: ctx.tenantId,
              project_id: state.projectId,
              type: "root_cause_candidate",
              payload: { kpiId: kpiRow.id, ...rootCause },
            });
            if (severity === "CRITICAL") {
              await emitEvent(ctx, { eventType: "anomaly.critical_alert", message: `【要対応】${kpiRow.name}がCRITICALレベルで悪化しています。Manager/CEOの確認が必要です。`, payload: { kpiId: kpiRow.id } });
            }
          }
        }
      }

      return { evaluatedCount, currentNode: "collect_and_evaluate" };
    })
    .addNode("draft_monthly_report", async (state) => {
      const now = new Date();
      const period = currentPeriod(now);

      const { data: cycle, error: cycleError } = await ctx.supabase
        .from("reporting_cycles")
        .upsert(
          { tenant_id: ctx.tenantId, project_id: state.projectId, period_start: period.start, period_end: period.end, status: "REPORT_DRAFT", data_cutoff_at: now.toISOString() },
          { onConflict: "tenant_id,project_id,period_start" }
        )
        .select("id")
        .single();
      if (cycleError || !cycle) throw cycleError ?? new Error("Failed to open reporting cycle");

      const { data: plans } = await ctx.supabase
        .from("measurement_plans")
        .select("id, kpi_id, latest_evaluation, status")
        .eq("project_id", state.projectId)
        .eq("tenant_id", ctx.tenantId)
        .in("status", ["COMPLETED", "INSUFFICIENT_DATA"]);

      if (!plans || plans.length === 0) {
        return { reportingCycleId: cycle.id as string, currentNode: "draft_monthly_report" };
      }

      const { data: project } = await ctx.supabase.from("projects").select("client_id").eq("id", state.projectId).eq("tenant_id", ctx.tenantId).single();
      const { data: client } = project?.client_id ? await ctx.supabase.from("clients").select("name").eq("id", project.client_id as string).maybeSingle() : { data: null };

      const kpiRows: MonthlyReportKpiRow[] = [];
      const executiveSummary: string[] = [];
      const dataQualityNotes: string[] = [];
      let anyNegative = false;

      for (const plan of plans) {
        const { data: kpi } = await ctx.supabase
          .from("kpis")
          .select("name, unit, target_value, warning_threshold, critical_threshold, direction, current_value")
          .eq("id", plan.kpi_id as string)
          .eq("tenant_id", ctx.tenantId)
          .single();
        if (!kpi) continue;
        const evaluation = plan.latest_evaluation as unknown as EffectEvaluationResult | null;
        const status = classifyKpiStatus({
          current: kpi.current_value as number | null,
          target: kpi.target_value as number | null,
          warningThreshold: kpi.warning_threshold as number | null,
          criticalThreshold: kpi.critical_threshold as number | null,
          direction: kpi.direction as KpiDirection,
        });

        kpiRows.push({
          metric: kpi.name as string,
          unit: kpi.unit as string | null,
          target: kpi.target_value as number | null,
          actual: kpi.current_value as number | null,
          gap: evaluation?.targetGap.targetGap ?? null,
          momPercent: evaluation?.change.percentageChange ?? null,
          status,
          dataQuality: plan.status === "INSUFFICIENT_DATA" ? "POOR" : "GOOD",
        });

        if (plan.status === "INSUFFICIENT_DATA") {
          dataQualityNotes.push(`${kpi.name as string}: データが不足しているため、単純比較には注意が必要です（断定を避けています）。`);
        } else if (evaluation) {
          executiveSummary.push(`${kpi.name as string}: ${evaluation.change.absoluteChange ?? "—"} (${formatPercent(evaluation.change.percentageChange)}) — ${evaluation.evaluation}`);
          if (evaluation.evaluation === "NEGATIVE") anyNegative = true;
        }
      }
      if (executiveSummary.length === 0) executiveSummary.push("今月は評価可能なKPIデータがありませんでした。");
      if (anyNegative) executiveSummary.push("一部KPIに悪化が見られます。Root Cause候補を確認してください。");

      const reportContent: MonthlyReportDocumentInput = {
        companyName: (client?.name as string | undefined) ?? "対象企業",
        periodLabel: period.label,
        executiveSummary: executiveSummary.slice(0, 5),
        kpiTable: kpiRows,
        narrativeSections: [
          { title: "What Worked", body: anyNegative ? "改善余地はあるものの、一部施策は前進しています。" : "今月実施した施策は概ね前進しています。" },
          { title: "What Did Not Work", body: anyNegative ? "悪化したKPIについてはRoot Cause候補を確認し、来月の改善計画に反映します。" : "特筆すべき停滞はありません。" },
          { title: "Risks", body: dataQualityNotes.length > 0 ? "計測データの一部に不足があり、評価の確度に影響しています。" : "現時点で大きなリスクはありません。" },
          { title: "Next Month Plan", body: "KPIギャップの大きい項目を優先的に改善します。" },
        ],
        dataQualityNotes,
        expansionOpportunities: [],
        sources: kpiRows.map((k) => ({ label: k.metric, reference: "kpi_snapshots" })),
      };

      const { data: report, error: reportError } = await ctx.supabase
        .from("monthly_reports")
        .insert({
          tenant_id: ctx.tenantId,
          project_id: state.projectId,
          reporting_cycle_id: cycle.id,
          period_start: period.start,
          period_end: period.end,
          data_cutoff_at: now.toISOString(),
          status: "DRAFT",
          content_json: reportContent as unknown as Record<string, unknown>,
        })
        .select("id")
        .single();
      if (reportError || !report) throw reportError ?? new Error("Failed to create monthly report");

      await emitEvent(ctx, { eventType: "report.created", message: `${period.label}の月次レポートDraftを作成しました`, payload: { monthlyReportId: report.id } });

      return { monthlyReportId: report.id as string, reportingCycleId: cycle.id as string, currentNode: "draft_monthly_report" };
    })
    .addNode("critic_and_qa_report", async (state) => {
      if (!state.monthlyReportId) return { status: "completed" as GraphStatus, currentNode: "critic_and_qa_report" };

      const { data: report } = await ctx.supabase.from("monthly_reports").select("content_json").eq("id", state.monthlyReportId).eq("tenant_id", ctx.tenantId).single();
      const content = report?.content_json as unknown as MonthlyReportDocumentInput;

      const criticResult = await runAgentStep(
        ctx,
        { agentCode: "kuro", nodeName: "critic_report", input: { monthlyReportId: state.monthlyReportId }, projectId: state.projectId },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const res = await provider.generate("critic_review", { subjectSummary: content.executiveSummary.join(" ") });
          return { output: res.data, summary: res.summary, result: res.data as { passed: boolean; issues: string[] } };
        }
      );

      await ctx.supabase
        .from("monthly_reports")
        .update({ status: criticResult.passed ? "QA" : "REVISION", critic_notes: criticResult.issues })
        .eq("id", state.monthlyReportId)
        .eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, { eventType: "critic.reviewed", message: criticResult.passed ? "月次レポート: Criticレビュー通過" : "月次レポート: Criticが差し戻し", payload: { monthlyReportId: state.monthlyReportId, passed: criticResult.passed } });

      if (!criticResult.passed) {
        return { status: "completed" as GraphStatus, currentNode: "critic_and_qa_report" };
      }

      const qaResult = await runAgentStep(
        ctx,
        { agentCode: "qa", nodeName: "qa_report", input: { monthlyReportId: state.monthlyReportId }, projectId: state.projectId },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const res = await provider.generate("qa_check", { deliverableTitle: "月次レポート" });
          return { output: res.data, summary: res.summary, result: res.data as { passed: boolean } };
        }
      );

      if (!qaResult.passed) {
        await ctx.supabase.from("monthly_reports").update({ status: "REVISION" }).eq("id", state.monthlyReportId).eq("tenant_id", ctx.tenantId);
        await emitEvent(ctx, { eventType: "qa.failed", message: "月次レポートのQAで問題を検出", payload: { monthlyReportId: state.monthlyReportId } });
        return { status: "completed" as GraphStatus, currentNode: "critic_and_qa_report" };
      }

      await emitEvent(ctx, { eventType: "qa.passed", message: "月次レポートがQAを通過しました", payload: { monthlyReportId: state.monthlyReportId } });

      const policies = await loadApprovalPolicies(ctx.supabase, ctx.tenantId);
      const { steps, policyCodes } = computeApprovalSteps(policies, [{ codePrefix: "monthly_report", context: {} }]);

      const approvalId = await createApprovalRequest(ctx, {
        type: "monthly_report",
        subjectType: "monthly_report",
        subjectId: state.monthlyReportId,
        title: `${content.periodLabel} 月次レポートの承認`,
        description: `${content.companyName}様向け月次レポート。Executive Summary: ${content.executiveSummary[0] ?? ""}`,
        aiRecommendation: "Critic/QAを通過したレポートです。内容確認の上、承認をお願いします。",
        requestedByAgentCode: "repo",
        steps,
        policyCode: policyCodes.join(",") || null,
      });

      await ctx.supabase.from("monthly_reports").update({ status: "MANAGER_REVIEW", approval_request_id: approvalId }).eq("id", state.monthlyReportId).eq("tenant_id", ctx.tenantId);
      if (state.reportingCycleId) {
        await ctx.supabase.from("reporting_cycles").update({ status: "INTERNAL_REVIEW" }).eq("id", state.reportingCycleId).eq("tenant_id", ctx.tenantId);
      }

      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "critic_and_qa_report" };
    })
    .addEdge(START, "ensure_measurement_plans")
    .addEdge("ensure_measurement_plans", "advance_waiting_plans")
    .addEdge("advance_waiting_plans", "collect_and_evaluate")
    .addEdge("collect_and_evaluate", "draft_monthly_report")
    .addEdge("draft_monthly_report", "critic_and_qa_report")
    .addEdge("critic_and_qa_report", END)
    .compile({ checkpointer });
}
